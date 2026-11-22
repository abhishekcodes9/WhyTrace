import type { EvidenceGraph, EvidenceItem, GraphEdge, GraphNode, InvestigationStageEvent, NodeKind, SourceKind } from "@/lib/types";
import { escapeLucene, keywords as extractKeywords, safeJson, truncate } from "@/lib/utils";
import { readQuery } from "./neo4j";
import { int as neo4jInt } from "neo4j-driver";

const KIND_MAP: Record<string, NodeKind> = {
  Repository: "repository",
  File: "file",
  Commit: "commit",
  PullRequest: "pullRequest",
  Issue: "issue",
  Discussion: "discussion",
  Developer: "developer",
  DesignDocument: "designDocument",
  Decision: "decision",
  Incident: "incident",
};

const RELIABILITY: Record<SourceKind, number> = {
  pullRequest: 4.4,
  decision: 4.6,
  designDocument: 4.8,
  commit: 4,
  issue: 3.4,
  incident: 4,
  discussion: 2.8,
  file: 2.2,
  developer: 1.2,
};

interface RawNode {
  id: string;
  labels: string[];
  props: Record<string, unknown>;
}

interface RawEdge {
  from: string;
  to: string;
  type: string;
  props: Record<string, unknown>;
}

export interface QueryPlan {
  keywords: string[];
  filePaths: string[];
  shas: string[];
  numbers: number[];
  quoted: string[];
}

export interface RetrievalResult {
  evidence: EvidenceItem[];
  graph: EvidenceGraph;
  plan: QueryPlan;
  seedCount: number;
  candidateCount: number;
  warnings: string[];
}

type Neo4jNodeLike = {
  labels?: string[];
  properties?: Record<string, unknown>;
  elementId?: string;
  identity?: unknown;
};

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    if ("toString" in value && typeof (value as { toString: () => string }).toString === "function") {
      const text = (value as { toString: () => string }).toString();
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return null;
}

function normalizePrimitive(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") {
    const maybeInteger = value as { toNumber?: () => number };
    if (typeof maybeInteger.toNumber === "function") {
      try {
        return maybeInteger.toNumber();
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) return value.map(normalizePrimitive);
    return String(value);
  }
  return null;
}

function normalizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const normalized = normalizePrimitive(value);
    if (normalized !== null && normalized !== undefined) output[key] = normalized;
  }
  return output;
}

function rawNode(record: Record<string, unknown>): RawNode | null {
  const node = record.n as Neo4jNodeLike | undefined;
  if (!node || !node.properties) return null;
  const props = normalizeProps(node.properties);
  const id = typeof props.id === "string" ? props.id : null;
  if (!id) return null;
  return { id, labels: node.labels ?? [], props };
}

function nodeKind(node: RawNode): NodeKind {
  for (const label of node.labels) {
    if (KIND_MAP[label]) return KIND_MAP[label];
  }
  return "file";
}

function sourceKind(node: RawNode): SourceKind {
  const kind = nodeKind(node);
  if (kind === "repository") return "file";
  if (kind === "developer") return "developer";
  return kind;
}

function nodeTitle(node: RawNode): string {
  const props = node.props;
  switch (nodeKind(node)) {
    case "commit":
      return String(props.title || props.shortSha || props.sha || "Commit");
    case "pullRequest":
      return `PR #${String(props.number ?? "")} · ${String(props.title ?? "")}`;
    case "issue":
      return `Issue #${String(props.number ?? "")} · ${String(props.title ?? "")}`;
    case "discussion":
      return `Discussion #${String(props.number ?? "")} · ${String(props.title ?? "")}`;
    case "file":
      return String(props.path ?? props.name ?? "File");
    case "developer":
      return `@${String(props.login ?? "")}`;
    case "designDocument":
      return String(props.title ?? props.path ?? "Design document");
    case "decision":
      return String(props.title ?? "Architecture decision");
    case "incident":
      return `Incident #${String(props.issueNumber ?? "")} · ${String(props.title ?? "")}`;
    case "repository":
      return String(props.fullName ?? "Repository");
  }
}

