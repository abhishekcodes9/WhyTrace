import type {
  ChangedFile,
  EvidenceItem,
  EvidenceQuality,
  GraphEdge,
  GraphNode,
  InvestigationFocus,
  InvestigationReport,
  InvestigationStatus,
  RepositorySummary,
  SupersessionStatus,
} from "@/lib/types";
import { confidenceLabel } from "@/lib/utils";
import { loadCommitFiles, loadPullFiles, retrieveEvidence } from "./graph-retrieval";
import { ABSTENTION, synthesizeInvestigation } from "./gemini";
import { getRepository } from "./repository";
import { caseNumber, createInvestigationId, saveInvestigation } from "./investigations";
import { readInvestigation } from "./investigations";

export class RepositoryNotIngestedError extends Error {
  code = "REPOSITORY_NOT_INGESTED";
  constructor(fullName: string) {
    super(`${fullName} is not indexed yet. Connect and ingest the repository before investigating.`);
    this.name = "RepositoryNotIngestedError";
  }
}

export class RepositoryEmptyError extends Error {
  code = "EMPTY_GRAPH";
  constructor(fullName: string) {
    super(`The Neo4j graph for ${fullName} contains no commit evidence. Re-run ingestion.`);
    this.name = "RepositoryEmptyError";
  }
}

export class RepositoryIngestionInProgressError extends Error {
  code = "INGESTION_IN_PROGRESS";
  constructor(fullName: string) {
    super(`${fullName} is still being ingested. Wait for commit read-back verification before investigating.`);
    this.name = "RepositoryIngestionInProgressError";
  }
}

export class RepositoryIngestionFailedError extends Error {
  code = "INGESTION_FAILED";
  constructor(fullName: string, detail: string | null) {
    super(`${fullName} has no verified commit evidence because its last ingestion failed${detail ? `: ${detail}` : "."} Re-run ingestion.`);
    this.name = "RepositoryIngestionFailedError";
  }
}

interface Supersession {
  status: SupersessionStatus;
  note: string;
}

function nodeReference(node: GraphNode): string {
  const props = node.properties;
  switch (node.kind) {
    case "decision":
      return props.adrNumber ? `ADR-${String(props.adrNumber).padStart(4, "0")}` : `decision “${node.label}”`;
    case "pullRequest":
      return `PR #${String(props.number ?? "")}`;
    case "issue":
      return `Issue #${String(props.number ?? "")}`;
    case "commit":
      return `commit ${String(props.sha ?? node.label).slice(0, 7)}`;
    case "designDocument":
      return String(props.path ?? node.label);
    default:
      return node.label;
  }
}

function deriveSupersession(evidence: EvidenceItem[], graphEdges: GraphEdge[], graphNodes: GraphNode[]): Supersession {
  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const decisions = evidence.filter((item) => item.kind === "decision");
  const supersedeEdges = graphEdges.filter((edge) => edge.type === "SUPERSEDES");
  if (supersedeEdges.length) {
    const edge = supersedeEdges[0];
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const sourceRef = source ? nodeReference(source) : "A retrieved decision";
    const targetRef = target ? nodeReference(target) : "an earlier decision";
    return {
      status: "superseded",
      note: `${sourceRef} explicitly supersedes ${targetRef} in the retrieved graph${supersedeEdges.length > 1 ? ` (${supersedeEdges.length} explicit supersession links)` : ""}.`,
    };
  }
  const explicitlySuperseded = decisions.filter((item) => String(item.meta.status ?? "").toLowerCase() === "superseded");
  if (explicitlySuperseded.length) {
    return {
      status: "superseded",
      note: `${explicitlySuperseded.map((item) => item.reference).join(", ")} explicitly record${explicitlySuperseded.length === 1 ? "s" : ""} a Superseded status in the source document.`,
    };
  }
  const explicitlyActive = decisions.filter((item) => String(item.meta.status ?? "").toLowerCase() === "active");
  if (explicitlyActive.length) {
    return {
      status: "active",
      note: `${explicitlyActive.map((item) => item.reference).join(", ")} explicitly record${explicitlyActive.length === 1 ? "s" : ""} an Active/Accepted status. No newer superseding record was retrieved; absence of a newer record is not proof that nothing changed.`,
    };
  }
  if (!decisions.length) {
    return {
      status: "unknown",
      note: "No Decision record was retrieved, so supersession cannot be established. The graph does not infer decisions from generic prose.",
    };
  }
  return {
    status: "unknown",
    note: "Retrieved decisions do not carry an explicit active or superseded status, and no SUPERSEDES relationship was retrieved. WHYTRACE does not infer current status from silence.",
  };
}

function buildDevelopers(evidence: EvidenceItem[], graphNodes: GraphNode[]): InvestigationReport["developers"] {
  const counts = new Map<string, { login: string; url: string | null; count: number }>();
  const add = (login: string | null, url: string | null) => {
    if (!login) return;
    const existing = counts.get(login);
    if (existing) {
      existing.count += 1;
      existing.url ||= url;
    } else {
      counts.set(login, { login, url, count: 1 });
    }
  };
  for (const item of evidence) add(item.author, null);
  for (const node of graphNodes) {
    if (node.kind === "developer") {
      const login = typeof node.properties.login === "string" ? node.properties.login : null;
      const url = typeof node.properties.url === "string" ? node.properties.url : null;
      if (login) {
        const existing = counts.get(login);
        if (existing) existing.url ||= url;
        else counts.set(login, { login, url, count: 1 });
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
}

function buildTimeline(evidence: EvidenceItem[]): InvestigationReport["timeline"] {
  return evidence
    .filter((item) => Boolean(item.date))
    .map((item) => ({
      date: item.date as string,
      kind: item.kind,
      title: item.title,
      reference: item.reference,
      url: item.url,
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, 40);
}

function computeQuality(input: {
  evidence: EvidenceItem[];
  keywords: string[];
  documentedClaims: number;
  abstained: boolean;
}): EvidenceQuality {
  const { evidence, keywords, documentedClaims, abstained } = input;
  if (!evidence.length) {
    return {
      confidence: 0,
      label: "insufficient",
      evidenceCount: 0,
      directCount: 0,
      sourceTypes: [],
      coverage: 0,
      explanation: "No repository records matched the question. No answer was synthesized.",
    };
  }
  const sourceTypes = [...new Set(evidence.map((item) => item.kind).filter((kind) => kind !== "developer"))];
  const directCount = evidence.filter((item) => item.direct).length;
  const haystack = evidence.map((item) => `${item.title} ${item.excerpt}`).join(" ").toLowerCase();
  const matched = keywords.filter((keyword) => haystack.includes(keyword)).length;
  const coverage = keywords.length ? matched / keywords.length : directCount > 0 ? 0.5 : 0;
  let confidence =
    8 +
    Math.min(directCount, 6) * 7 +
    sourceTypes.length * 5 +
    Math.min(evidence.length, 12) * 0.8 +
    coverage * 12 +
    Math.min(documentedClaims, 4) * 3;
  confidence = Math.round(Math.min(92, confidence));
  if (abstained) confidence = Math.min(confidence, 15);
  const label = abstained ? "insufficient" : confidenceLabel(confidence);
  return {
    confidence,
    label,
    evidenceCount: evidence.length,
    directCount,
    sourceTypes,
    coverage: Math.round(coverage * 100),
    explanation: `${evidence.length} retrieved record${evidence.length === 1 ? "" : "s"} (${directCount} direct match${directCount === 1 ? "" : "es"}) across ${sourceTypes.length} source type${sourceTypes.length === 1 ? "" : "s"}; ${Math.round(coverage * 100)}% query-term coverage. Confidence is calculated deterministically from retrieval and cited evidence, not taken from the model.`,
  };
}

async function buildChangedFiles(
  repoFullName: string,
  branch: string,
  evidence: EvidenceItem[],
): Promise<ChangedFile[]> {
  const repoId = repoFullName.toLowerCase();
  const commitIds = evidence
    .filter((item) => item.kind === "commit")
    .slice(0, 3)
    .map((item) => item.id);
  const pullIds = evidence
    .filter((item) => item.kind === "pullRequest")
    .slice(0, 2)
    .map((item) => item.id);

  const [commitFiles, pullFiles] = await Promise.all([
    loadCommitFiles(repoId, commitIds).catch(() => ({ files: [] as ChangedFile[], commitSha: null })),
    loadPullFiles(repoId, pullIds).catch(() => ({ files: [] as ChangedFile[] })),
  ]);

  const seen = new Set<string>();
  return [...commitFiles.files, ...pullFiles.files]
    .filter((file) => {
      const key = `${file.source}:${file.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((file) => ({
      ...file,
      url: `https://github.com/${repoFullName}/blob/${branch}/${file.path}`,
    }))
    .slice(0, 40);
}

function addRepositoryNode(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, repo: RepositorySummary): void {
  const repoNode: GraphNode = {
    id: repo.id,
    kind: "repository",
    label: repo.fullName,
    sublabel: `branch ${repo.branch}`,
    date: repo.ingestedAt ?? null,
    url: repo.url,
    properties: {
      id: repo.id,
      fullName: repo.fullName,
      branch: repo.branch,
      defaultBranch: repo.defaultBranch,
      url: repo.url,
      private: repo.private,
      stars: repo.stars,
      language: repo.language ?? null,
    },
  };
  if (!graph.nodes.some((node) => node.id === repoNode.id)) graph.nodes.unshift(repoNode);
  const attached = graph.nodes.filter((node) => node.kind !== "repository").slice(0, 16);
  for (const node of attached) {
    if (!graph.edges.some((edge) => edge.source === repo.id && edge.target === node.id)) {
      graph.edges.push({
        id: `${repo.id}->CONTAINS->${node.id}`,
        source: repo.id,
        target: node.id,
        type: "CONTAINS",
        label: "CONTAINS",
      });
    }
  }
}

export async function runInvestigation(input: {
  repoFullName: string;
  branch?: string;
  question: string;
  focus?: InvestigationFocus;
  sessionId: string;
}): Promise<InvestigationReport> {
  const repo = await getRepository(input.repoFullName);
  if (!repo) throw new RepositoryNotIngestedError(input.repoFullName);
  if (repo.ingestionStatus === "running") throw new RepositoryIngestionInProgressError(repo.fullName);
  if (!repo.counts || repo.counts.commits === 0) {
    if (repo.ingestionStatus === "failed") throw new RepositoryIngestionFailedError(repo.fullName, repo.ingestionError ?? null);
    throw new RepositoryEmptyError(input.repoFullName);
  }

  const branch = input.branch?.trim() || repo.branch || repo.defaultBranch;
  const repoId = repo.id;
  const retrieval = await retrieveEvidence(
    repoId,
    input.question,
    input.focus && input.focus.type !== "question" ? { type: input.focus.type, value: input.focus.value } : undefined,
  );

  const createdAt = new Date().toISOString();
  const id = createInvestigationId();

  if (!retrieval.evidence.length) {
    const report: InvestigationReport = {
      id,
      caseNumber: caseNumber(id, createdAt),
      repoFullName: repo.fullName,
      branch,
      question: input.question,
      createdAt,
      status: "insufficient",
      summary: ABSTENTION,
      documentedRationale: [],
      technicalObservations: [],
      inferences: [],
      citations: [],
      uncertainties: [
        "Graph retrieval found no repository records matching this question.",
        "Try naming a file, commit, pull request, issue, module or architectural decision explicitly.",
      ],
      supersessionStatus: "unknown",
      supersessionNote: "No Decision record was retrieved.",
      evidenceQuality: computeQuality({ evidence: [], keywords: retrieval.plan.keywords, documentedClaims: 0, abstained: true }),
      evidence: [],
      changedFiles: [],
      developers: [],
      timeline: [],
      graph: retrieval.graph,
      synthesis: {
        provider: "gemini",
        status: "unavailable",
        model: null,
        message: "Synthesis was not attempted because Neo4j graph retrieval returned no evidence.",
      },
      focus: input.focus ?? null,
    };
    addRepositoryNode(report.graph, repo);
    await persistAndVerify(report, input.sessionId);
    return report;
  }

  const supersession = deriveSupersession(retrieval.evidence, retrieval.graph.edges, retrieval.graph.nodes);
  const relationships = retrieval.graph.edges.map((edge) => ({ type: edge.type, source: edge.source, target: edge.target }));
  const synthesis = await synthesizeInvestigation({
    question: input.question,
    repoFullName: repo.fullName,
    branch,
    evidence: retrieval.evidence,
    relationships,
    supersessionHint: `${supersession.status.toUpperCase()} — ${supersession.note}`,
  });

  const claimsCount = synthesis.documentedRationale.length + synthesis.technicalObservations.length + synthesis.inferences.length;
  const modelAbstained = synthesis.summary.trim() === ABSTENTION;
  const weakRetrieval =
    retrieval.evidence.filter((item) => item.direct).length === 0 &&
    retrieval.plan.keywords.length > 0 &&
    retrieval.evidence.length < 3;
  const abstained = modelAbstained || (!claimsCount && synthesis.synthesis.status === "completed") || weakRetrieval;

  const documentedRationale = abstained ? [] : synthesis.documentedRationale;
  const technicalObservations = abstained ? [] : synthesis.technicalObservations;
  const inferences = abstained ? [] : synthesis.inferences;
  const summary = abstained ? ABSTENTION : synthesis.summary;

  const quality = computeQuality({
    evidence: retrieval.evidence,
    keywords: retrieval.plan.keywords,
    documentedClaims: documentedRationale.length,
    abstained,
  });

  const uncertainties = [...synthesis.uncertainties];
  if (synthesis.rejectedClaimCount > 0) {
    uncertainties.push(
      `${synthesis.rejectedClaimCount} model claim${synthesis.rejectedClaimCount === 1 ? " was" : "s were"} discarded because they did not cite a retrieved evidence id.`,
    );
  }
  if (abstained && !modelAbstained) {
    uncertainties.push("WHYTRACE applied an evidence-sufficiency guard and suppressed an unsupported synthesis.");
  }
  if (abstained) {
    uncertainties.push("Evidence is listed for inspection, but no historical explanation is asserted.");
  }
  if (retrieval.warnings.length) uncertainties.push(...retrieval.warnings);

  const changedFiles = await buildChangedFiles(repo.fullName, branch, retrieval.evidence);
  const graph = retrieval.graph;
  addRepositoryNode(graph, repo);

  const report: InvestigationReport = {
    id,
    caseNumber: caseNumber(id, createdAt),
    repoFullName: repo.fullName,
    branch,
    question: input.question,
    createdAt,
    status: (abstained ? "insufficient" : "answered") as InvestigationStatus,
    summary,
    documentedRationale,
    technicalObservations,
    inferences,
    citations: synthesis.citations,
    uncertainties: [...new Set(uncertainties)].slice(0, 14),
    supersessionStatus: supersession.status,
    supersessionNote: supersession.note,
    evidenceQuality: quality,
    evidence: retrieval.evidence,
    changedFiles,
    developers: buildDevelopers(retrieval.evidence, graph.nodes),
    timeline: buildTimeline(retrieval.evidence),
    graph,
    synthesis: synthesis.synthesis,
    focus: input.focus ?? null,
  };

  await persistAndVerify(report, input.sessionId);
  return report;
}

async function persistAndVerify(report: InvestigationReport, sessionId: string): Promise<void> {
  await saveInvestigation(report, sessionId);
  const readBack = await readInvestigation(report.id, sessionId);
  if (!readBack || readBack.id !== report.id) {
    throw new Error("Neo4j persistence verification failed: the saved investigation could not be read back.");
  }
}

export { ABSTENTION };