function nodeReference(node: RawNode): string {
  const props = node.props;
  switch (nodeKind(node)) {
    case "commit":
      return `commit ${String(props.shortSha ?? String(props.sha ?? "").slice(0, 7))}`;
    case "pullRequest":
      return `PR #${String(props.number ?? "")}`;
    case "issue":
      return `Issue #${String(props.number ?? "")}`;
    case "discussion":
      return `Discussion #${String(props.number ?? "")}`;
    case "file":
      return String(props.path ?? "file");
    case "developer":
      return `@${String(props.login ?? "")}`;
    case "designDocument":
      return String(props.path ?? "design document");
    case "decision":
      return `decision ${String(props.adrNumber ? `ADR-${String(props.adrNumber).padStart(4, "0")}` : String(props.title ?? ""))}`;
    case "incident":
      return `incident #${String(props.issueNumber ?? "")}`;
    case "repository":
      return String(props.fullName ?? "repository");
  }
}

function nodeDate(node: RawNode): string | null {
  const props = node.props;
  return (
    toIso(props.authoredAt) ??
    toIso(props.createdAt) ??
    toIso(props.mergedAt) ??
    toIso(props.happenedAt) ??
    toIso(props.updatedAt) ??
    toIso(props.lastChangedAt)
  );
}

function nodeAuthor(node: RawNode): string | null {
  const login = node.props.authorLogin ?? node.props.login;
  return typeof login === "string" ? login : null;
}

function nodeText(node: RawNode): string {
  const props = node.props;
  const parts = [
    props.title,
    props.message,
    props.body,
    props.commentsText,
    props.rationale,
    props.summary,
    props.excerpt,
  ].filter((part): part is string => typeof part === "string");
  return truncate(parts.join("\n\n"), 1_800);
}

function nodeExcerpt(node: RawNode): string {
  const props = node.props;
  if (nodeKind(node) === "decision") {
    const status = typeof props.status === "string" ? props.status.toUpperCase() : "STATUS UNKNOWN";
    return `${status} · ${truncate(String(props.rationale ?? props.excerpt ?? ""), 460)}`;
  }
  const primary = String(props.body ?? props.commentsText ?? props.message ?? props.excerpt ?? props.summary ?? "");
  return truncate(primary.replace(/^#+\s+.*$/gm, "").trim(), 460);
}

function sanitizeForClient(params: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  const allowed = [
    "id", "path", "name", "fullName", "branch", "defaultBranch", "private", "stars", "language",
    "sha", "shortSha", "number", "title", "state", "status", "merged",
    "authorLogin", "authorName", "docType", "adrNumber", "issueNumber", "labels", "category",
    "additions", "deletions", "changedFiles", "changeCount", "baseBranch", "headBranch",
    "mergeCommitSha", "sourceDocId", "sourceUrl", "quote", "url", "excerpt",
  ];
  for (const key of allowed) {
    if (!(key in params)) continue;
    const value = params[key];
    if (Array.isArray(value)) {
      output[key] = value.filter((v) => typeof v === "string").join(", ");
    } else if (typeof value === "string") {
      output[key] = truncate(value, 800);
    } else if (typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (value === null) {
      output[key] = null;
    }
  }
  if (params.body !== undefined) output.body = truncate(String(params.body), 1_800);
  if (params.commentsText !== undefined) output.commentsText = truncate(String(params.commentsText), 1_200);
  if (params.rationale !== undefined) output.rationale = truncate(String(params.rationale), 1_200);
  if (params.summary !== undefined) output.summary = truncate(String(params.summary), 1_000);
  return output;
}

function toGraphNode(node: RawNode): GraphNode {
  const kind = nodeKind(node);
  const props = node.props;
  let label = nodeTitle(node);
  let sublabel: string | undefined;
  switch (kind) {
    case "commit":
      label = String(props.shortSha ?? String(props.sha ?? "").slice(0, 7));
      sublabel = truncate(String(props.title ?? ""), 72);
      break;
    case "pullRequest":
      label = `PR #${String(props.number ?? "")}`;
      sublabel = truncate(String(props.title ?? ""), 72);
      break;
    case "issue":
      label = `Issue #${String(props.number ?? "")}`;
      sublabel = truncate(String(props.title ?? ""), 72);
      break;
    case "discussion":
      label = `Discussion #${String(props.number ?? "")}`;
      sublabel = truncate(String(props.title ?? ""), 72);
      break;
    case "file":
      label = String(props.name ?? props.path ?? "File");
      sublabel = truncate(String(props.path ?? ""), 80);
      break;
    case "developer":
      label = `@${String(props.login ?? "")}`;
      sublabel = "Author / participant";
      break;
    case "decision":
      label = truncate(String(props.title ?? "Decision"), 64);
      sublabel = String(props.status ?? "status unknown").toUpperCase();
      break;
    case "designDocument":
      label = truncate(String(props.title ?? props.path ?? "Document"), 64);
      sublabel = String(props.path ?? "");
      break;
    case "incident":
      label = `Incident #${String(props.issueNumber ?? "")}`;
      sublabel = truncate(String(props.title ?? ""), 64);
      break;
    case "repository":
      label = String(props.fullName ?? "Repository");
      sublabel = `branch ${String(props.branch ?? "unknown")}`;
      break;
  }
  return {
    id: node.id,
    kind,
    label,
    sublabel,
    date: nodeDate(node),
    url: typeof props.url === "string" ? props.url : null,
    properties: sanitizeForClient(props),
  };
}

export function parseQueryPlan(question: string): QueryPlan {
  const filePaths = [...new Set(
    (question.match(/[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|c|cc|cpp|h|cs|php|swift|scala|sql|yml|yaml|json|toml|md|mdx|tf)\b/g) ?? [])
      .filter((path) => path.length > 3)
      .slice(0, 8),
  )];
  const shas = [...new Set(
    [...question.matchAll(/\b(?:commit\s+|sha\s+)?([0-9a-f]{7,40})\b/gi)]
      .map((match) => match[1].toLowerCase())
      .filter((sha) => /[a-f]/.test(sha))
      .slice(0, 6),
  )];
  const numbers = [...new Set(
    [...question.matchAll(/(?:#|\b(?:pr|pull request|issue)\s*#?)(\d{1,7})\b/gi)].map((match) => Number(match[1])),
  )].slice(0, 8);
  const quoted = [...new Set(
    [...question.matchAll(/["'`]([^"'`]{3,80})["'`]/g)].map((match) => match[1].trim()),
  )].slice(0, 5);
  return {
    keywords: extractKeywords(question, 12),
    filePaths,
    shas,
    numbers,
    quoted,
  };
}

async function seedIds(plan: QueryPlan, repoId: string, focus?: { type: string; value: string }): Promise<{ ids: string[]; scores: Map<string, number> }> {
  const scores = new Map<string, number>();
  const add = (id: string, score: number) => {
    if (!id) return;
    scores.set(id, Math.max(scores.get(id) ?? 0, score));
  };

  if (focus) {
    if (focus.type === "file") {
      const rows = await readQuery<{ id: string }>(
        `MATCH (n:File {repositoryId: $repoId}) WHERE toLower(n.path) CONTAINS toLower($value)
         RETURN n.id AS id ORDER BY size(n.path) ASC LIMIT 3`,
        { repoId, value: focus.value },
      );
      for (const row of rows) add(row.id, 14);
    } else if (focus.type === "commit") {
      const rows = await readQuery<{ id: string }>(
        `MATCH (n:Commit {repositoryId: $repoId}) WHERE n.sha STARTS WITH toLower($value) OR n.shortSha = toLower($value)
         RETURN n.id AS id LIMIT 3`,
        { repoId, value: focus.value.toLowerCase() },
      );
      for (const row of rows) add(row.id, 16);
    } else if (focus.type === "pullRequest" || focus.type === "issue") {
      const label = focus.type === "pullRequest" ? "PullRequest" : "Issue";
      const rows = await readQuery<{ id: string }>(
        `MATCH (n:${label} {repositoryId: $repoId, number: $number}) RETURN n.id AS id LIMIT 2`,
        { repoId, number: Number(focus.value) },
      );
      for (const row of rows) add(row.id, 16);
    }
  }

  if (plan.filePaths.length) {
    const rows = await readQuery<{ id: string }>(
      `MATCH (n:File {repositoryId: $repoId})
       WHERE any(path IN $paths WHERE toLower(n.path) CONTAINS toLower(path))
       RETURN n.id AS id, size(n.path) AS len ORDER BY len ASC LIMIT 12`,
      { repoId, paths: plan.filePaths },
    );
    for (const row of rows) add(row.id, 10);
  }

  if (plan.shas.length) {
    const rows = await readQuery<{ id: string }>(
      `MATCH (n:Commit {repositoryId: $repoId})
       WHERE any(sha IN $shas WHERE n.sha STARTS WITH sha)
       RETURN n.id AS id LIMIT 8`,
      { repoId, shas: plan.shas },
    );
    for (const row of rows) add(row.id, 12);
  }

  if (plan.numbers.length) {
    const rows = await readQuery<{ id: string }>(
      `CALL {
         MATCH (n:PullRequest {repositoryId: $repoId}) WHERE n.number IN $numbers RETURN n.id AS id
         UNION
         MATCH (n:Issue {repositoryId: $repoId}) WHERE n.number IN $numbers RETURN n.id AS id
       }
       RETURN id LIMIT 16`,
      { repoId, numbers: plan.numbers },
    );
    for (const row of rows) add(row.id, 10);
  }

  if (plan.keywords.length) {
    const lucene = plan.keywords.map((keyword) => `${escapeLucene(keyword)}*`).join(" OR ");
    try {
      const rows = await readQuery<{ id: string; score: number }>(
        `CALL db.index.fulltext.queryNodes('entitySearch', $query, {limit: 80}) YIELD node, score
         WHERE node.repositoryId = $repoId
         RETURN node.id AS id, score
         ORDER BY score DESC LIMIT 40`,
        { repoId, query: lucene },
      );
      for (const row of rows) add(row.id, 5 + Math.min(5, Number(row.score) || 0));
    } catch {
      // Full-text index may not exist on a legacy database; title fallback below still works.
    }
  }

  if (plan.keywords.length && scores.size < 8) {
    const rows = await readQuery<{ id: string }>(
      `CALL {
         MATCH (n:Commit {repositoryId: $repoId})
         WHERE any(k IN $keywords WHERE toLower(n.title) CONTAINS k OR toLower(n.message) CONTAINS k)
         RETURN n.id AS id LIMIT 14
         UNION
         MATCH (n:PullRequest {repositoryId: $repoId})
         WHERE any(k IN $keywords WHERE toLower(n.title) CONTAINS k OR toLower(n.body) CONTAINS k)
         RETURN n.id AS id LIMIT 12
         UNION
         MATCH (n:Issue {repositoryId: $repoId})
         WHERE any(k IN $keywords WHERE toLower(n.title) CONTAINS k OR toLower(n.body) CONTAINS k)
         RETURN n.id AS id LIMIT 12
         UNION
         MATCH (n:DesignDocument {repositoryId: $repoId})
         WHERE any(k IN $keywords WHERE toLower(n.title) CONTAINS k OR toLower(n.body) CONTAINS k)
         RETURN n.id AS id LIMIT 10
         UNION
         MATCH (n:Decision {repositoryId: $repoId})
         WHERE any(k IN $keywords WHERE toLower(n.title) CONTAINS k OR toLower(n.rationale) CONTAINS k)
         RETURN n.id AS id LIMIT 10
         UNION
         MATCH (n:File {repositoryId: $repoId})
         WHERE any(k IN $keywords WHERE toLower(n.path) CONTAINS k)
         RETURN n.id AS id LIMIT 10
       }
       RETURN id LIMIT 50`,
      { repoId, keywords: plan.keywords },
    );
    for (const row of rows) add(row.id, 4.5);
  }

  return { ids: [...scores.keys()], scores };
}

async function expand(seedIdsList: string[], repoId: string): Promise<{ nodes: RawNode[]; edges: RawEdge[]; distances: Map<string, number> }> {
  const edges: RawEdge[] = [];
  const distances = new Map<string, number>();
  const addDistance = (id: string, distance: number) => {
    const current = distances.get(id);
    if (current === undefined || distance < current) distances.set(id, distance);
  };
  const pushEdge = (record: Record<string, unknown>) => {
    const from = String(record.fromId ?? "");
    const to = String(record.toId ?? "");
    const type = String(record.type ?? "");
    if (!from || !to || !type) return;
    if (!edges.some((edge) => edge.from === from && edge.to === to && edge.type === type)) {
      edges.push({
        from,
        to,
        type,
        props: normalizeProps((record.relProps as Record<string, unknown>) ?? {}),
      });
    }
  };

  const hop1 = await readQuery<Record<string, unknown>>(
    `MATCH (s) WHERE s.id IN $ids AND s.repositoryId = $repoId
     MATCH (s)-[r]-(n) WHERE n.repositoryId = $repoId
     RETURN DISTINCT startNode(r).id AS fromId, endNode(r).id AS toId, type(r) AS type, properties(r) AS relProps,
            n.id AS neighborId, labels(n) AS neighborLabels
     LIMIT 700`,
    { ids: seedIdsList, repoId },
  );
  for (const id of seedIdsList) addDistance(id, 0);
  const hop1Ids = new Set<string>();
  for (const record of hop1) {
    pushEdge(record);
    const neighborId = String(record.neighborId ?? "");
    if (neighborId) {
      hop1Ids.add(neighborId);
      addDistance(neighborId, 1);
    }
  }
  const expansionFrontier = [...hop1Ids].filter((id) => id.includes(":pull:") || id.includes(":issue:") || id.includes(":commit:") || id.includes(":decision:") || id.includes(":doc:") || id.includes(":discussion:")).slice(0, 12);
  if (expansionFrontier.length) {
    const hop2 = await readQuery<Record<string, unknown>>(
      `MATCH (s) WHERE s.id IN $ids AND s.repositoryId = $repoId
       MATCH (s)-[r]-(n) WHERE n.repositoryId = $repoId
       RETURN DISTINCT startNode(r).id AS fromId, endNode(r).id AS toId, type(r) AS type, properties(r) AS relProps,
              n.id AS neighborId, labels(n) AS neighborLabels
       LIMIT 500`,
      { ids: expansionFrontier, repoId },
    );
    for (const record of hop2) {
      pushEdge(record);
      const neighborId = String(record.neighborId ?? "");
      if (neighborId && !distances.has(neighborId)) addDistance(neighborId, 2);
    }
  }

  const allIds = [...distances.keys()].slice(0, 160);
  const nodeRows = await readQuery<Record<string, unknown>>(
    `CALL {
       MATCH (n:File {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:Commit {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:PullRequest {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:Issue {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:Discussion {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:Developer {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:DesignDocument {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:Decision {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
       UNION ALL
       MATCH (n:Incident {repositoryId: $repoId}) WHERE n.id IN $ids RETURN n
     }
     RETURN n, labels(n) AS labels`,
    { repoId, ids: allIds },
  );
  const nodes = nodeRows.map(rawNode).filter((node): node is RawNode => Boolean(node));
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges.filter((edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)),
    distances,
  };
}

function scoreNode(
  node: RawNode,
  plan: QueryPlan,
  baseScore: number,
  direct: boolean,
  distance: number,
): number {
  const kind = sourceKind(node);
  let score = baseScore + RELIABILITY[kind] + (direct ? 3.5 : 0) - Math.min(1.8, distance * 0.7);
  const haystack = `${nodeTitle(node)} ${nodeText(node)} ${String(node.props.path ?? "")}`.toLowerCase();
  let topicHits = 0;
  for (const keyword of plan.keywords) {
    if (haystack.includes(keyword)) topicHits += 1;
  }
  score += Math.min(3.5, topicHits * 0.65);
  if (plan.filePaths.some((path) => String(node.props.path ?? "").toLowerCase().includes(path.toLowerCase()))) score += 3;
  if (plan.shas.some((sha) => String(node.props.sha ?? "").startsWith(sha))) score += 4;
  if (plan.numbers.includes(Number(node.props.number))) score += 3;
  const date = nodeDate(node);
  if (date) {
    const ageYears = (Date.now() - new Date(date).getTime()) / (365.25 * 86_400_000);
    score += Math.max(0, 0.9 - ageYears * 0.12);
  }
  if (kind === "developer" && !plan.keywords.some((keyword) => haystack.includes(keyword))) score -= 1.5;
  return Math.round(score * 100) / 100;
}

export async function retrieveEvidence(
  repoId: string,
  question: string,
  focus?: { type: string; value: string },
  options: { onProgress?: (event: InvestigationStageEvent) => void } = {},
): Promise<RetrievalResult> {
  const warnings: string[] = [];
  const progress = options.onProgress ?? (() => undefined);
  const stage = (
    id: "graph" | "connections" | "evidence",
    number: number,
    name: string,
    status: InvestigationStageEvent["status"],
    message: string,
    counts?: InvestigationStageEvent["counts"],
    detail?: string,
  ) => progress({
    type: "stage", stage: id, stageNumber: number, stageName: name,
    status, message, counts, detail, at: new Date().toISOString(),
  });

  const plan = parseQueryPlan(question);
  const seed = await seedIds(plan, repoId, focus);
  stage(
    "graph", 2, "Accessing the Evidence Graph", "completed",
    seed.ids.length
      ? `Neo4j returned ${seed.ids.length} seed record${seed.ids.length === 1 ? "" : "s"} for this question.`
      : "Neo4j returned no seed records for this question.",
    { seeds: seed.ids.length },
  );
  if (!seed.ids.length) {
    stage("connections", 3, "Tracing Evidence Connections", "skipped", "No seed records were available to expand.", undefined, "Graph expansion was not applicable.");
    stage("evidence", 4, "Examining Historical Evidence", "skipped", "There were no records to rank or validate.", undefined, "Evidence examination was not applicable.");
    return { evidence: [], graph: { nodes: [], edges: [] }, plan, seedCount: 0, candidateCount: 0, warnings };
  }

  const mobileSeedIds = seed.ids
    .sort((a, b) => (seed.scores.get(b) ?? 0) - (seed.scores.get(a) ?? 0))
    .slice(0, 24);
  stage("connections", 3, "Tracing Evidence Connections", "active", "Traversing Neo4j relationships from the seed records.", { seeds: mobileSeedIds.length });
  let expanded: Awaited<ReturnType<typeof expand>>;
  try {
    expanded = await expand(mobileSeedIds, repoId);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Graph expansion failed.");
    stage("connections", 3, "Tracing Evidence Connections", "failed", warnings[warnings.length - 1]);
    stage("evidence", 4, "Examining Historical Evidence", "skipped", "Evidence ranking could not run because graph expansion failed.");
    return { evidence: [], graph: { nodes: [], edges: [] }, plan, seedCount: mobileSeedIds.length, candidateCount: 0, warnings };
  }
  stage(
    "connections", 3, "Tracing Evidence Connections", "completed",
    `Traced ${expanded.nodes.length} candidate records and ${expanded.edges.length} relationships.`,
    { records: expanded.nodes.length, relationships: expanded.edges.length, seeds: mobileSeedIds.length },
  );
  stage("evidence", 4, "Examining Historical Evidence", "active", "Ranking records and checking evidence directness.");

  const directSet = new Set(mobileSeedIds);
  const scored = expanded.nodes.map((node) => {
    const direct = directSet.has(node.id);
    const distance = expanded.distances.get(node.id) ?? 2;
    const score = scoreNode(node, plan, seed.scores.get(node.id) ?? 0, direct, distance);
    return { node, direct, score, distance };
  }).sort((a, b) => b.score - a.score);

  const selected = scored
    .filter((candidate) => sourceKind(candidate.node) !== "developer")
    .slice(0, 30);
  // Keep a small set of developers only when authorship is directly relevant.
  const developers = scored.filter((candidate) => sourceKind(candidate.node) === "developer").slice(0, 3);
  const finalSelection = [...selected, ...developers].sort((a, b) => b.score - a.score).slice(0, 32);

  const evidence: EvidenceItem[] = finalSelection.map(({ node, direct, score }) => {
    const kind = sourceKind(node);
    return {
      id: node.id,
      kind,
      title: nodeTitle(node),
      excerpt: nodeExcerpt(node),
      url: typeof node.props.url === "string" ? node.props.url : null,
      date: nodeDate(node),
      author: nodeAuthor(node),
      reference: nodeReference(node),
      direct,
      score,
      sourceTypes: [kind],
      meta: {
        number: typeof node.props.number === "number" ? node.props.number : null,
        sha: typeof node.props.sha === "string" ? node.props.sha : null,
        path: typeof node.props.path === "string" ? node.props.path : null,
        state: typeof node.props.state === "string" ? node.props.state : null,
        merged: typeof node.props.merged === "boolean" ? node.props.merged : null,
        status: typeof node.props.status === "string" ? node.props.status : null,
        docType: typeof node.props.docType === "string" ? node.props.docType : null,
        additions: typeof node.props.additions === "number" ? node.props.additions : null,
        deletions: typeof node.props.deletions === "number" ? node.props.deletions : null,
      },
    };
  });

  const graphIds = new Set<string>(finalSelection.map((selection) => selection.node.id));
  for (const edge of expanded.edges) {
    if (graphIds.size >= 110) break;
    if (graphIds.has(edge.from) && !graphIds.has(edge.to)) graphIds.add(edge.to);
    if (graphIds.has(edge.to) && !graphIds.has(edge.from)) graphIds.add(edge.from);
  }
  const graphNodes = expanded.nodes.filter((node) => graphIds.has(node.id)).map(toGraphNode);
  const graphEdges: GraphEdge[] = expanded.edges
    .filter((edge) => graphIds.has(edge.from) && graphIds.has(edge.to))
    .map((edge) => ({
      id: `${edge.from}->${edge.type}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      type: edge.type,
      label: edge.type.replaceAll("_", " "),
    }));

  const directCount = evidence.filter((item) => item.direct).length;
  stage(
    "evidence", 4, "Examining Historical Evidence", "completed",
    `Ranked ${evidence.length} evidence record${evidence.length === 1 ? "" : "s"}; ${directCount} directly matched the inquiry.`,
    { records: evidence.length, relationships: graphEdges.length, candidates: expanded.nodes.length },
    warnings.length ? warnings.join(" · ") : undefined,
  );

  return {
    evidence,
    graph: { nodes: graphNodes, edges: graphEdges },
    plan,
    seedCount: mobileSeedIds.length,
    candidateCount: expanded.nodes.length,
    warnings,
  };
}

/* ── Repository-wide graph for the Evidence Board ────────────────────────── */

export async function loadRepositoryGraph(repoId: string, limit = 180, kinds?: string[]): Promise<EvidenceGraph> {
  const kindSet = kinds?.length ? new Set(kinds) : null;
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (n)
     WHERE (n:Repository AND n.id = $repoId)
        OR (n.repositoryId = $repoId AND NOT n:Investigation)
     OPTIONAL MATCH (:Commit {repositoryId: $repoId})-[:MODIFIES]->(n)
     WITH n, count(*) AS commitLinks
     ORDER BY CASE
                WHEN n:Repository THEN 0
                WHEN n:Commit THEN 1
                WHEN n:Developer THEN 2
                WHEN n:File AND commitLinks > 0 THEN 3
                WHEN n:DesignDocument THEN 4
                WHEN n:Discussion THEN 5
                WHEN n:PullRequest THEN 6
                WHEN n:File THEN 7
                ELSE 8
              END,
              commitLinks DESC,
              n.id ASC
     RETURN n, labels(n) AS labels
     LIMIT $limit`,
    { repoId, limit: neo4jInt(Math.max(1, Math.floor(limit))) },
  );
  let nodes = rows.map(rawNode).filter((node): node is RawNode => Boolean(node)).map(toGraphNode);
  if (kindSet) nodes = nodes.filter((node) => kindSet.has(node.kind));
  const ids = nodes.map((node) => node.id);
  if (!ids.length) return { nodes: [], edges: [] };

  const edgeRows = await readQuery<Record<string, unknown>>(
    `MATCH (a)-[r]->(b)
     WHERE ((a:Repository AND a.id = $repoId) OR a.repositoryId = $repoId)
       AND ((b:Repository AND b.id = $repoId) OR b.repositoryId = $repoId)
       AND NOT a:Investigation AND NOT b:Investigation
       AND a.id IN $ids AND b.id IN $ids
     RETURN a.id AS fromId, b.id AS toId, type(r) AS type, properties(r) AS relProps
     LIMIT 1200`,
    { repoId, ids },
  );
  const edges: GraphEdge[] = [];
  for (const row of edgeRows) {
    const from = String(row.fromId ?? "");
    const to = String(row.toId ?? "");
    const type = String(row.type ?? "");
    if (!from || !to || !type) continue;
    const id = `${from}->${type}->${to}`;
    if (!edges.some((edge) => edge.id === id)) {
      edges.push({ id, source: from, target: to, type, label: type.replaceAll("_", " ") });
    }
  }
  return { nodes, edges };
}

/** Read changed-file patches for a selected commit. */
export async function loadCommitFiles(repoId: string, commitIds: string[]): Promise<{
  files: { path: string; status: string; additions: number; deletions: number; patch: string | null; source: string }[];
  commitSha: string | null;
}> {
  if (!commitIds.length) return { files: [], commitSha: null };
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (c:Commit {repositoryId: $repoId})-[r:MODIFIES]->(f:File {repositoryId: $repoId})
     WHERE c.id IN $commitIds
     RETURN c.id AS commitId, c.sha AS sha, f.path AS path, r.patch AS patch,
            r.additions AS additions, r.deletions AS deletions, r.status AS status
     ORDER BY f.path ASC LIMIT 80`,
    { repoId, commitIds },
  );
  return {
    commitSha: rows.length ? String(rows[0].sha ?? "") || null : null,
    files: rows.map((row) => ({
      path: String(row.path ?? ""),
      status: String(row.status ?? "modified"),
      additions: Number(normalizePrimitive(row.additions) ?? 0),
      deletions: Number(normalizePrimitive(row.deletions) ?? 0),
      patch: typeof row.patch === "string" ? row.patch.slice(0, 12_000) : null,
      source: String(row.sha ?? "").slice(0, 7),
    })),
  };
}

/** Read changed-file patches for selected pull requests (API-confirmed files only). */
export async function loadPullFiles(repoId: string, pullIds: string[]): Promise<{
  files: { path: string; status: string; additions: number; deletions: number; patch: string | null; source: string }[];
}> {
  if (!pullIds.length) return { files: [] };
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (p:PullRequest {repositoryId: $repoId})-[r:AFFECTS]->(f:File {repositoryId: $repoId})
     WHERE p.id IN $pullIds
     RETURN p.number AS number, f.path AS path, r.patch AS patch,
            r.additions AS additions, r.deletions AS deletions, r.status AS status
     ORDER BY f.path ASC LIMIT 60`,
    { repoId, pullIds },
  );
  return {
    files: rows.map((row) => ({
      path: String(row.path ?? ""),
      status: String(row.status ?? "modified"),
      additions: Number(normalizePrimitive(row.additions) ?? 0),
      deletions: Number(normalizePrimitive(row.deletions) ?? 0),
      patch: typeof row.patch === "string" ? row.patch.slice(0, 10_000) : null,
      source: `PR #${String(row.number ?? "")}`,
    })),
  };
}

export { safeJson };
