import type {
  ChangedFile,
  IngestionCounts,
  IngestionEvent,
  RepositorySummary,
} from "@/lib/types";
import { cleanText } from "@/lib/utils";
import { GitHubClient, GitHubError, mapLimit, type GitHubComment, type GitHubCommitDetail, type GitHubDiscussion, type GitHubDoc, type GitHubIssue, type GitHubPrFile, type GitHubPull, type GitHubRepoMeta } from "./github";
import { canonicalRepoId, markIngestionComplete, nodeId, readCounts, repositoryUrl, saveRepository } from "./repository";
import { serverEnv } from "./env";
import { ensureSchema, readQuery, writeTransaction } from "./neo4j";
import type { ManagedTransaction } from "neo4j-driver";

export type IngestProgress = (event: IngestionEvent) => void;

interface IngestLimits {
  maxCommits: number;
  maxCommitDetails: number;
  maxPulls: number;
  maxIssues: number;
  maxDocs: number;
  maxPrComments: number;
  maxIssueComments: number;
  maxDiscussions: number;
}

interface NodeRow {
  id: string;
  props: Record<string, unknown>;
}

interface RelRow {
  from: string;
  to: string;
  props?: Record<string, unknown>;
}

interface PullBundle {
  pull: GitHubPull;
  files: GitHubPrFile[];
  commitShas: string[];
  comments: GitHubComment[];
}

interface IssueBundle {
  issue: GitHubIssue;
  comments: GitHubComment[];
}

interface IngestGraph {
  repo: GitHubRepoMeta;
  branch: string;
  commits: GitHubCommitDetail[];
  pulls: PullBundle[];
  issues: IssueBundle[];
  discussions: GitHubDiscussion[];
  docs: GitHubDoc[];
  warnings: string[];
}

interface DecisionRecord {
  id: string;
  title: string;
  rationale: string;
  status: string;
  adrNumber: number | null;
  sourceDocId: string;
  sourceUrl: string;
  quote: string;
  supersedesAdrNumbers: number[];
}

const MAX_NODE_BODY = 30_000;

function effectiveLimits(hasToken: boolean): IngestLimits {
  const configured = serverEnv.limits;
  if (hasToken) {
    return {
      maxCommits: configured.maxCommits,
      maxCommitDetails: configured.maxCommitDetails,
      maxPulls: configured.maxPulls,
      maxIssues: configured.maxIssues,
      maxDocs: configured.maxDocs,
      maxPrComments: configured.maxPrComments,
      maxIssueComments: configured.maxIssueComments,
      maxDiscussions: configured.maxDiscussions,
    };
  }
  // Unauthenticated GitHub allows 60 requests/hour. Keep a complete but bounded slice.
  return {
    maxCommits: Math.min(configured.maxCommits, 12),
    maxCommitDetails: Math.min(configured.maxCommitDetails, 8),
    maxPulls: Math.min(configured.maxPulls, 6),
    maxIssues: Math.min(configured.maxIssues, 8),
    maxDocs: Math.min(configured.maxDocs, 4),
    maxPrComments: Math.min(configured.maxPrComments, 3),
    maxIssueComments: Math.min(configured.maxIssueComments, 3),
    maxDiscussions: 0,
  };
}

function titleFromMessage(message: string): string {
  return cleanText(message.split("\n")[0] ?? "", 300);
}

function messageBody(message: string): string {
  const lines = message.split("\n");
  return cleanText(lines.slice(1).join("\n").trim(), MAX_NODE_BODY);
}

function docTypeFor(path: string, body: string): GitHubDoc["docType"] {
  const lower = path.toLowerCase();
  if (/(^|\/)readme(\.[a-z]+)?$/i.test(lower)) return "readme";
  if (/(^|\/)(adr|adrs|decisions|decision-records)(\/|[-_.])/.test(lower) || /(^|\/)adr[-_]?\d+/.test(lower)) return "adr";
  if (body.match(/^#\s+.*\b(adr|architecture decision)\b/im) || body.match(/^##\s+Decision\s*$/im)) return "adr";
  if (/(^|\/)(architecture|design|designs|rfcs)(\/|[-_.])/.test(lower)) return "architecture";
  return "documentation";
}

function docScore(entry: { path: string; size: number }): number {
  const lower = entry.path.toLowerCase();
  if (entry.size > serverEnv.limits.maxDocBytes) return -1;
  if (/(^|\/)readme(\.[a-z]+)?$/i.test(lower)) return 100;
  if (/(^|\/)(adr|adrs|decisions|decision-records)(\/|[-_.])/.test(lower)) return 95;
  if (/(^|\/)(architecture|design|designs|rfcs)(\/|[-_.])/.test(lower)) return 85;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) return 70;
  if (/(^|\/)(changelog|contributing|maintainers|security|governance)(\.[a-z]+)?$/i.test(lower)) return 55;
  return 10;
}

function extractReferences(text: string): Set<number> {
  const numbers = new Set<number>();
  const patterns = [/(?:^|[^\w&])#(\d{1,7})\b/g, /\/issues\/(\d{1,7})\b/g, /\/pull\/(\d{1,7})\b/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) numbers.add(value);
    }
  }
  return numbers;
}

function extractFilePaths(text: string): string[] {
  const matches = text.match(/[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|c|cc|cpp|h|cs|php|swift|scala|sql|yml|yaml|json|toml|md|tf)\b/g) ?? [];
  return [...new Set(matches)].filter((path) => path.length < 300);
}

function parseDecision(doc: GitHubDoc, repoId: string): DecisionRecord | null {
  if (doc.docType !== "adr") return null;
  const statusMatch = doc.body.match(/^##\s+Status\s*\n+([^\n]+)/im);
  const decisionMatch = doc.body.match(/^##\s+Decision\s*\n+([\s\S]*?)(?=\n##\s+|$)/im);
  const contextMatch = doc.body.match(/^##\s+Context\s*(?:and Problem Statement)?\s*\n+([\s\S]*?)(?=\n##\s+|$)/im);
  const rationale = cleanText((decisionMatch?.[1] || contextMatch?.[1] || "").trim(), 2_000);
  if (!rationale) return null;

  const heading = doc.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const adrMatch = doc.path.match(/(?:adr|decision)[-_\s]?0*(\d{1,5})/i) ?? doc.body.match(/ADR[-\s]?0*(\d{1,5})/i);
  const adrNumber = adrMatch ? Number(adrMatch[1]) : null;
  const rawStatus = (statusMatch?.[1] ?? "").toLowerCase();
  const status = rawStatus.includes("supersed")
    ? "superseded"
    : rawStatus.includes("deprecat")
      ? "deprecated"
      : rawStatus.includes("accept") || rawStatus.includes("active") || rawStatus.includes("approved")
        ? "active"
        : rawStatus.includes("propos")
          ? "proposed"
          : "unknown";

  const supersedesAdrNumbers: number[] = [];
  for (const match of doc.body.matchAll(/supersed(?:es|ing)\s+(?:ADR[-\s]?)?0*(\d{1,5})/gi)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) supersedesAdrNumbers.push(value);
  }

  return {
    id: nodeId(repoId, "decision", `${doc.path}#decision`),
    title: heading || doc.title || doc.path.split("/").pop() || "Architecture decision",
    rationale,
    status,
    adrNumber,
    sourceDocId: nodeId(repoId, "doc", doc.path),
    sourceUrl: doc.url,
    quote: rationale.slice(0, 700),
    supersedesAdrNumbers,
  };
}

function isIncidentIssue(issue: GitHubIssue): boolean {
  const labels = issue.labels.join(" ").toLowerCase();
  return /(incident|outage|postmortem|sev[0-9]|production|regression)/.test(labels) ||
    /^(incident|outage|postmortem)[:\s-]/i.test(issue.title);
}

function formatComments(comments: GitHubComment[]): string {
  return comments
    .map((comment) => `@${comment.authorLogin ?? "unknown"} (${comment.createdAt.slice(0, 10)}): ${cleanText(comment.body, 2_500)}`)
    .join("\n\n");
}

function changedFilesFromCommit(commit: GitHubCommitDetail): ChangedFile[] {
  return commit.files.map((file) => ({
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    url: null,
  }));
}

export function changedFilesFromPull(files: GitHubPrFile[]): ChangedFile[] {
  return files.map((file) => ({
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    url: null,
  }));
}

const NODE_LABELS = {
  files: "File",
  commits: "Commit",
  pulls: "PullRequest",
  issues: "Issue",
  discussions: "Discussion",
  developers: "Developer",
  documents: "DesignDocument",
  decisions: "Decision",
  incidents: "Incident",
} as const;

type NodeGroup = keyof typeof NODE_LABELS;

const REL_TYPES = new Set([
  "AUTHORED",
  "OPENED",
  "MODIFIES",
  "AFFECTS",
  "REFERENCES",
  "DISCUSSES",
  "DOCUMENTS",
  "SUPPORTS",
  "SUPERSEDES",
  "CONTAINS",
]);

async function writeNodes(tx: ManagedTransaction, label: string, rows: NodeRow[]): Promise<void> {
  if (!rows.length) return;
  const chunkSize = 250;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await tx.run(
      `UNWIND $rows AS row
       MERGE (n:${label} {id: row.id})
       SET n += row.props`,
      { rows: chunk },
    );
  }
}

async function writeRepoContains(tx: ManagedTransaction, repoId: string, label: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (let index = 0; index < ids.length; index += 500) {
    await tx.run(
      `UNWIND $ids AS id
       MATCH (r:Repository {id: $repoId})
       MATCH (n:${label} {id: id})
       MERGE (r)-[:CONTAINS]->(n)`,
      { repoId, ids: ids.slice(index, index + 500) },
    );
  }
}

async function writeRels(
  tx: ManagedTransaction,
  fromLabel: string,
  toLabel: string,
  type: string,
  rows: RelRow[],
): Promise<void> {
  if (!rows.length) return;
  if (!REL_TYPES.has(type)) throw new Error(`Unsupported relationship type: ${type}`);
  for (let index = 0; index < rows.length; index += 400) {
    await tx.run(
      `UNWIND $rows AS row
       MATCH (a:${fromLabel} {id: row.from})
       MATCH (b:${toLabel} {id: row.to})
       MERGE (a)-[r:${type}]->(b)
       SET r += row.props`,
      { rows: rows.slice(index, index + 400).map((row) => ({ from: row.from, to: row.to, props: row.props ?? {} })) },
    );
  }
}

async function writeGraph(graph: IngestGraph, repoId: string, counts: IngestionCounts): Promise<void> {
  const { repo, commits, pulls, issues, discussions, docs } = graph;
  const fullName = repo.fullName;
  const branch = graph.branch;

  const files = new Map<string, { path: string; changeCount: number; lastChangedAt: string | null }>();
  const developers = new Map<string, { login: string; avatarUrl: string | null; url: string | null; name: string | null }>();

  const addDeveloper = (login: string | null, avatarUrl: string | null, url: string | null, name: string | null = null) => {
    if (!login) return;
    const existing = developers.get(login);
    if (existing) {
      existing.avatarUrl ||= avatarUrl;
      existing.url ||= url;
      existing.name ||= name;
    } else {
      developers.set(login, { login, avatarUrl, url, name });
    }
  };

  const allPulls = new Map(pulls.map((bundle) => [bundle.pull.number, bundle.pull]));
  const allIssues = new Map(issues.map((bundle) => [bundle.issue.number, bundle.issue]));

  for (const commit of commits) {
    addDeveloper(commit.authorLogin, commit.authorAvatarUrl, commit.authorUrl, commit.authorName);
    for (const file of commit.files) {
      const existing = files.get(file.filename);
      if (existing) {
        existing.changeCount += 1;
        if (!existing.lastChangedAt || (commit.authoredAt && commit.authoredAt > existing.lastChangedAt)) {
          existing.lastChangedAt = commit.authoredAt;
        }
      } else {
        files.set(file.filename, { path: file.filename, changeCount: 1, lastChangedAt: commit.authoredAt });
      }
    }
  }
  for (const bundle of pulls) {
    addDeveloper(bundle.pull.authorLogin, bundle.pull.authorAvatarUrl, null);
    for (const file of bundle.files) {
      if (!files.has(file.filename)) {
        files.set(file.filename, { path: file.filename, changeCount: 1, lastChangedAt: bundle.pull.updatedAt });
      }
    }
    for (const comment of bundle.comments) addDeveloper(comment.authorLogin, comment.authorAvatarUrl, null);
  }
  for (const bundle of issues) {
    addDeveloper(bundle.issue.authorLogin, bundle.issue.authorAvatarUrl, null);
    for (const comment of bundle.comments) addDeveloper(comment.authorLogin, comment.authorAvatarUrl, null);
  }
  for (const discussion of discussions) {
    addDeveloper(discussion.authorLogin, discussion.authorAvatarUrl, null);
    for (const comment of discussion.comments) addDeveloper(comment.authorLogin, comment.authorAvatarUrl, null);
  }

  const nodeRows: Record<NodeGroup, NodeRow[]> = {
    files: [...files.values()].map((file) => ({
      id: nodeId(repoId, "file", file.path),
      props: {
        repositoryId: repoId,
        path: file.path,
        name: file.path.split("/").pop() ?? file.path,
        url: `${repositoryUrl(fullName)}/blob/${branch}/${file.path}`,
        changeCount: file.changeCount,
        lastChangedAt: file.lastChangedAt,
        excerpt: file.path,
      },
    })),
    commits: commits.map((commit) => ({
      id: nodeId(repoId, "commit", commit.sha),
      props: {
        repositoryId: repoId,
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        title: titleFromMessage(commit.message),
        message: cleanText(commit.message, MAX_NODE_BODY),
        body: messageBody(commit.message),
        authorLogin: commit.authorLogin,
        authorName: commit.authorName,
        authoredAt: commit.authoredAt,
        url: commit.htmlUrl,
        additions: commit.additions,
        deletions: commit.deletions,
        changedFiles: commit.files.length,
        excerpt: titleFromMessage(commit.message),
      },
    })),
    pulls: pulls.map(({ pull, comments }) => ({
      id: nodeId(repoId, "pull", pull.number),
      props: {
        repositoryId: repoId,
        number: pull.number,
        title: cleanText(pull.title, 400),
        body: cleanText(pull.body, MAX_NODE_BODY),
        commentsText: cleanText(formatComments(comments), MAX_NODE_BODY),
        state: pull.merged ? "merged" : pull.state,
        merged: pull.merged,
        createdAt: pull.createdAt,
        updatedAt: pull.updatedAt,
        mergedAt: pull.mergedAt,
        url: pull.htmlUrl,
        authorLogin: pull.authorLogin,
        baseBranch: pull.baseBranch,
        headBranch: pull.headBranch,
        mergeCommitSha: pull.mergeCommitSha,
        labels: pull.labels,
        excerpt: cleanText(pull.title, 300),
      },
    })),
    issues: issues.map(({ issue, comments }) => ({
      id: nodeId(repoId, "issue", issue.number),
      props: {
        repositoryId: repoId,
        number: issue.number,
        title: cleanText(issue.title, 400),
        body: cleanText(issue.body, MAX_NODE_BODY),
        commentsText: cleanText(formatComments(comments), MAX_NODE_BODY),
        state: issue.state,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        url: issue.htmlUrl,
        authorLogin: issue.authorLogin,
        labels: issue.labels,
        excerpt: cleanText(issue.title, 300),
      },
    })),
    discussions: discussions.map((discussion) => ({
      id: nodeId(repoId, "discussion", discussion.number),
      props: {
        repositoryId: repoId,
        number: discussion.number,
        title: cleanText(discussion.title, 400),
        body: cleanText(discussion.body, MAX_NODE_BODY),
        commentsText: cleanText(formatComments(discussion.comments), MAX_NODE_BODY),
        category: discussion.category,
        createdAt: discussion.createdAt,
        updatedAt: discussion.updatedAt,
        url: discussion.url,
        authorLogin: discussion.authorLogin,
        excerpt: cleanText(discussion.title, 300),
      },
    })),
    developers: [...developers.values()].map((developer) => ({
      id: nodeId(repoId, "developer", developer.login),
      props: {
        repositoryId: repoId,
        login: developer.login,
        avatarUrl: developer.avatarUrl,
        url: developer.url ?? `https://github.com/${developer.login}`,
        name: developer.name,
        excerpt: `@${developer.login}`,
      },
    })),
    documents: docs.map((doc) => ({
      id: nodeId(repoId, "doc", doc.path),
      props: {
        repositoryId: repoId,
        path: doc.path,
        title: doc.title,
        body: cleanText(doc.body, MAX_NODE_BODY),
        url: doc.url,
        docType: doc.docType,
        excerpt: cleanText(doc.body.replace(/^#+\s+.*$/gm, "").trim().slice(0, 500), 500),
      },
    })),
    decisions: [],
    incidents: [],
  };

  const decisions: DecisionRecord[] = [];
  for (const doc of docs) {
    const decision = parseDecision(doc, repoId);
    if (decision) decisions.push(decision);
  }
  const decisionByAdr = new Map<number, DecisionRecord>();
  for (const decision of decisions) {
    if (decision.adrNumber !== null) decisionByAdr.set(decision.adrNumber, decision);
  }

  nodeRows.decisions = decisions.map((decision) => ({
    id: decision.id,
    props: {
      repositoryId: repoId,
      title: decision.title,
      rationale: decision.rationale,
      status: decision.status,
      adrNumber: decision.adrNumber,
      sourceDocId: decision.sourceDocId,
      sourceUrl: decision.sourceUrl,
      quote: decision.quote,
      excerpt: decision.rationale.slice(0, 400),
    },
  }));

  const incidentIssueNumbers = new Set<number>();
  nodeRows.incidents = issues
    .filter(({ issue }) => isIncidentIssue(issue))
    .map(({ issue }) => {
      incidentIssueNumbers.add(issue.number);
      return {
        id: nodeId(repoId, "incident", issue.number),
        props: {
          repositoryId: repoId,
          issueNumber: issue.number,
          title: cleanText(issue.title, 400),
          summary: cleanText(issue.body, 2_000),
          url: issue.htmlUrl,
          happenedAt: issue.createdAt,
          labels: issue.labels,
          status: issue.state,
          excerpt: cleanText(issue.title, 300),
        },
      };
    });

  counts.files = nodeRows.files.length;
  counts.commits = nodeRows.commits.length;
  counts.pullRequests = nodeRows.pulls.length;
  counts.issues = nodeRows.issues.length;
  counts.discussions = nodeRows.discussions.length;
  counts.developers = nodeRows.developers.length;
  counts.documents = nodeRows.documents.length;
  counts.decisions = nodeRows.decisions.length;
  counts.incidents = nodeRows.incidents.length;

  // A PR's files are factual only when GitHub returned them from the API.
  const pullFileEdges: RelRow[] = [];
  for (const bundle of pulls) {
    for (const file of bundle.files) {
      pullFileEdges.push({
        from: nodeId(repoId, "pull", bundle.pull.number),
        to: nodeId(repoId, "file", file.filename),
        props: { additions: file.additions, deletions: file.deletions, patch: file.patch, status: file.status },
      });
    }
  }

  const commitFileEdges: RelRow[] = [];
  for (const commit of commits) {
    for (const file of commit.files) {
      commitFileEdges.push({
        from: nodeId(repoId, "commit", commit.sha),
        to: nodeId(repoId, "file", file.filename),
        props: { additions: file.additions, deletions: file.deletions, patch: file.patch, status: file.status },
      });
    }
  }

  const authoredEdges: RelRow[] = commits
    .filter((commit) => commit.authorLogin)
    .map((commit) => ({
      from: nodeId(repoId, "developer", commit.authorLogin as string),
      to: nodeId(repoId, "commit", commit.sha),
    }));

  const openedPullEdges: RelRow[] = pulls
    .filter(({ pull }) => pull.authorLogin)
    .map(({ pull }) => ({
      from: nodeId(repoId, "developer", pull.authorLogin as string),
      to: nodeId(repoId, "pull", pull.number),
    }));

  const openedIssueEdges: RelRow[] = issues
    .filter(({ issue }) => issue.authorLogin)
    .map(({ issue }) => ({
      from: nodeId(repoId, "developer", issue.authorLogin as string),
      to: nodeId(repoId, "issue", issue.number),
    }));

  const openedDiscussionEdges: RelRow[] = discussions
    .filter((discussion) => discussion.authorLogin)
    .map((discussion) => ({
      from: nodeId(repoId, "developer", discussion.authorLogin as string),
      to: nodeId(repoId, "discussion", discussion.number),
    }));

  const discussesEdges: RelRow[] = [];
  const addDiscusses = (comments: GitHubComment[], kind: string, number: number) => {
    for (const comment of comments) {
      if (!comment.authorLogin) continue;
      discussesEdges.push({
        from: nodeId(repoId, "developer", comment.authorLogin),
        to: nodeId(repoId, kind, number),
        props: { via: "comment", commentUrl: comment.url, createdAt: comment.createdAt },
      });
    }
  };
  for (const bundle of pulls) addDiscusses(bundle.comments, "pull", bundle.pull.number);
  for (const bundle of issues) addDiscusses(bundle.comments, "issue", bundle.issue.number);
  for (const discussion of discussions) addDiscusses(discussion.comments, "discussion", discussion.number);

  const pullContainsEdges: RelRow[] = [];
  for (const bundle of pulls) {
    for (const sha of bundle.commitShas) {
      if (!commits.some((commit) => commit.sha === sha)) continue;
      pullContainsEdges.push({
        from: nodeId(repoId, "pull", bundle.pull.number),
        to: nodeId(repoId, "commit", sha),
      });
    }
  }

  const referencesIssue: RelRow[] = [];
  const referencesPull: RelRow[] = [];
  const addReferences = (from: { kind: string; id: string }, text: string, excludeNumber?: number) => {
    for (const number of extractReferences(text)) {
      if (number === excludeNumber) continue;
      if (allIssues.has(number)) referencesIssue.push({ from: from.id, to: nodeId(repoId, "issue", number), props: { explicit: true } });
      if (allPulls.has(number)) referencesPull.push({ from: from.id, to: nodeId(repoId, "pull", number), props: { explicit: true } });
    }
  };

  for (const commit of commits) addReferences({ kind: "commit", id: nodeId(repoId, "commit", commit.sha) }, commit.message);
  for (const { pull } of pulls) addReferences({ kind: "pull", id: nodeId(repoId, "pull", pull.number) }, `${pull.title}\n${pull.body}`, pull.number);
  for (const { issue } of issues) addReferences({ kind: "issue", id: nodeId(repoId, "issue", issue.number) }, `${issue.title}\n${issue.body}`, issue.number);
  for (const discussion of discussions) addReferences({ kind: "discussion", id: nodeId(repoId, "discussion", discussion.number) }, `${discussion.title}\n${discussion.body}\n${discussion.comments.map((c) => c.body).join("\n")}`);
  for (const doc of docs) addReferences({ kind: "doc", id: nodeId(repoId, "doc", doc.path) }, doc.body);

  const referencesByFrom = new Map<string, { kind: "issue" | "pull"; id: string }[]>();
  const targetKind = (from: string) => (from.includes(":commit:") ? "Commit" : from.includes(":pull:") ? "PullRequest" : from.includes(":issue:") ? "Issue" : from.includes(":discussion:") ? "Discussion" : "DesignDocument");
  for (const [from, target] of [
    ...referencesIssue.map((row) => [row.from, { kind: "issue" as const, id: row.to }] as const),
    ...referencesPull.map((row) => [row.from, { kind: "pull" as const, id: row.to }] as const),
  ]) {
    const list = referencesByFrom.get(from) ?? [];
    list.push(target);
    referencesByFrom.set(from, list);
  }
  const refsToIssuesByLabel = new Map<string, RelRow[]>();
  const refsToPullsByLabel = new Map<string, RelRow[]>();
  for (const [from, targets] of referencesByFrom) {
    const label = targetKind(from);
    for (const target of targets) {
      if (target.kind === "issue") {
        const list = refsToIssuesByLabel.get(label) ?? [];
        list.push({ from, to: target.id });
        refsToIssuesByLabel.set(label, list);
      } else {
        const list = refsToPullsByLabel.get(label) ?? [];
        list.push({ from, to: target.id });
        refsToPullsByLabel.set(label, list);
      }
    }
  }

  const documentDecisionEdges: RelRow[] = decisions.map((decision) => ({
    from: decision.sourceDocId,
    to: decision.id,
  }));

  const supersedesEdges: RelRow[] = [];
  for (const decision of decisions) {
    for (const adr of decision.supersedesAdrNumbers) {
      const target = decisionByAdr.get(adr);
      if (target && target.id !== decision.id) {
        supersedesEdges.push({ from: decision.id, to: target.id, props: { explicit: true } });
      }
    }
  }

  const incidentEdges: RelRow[] = [];
  const incidentAffects: RelRow[] = [];
  for (const { issue } of issues) {
    if (!incidentIssueNumbers.has(issue.number)) continue;
    incidentEdges.push({ from: nodeId(repoId, "incident", issue.number), to: nodeId(repoId, "issue", issue.number) });
    for (const path of extractFilePaths(issue.body)) {
      if (files.has(path)) {
        incidentAffects.push({ from: nodeId(repoId, "incident", issue.number), to: nodeId(repoId, "file", path) });
      }
    }
  }

  let totalRelationships = 0;
  await writeTransaction(async (tx) => {
    await writeNodes(tx, "File", nodeRows.files);
    await writeNodes(tx, "Commit", nodeRows.commits);
    await writeNodes(tx, "PullRequest", nodeRows.pulls);
    await writeNodes(tx, "Issue", nodeRows.issues);
    await writeNodes(tx, "Discussion", nodeRows.discussions);
    await writeNodes(tx, "Developer", nodeRows.developers);
    await writeNodes(tx, "DesignDocument", nodeRows.documents);
    await writeNodes(tx, "Decision", nodeRows.decisions);
    await writeNodes(tx, "Incident", nodeRows.incidents);

    for (const [group, label] of Object.entries(NODE_LABELS) as [NodeGroup, string][]) {
      await writeRepoContains(tx, repoId, label, nodeRows[group].map((row) => row.id));
    }

    await writeRels(tx, "Commit", "File", "MODIFIES", commitFileEdges);
    await writeRels(tx, "PullRequest", "File", "AFFECTS", pullFileEdges);
    await writeRels(tx, "Developer", "Commit", "AUTHORED", authoredEdges);
    await writeRels(tx, "Developer", "PullRequest", "OPENED", openedPullEdges);
    await writeRels(tx, "Developer", "Issue", "OPENED", openedIssueEdges);
    await writeRels(tx, "Developer", "Discussion", "OPENED", openedDiscussionEdges);
    await writeRels(tx, "PullRequest", "Commit", "CONTAINS", pullContainsEdges);
    await writeRels(tx, "Developer", "PullRequest", "DISCUSSES", discussesEdges.filter((row) => row.to.includes(":pull:")));
    await writeRels(tx, "Developer", "Issue", "DISCUSSES", discussesEdges.filter((row) => row.to.includes(":issue:")));
    await writeRels(tx, "Developer", "Discussion", "DISCUSSES", discussesEdges.filter((row) => row.to.includes(":discussion:")));
    await writeRels(tx, "DesignDocument", "Decision", "DOCUMENTS", documentDecisionEdges);
    await writeRels(tx, "Decision", "Decision", "SUPERSEDES", supersedesEdges);
    await writeRels(tx, "Incident", "Issue", "REFERENCES", incidentEdges);
    await writeRels(tx, "Incident", "File", "AFFECTS", incidentAffects);

    for (const [label, rows] of refsToIssuesByLabel) {
      await writeRels(tx, label, "Issue", "REFERENCES", rows);
    }
    for (const [label, rows] of refsToPullsByLabel) {
      await writeRels(tx, label, "PullRequest", "REFERENCES", rows);
    }

    totalRelationships =
      Object.values(nodeRows).reduce((sum, rows) => sum + rows.length, 0) +
      commitFileEdges.length +
      pullFileEdges.length +
      authoredEdges.length +
      openedPullEdges.length +
      openedIssueEdges.length +
      openedDiscussionEdges.length +
      discussesEdges.length +
      pullContainsEdges.length +
      documentDecisionEdges.length +
      supersedesEdges.length +
      incidentEdges.length +
      incidentAffects.length +
      [...refsToIssuesByLabel.values()].reduce((sum, rows) => sum + rows.length, 0) +
      [...refsToPullsByLabel.values()].reduce((sum, rows) => sum + rows.length, 0);
  });

  counts.relationships = totalRelationships;
}

/**
 * Prove that every GitHub commit fetched for this run exists as a Commit node
 * and is attached to the same Repository through CONTAINS. This is deliberately
 * independent of the summary counts so a partial graph can never be reported as
 * a successful commit ingestion.
 */
async function verifyCommitPersistence(repoId: string, shas: string[]): Promise<{ expected: number; matched: number; linked: number; links: number }> {
  const uniqueShas = [...new Set(shas.map((sha) => sha.toLowerCase()))];
  if (!uniqueShas.length) {
    throw new Error("Neo4j commit verification failed: GitHub returned no commit SHAs to verify.");
  }
  const rows = await readQuery<Record<string, unknown>>(
    `CALL {
       MATCH (c:Commit {repositoryId: $repoId})
       WHERE c.sha IN $shas
       RETURN count(DISTINCT c) AS matched
     }
     CALL {
       MATCH (:Repository {id: $repoId})-[link:CONTAINS]->(c:Commit {repositoryId: $repoId})
       WHERE c.sha IN $shas
       RETURN count(DISTINCT c) AS linked, count(link) AS links
     }
     RETURN matched, linked, links`,
    { repoId, shas: uniqueShas },
  );
  const row = rows[0] ?? {};
  const asCount = (value: unknown): number => {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "toNumber" in value) {
      return (value as { toNumber: () => number }).toNumber();
    }
    return 0;
  };
  return {
    expected: uniqueShas.length,
    matched: asCount(row.matched),
    linked: asCount(row.linked),
    links: asCount(row.links),
  };
}

async function safe<T>(label: string, fn: () => Promise<T>, warnings: string[]): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof GitHubError ? error.message : error instanceof Error ? error.message : "Unknown error";
    warnings.push(`${label}: ${message}`);
    return null;
  }
}

export async function ingestRepository(options: {
  owner: string;
  name: string;
  branch?: string;
  onProgress?: IngestProgress;
  knownRepo?: GitHubRepoMeta;
}): Promise<{ repository: RepositorySummary; graph: IngestGraph; counts: IngestionCounts; warnings: string[]; durationMs: number }> {
  const started = Date.now();
  const progress = options.onProgress ?? (() => undefined);
  const client = new GitHubClient();
  const limits = effectiveLimits(client.hasToken);
  const warnings: string[] = [];
  const repo = options.knownRepo ?? (await client.getRepo(options.owner, options.name));
  const branch = options.branch?.trim() || repo.defaultBranch;
  const repoId = canonicalRepoId(repo.fullName);
  if (!repo.defaultBranch) throw new GitHubError("EMPTY_REPOSITORY", "This repository has no default branch yet.");

  progress({ type: "stage", stage: 1, stageName: "Repository", message: `Opening ${repo.fullName} on ${branch}` });
  await saveRepository({
    id: repoId,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    url: repo.url,
    branch,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    private: repo.private,
    stars: repo.stars,
    language: repo.language,
  });

  progress({ type: "stage", stage: 2, stageName: "Commit history", message: `Reading up to ${limits.maxCommits} commits` });
  const commitList = await client.listCommits(repo.owner, repo.name, branch, limits.maxCommits);
  if (!commitList.length) {
    throw new GitHubError("EMPTY_REPOSITORY", "No commits were found on this branch. The repository may be empty.");
  }
  const detailTargets = commitList.slice(0, limits.maxCommitDetails);
  let detailDone = 0;
  const details = await mapLimit(detailTargets, 3, async (item) => {
    if (!client.canSpend(1)) return { ...item, additions: 0, deletions: 0, files: [] } as GitHubCommitDetail;
    const detail = await safe(`Commit ${item.sha.slice(0, 7)} files`, () => client.getCommit(repo.owner, repo.name, item.sha), warnings);
    detailDone += 1;
    progress({
      type: "progress",
      stageName: "Commit patches",
      message: `Reading changed files for commit ${detailDone}/${detailTargets.length}`,
      current: detailDone,
      total: detailTargets.length,
    });
    return detail ?? ({ ...item, additions: 0, deletions: 0, files: [] } as GitHubCommitDetail);
  });
  const commits: GitHubCommitDetail[] = commitList.map((item) => {
    const detail = details.find((candidate) => candidate.sha === item.sha);
    return detail ?? { ...item, additions: 0, deletions: 0, files: [] };
  });

  progress({ type: "stage", stage: 3, stageName: "Pull requests", message: `Reading up to ${limits.maxPulls} pull requests and confirmed commits` });
  const pulls = await safe("Pull requests", () => client.listPulls(repo.owner, repo.name, limits.maxPulls), warnings);
  const pullBundles: PullBundle[] = await mapLimit(pulls ?? [], 2, async (pull) => {
    if (!client.canSpend(3)) return { pull, files: [], commitShas: [], comments: [] };
    const [files, commitShas, comments] = await Promise.all([
      safe(`PR #${pull.number} files`, () => client.listPullFiles(repo.owner, repo.name, pull.number), warnings),
      safe(`PR #${pull.number} commits`, () => client.listPullCommits(repo.owner, repo.name, pull.number), warnings),
      limits.maxPrComments > 0
        ? safe(`PR #${pull.number} discussion`, () => client.listPullComments(repo.owner, repo.name, pull.number, limits.maxPrComments), warnings)
        : Promise.resolve([]),
    ]);
    return { pull, files: files ?? [], commitShas: (commitShas ?? []).map((commit) => commit.sha), comments: comments ?? [] };
  });

  progress({ type: "stage", stage: 4, stageName: "Issues", message: `Reading up to ${limits.maxIssues} issues` });
  const issues = await safe("Issues", () => client.listIssues(repo.owner, repo.name, limits.maxIssues), warnings);
  const issueNumbersReferenced = new Set<number>();
  for (const commit of commits) for (const number of extractReferences(commit.message)) issueNumbersReferenced.add(number);
  for (const pull of pulls ?? []) for (const number of extractReferences(`${pull.title}\n${pull.body}`)) issueNumbersReferenced.add(number);
  const commentTargets = (issues ?? [])
    .filter((issue, index) => index < 4 || issueNumbersReferenced.has(issue.number) || isIncidentIssue(issue))
    .slice(0, Math.max(6, limits.maxIssueComments));
  const issueBundles: IssueBundle[] = await mapLimit(issues ?? [], 2, async (issue) => {
    if (!commentTargets.includes(issue) || !client.canSpend(1)) return { issue, comments: [] };
    const comments = await safe(`Issue #${issue.number} discussion`, () => client.listIssueComments(repo.owner, repo.name, issue.number, limits.maxIssueComments), warnings);
    return { issue, comments: comments ?? [] };
  });

  progress({ type: "stage", stage: 5, stageName: "Discussions", message: limits.maxDiscussions > 0 ? "Reading GitHub Discussions" : "Discussions skipped (requires an authenticated token)" });
  const discussions = limits.maxDiscussions > 0
    ? (await safe("Discussions", () => client.listDiscussions(repo.owner, repo.name, limits.maxDiscussions), warnings)) ?? []
    : [];

  progress({ type: "stage", stage: 6, stageName: "Documentation", message: "Locating README, architecture notes and ADRs" });
  const tree = await safe("Repository tree", () => client.listTree(repo.owner, repo.name, branch), warnings);
  if (tree?.truncated) warnings.push("GitHub truncated the repository tree; documentation discovery is partial.");
  const docEntries = (tree?.entries ?? [])
    .filter((entry) => /\.(md|mdx|rst)$/i.test(entry.path))
    .map((entry) => ({ ...entry, score: docScore(entry) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limits.maxDocs);
  let docsDone = 0;
  const docs = (
    await mapLimit(docEntries, 3, async (entry) => {
      if (!client.canSpend(1)) return null;
      const file = await safe(`Document ${entry.path}`, () => client.getFile(repo.owner, repo.name, entry.path, branch), warnings);
      docsDone += 1;
      progress({
        type: "progress",
        stageName: "Documentation",
        message: `Reading ${docsDone}/${docEntries.length} documents`,
        current: docsDone,
        total: docEntries.length,
      });
      if (!file) return null;
      const heading = file.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
      return {
        path: entry.path,
        title: heading || entry.path.split("/").pop() || entry.path,
        body: cleanText(file.body, serverEnv.limits.maxDocBytes),
        url: file.url,
        docType: docTypeFor(entry.path, file.body),
      } satisfies GitHubDoc;
    })
  ).filter((doc): doc is GitHubDoc => Boolean(doc));

  const graph: IngestGraph = {
    repo,
    branch,
    commits,
    pulls: pullBundles,
    issues: issueBundles,
    discussions,
    docs,
    warnings,
  };

  progress({ type: "stage", stage: 7, stageName: "Decision extraction", message: "Extracting explicit ADR decisions and labelled incidents" });
  const counts: IngestionCounts = {
    commits: 0,
    pullRequests: 0,
    issues: 0,
    discussions: 0,
    documents: 0,
    decisions: 0,
    incidents: 0,
    files: 0,
    developers: 0,
    relationships: 0,
  };

  progress({ type: "stage", stage: 8, stageName: "Neo4j graph", message: "Writing repository-scoped nodes and relationships" });
  await ensureSchema();
  await writeGraph(graph, repoId, counts);

  progress({ type: "stage", stage: 9, stageName: "Read-back verification", message: "Reading the persisted graph back from Neo4j" });
  const persisted = await readCounts(repoId);
  const coreExpected: Array<[keyof IngestionCounts, number, number]> = [
    ["commits", counts.commits, persisted.commits],
    ["pullRequests", counts.pullRequests, persisted.pulls],
    ["issues", counts.issues, persisted.issues],
    ["files", counts.files, persisted.files],
    ["documents", counts.documents, persisted.documents],
  ];
  const failed = coreExpected.filter(([, expected, actual]) => expected > 0 && actual < expected);
  if (failed.length) {
    throw new Error(`Neo4j read-back verification failed for: ${failed.map(([name]) => name).join(", ")}.`);
  }

  const commitCheck = await verifyCommitPersistence(repoId, graph.commits.map((commit) => commit.sha));
  if (commitCheck.matched !== commitCheck.expected || commitCheck.linked !== commitCheck.expected || commitCheck.links < commitCheck.expected) {
    throw new Error(
      `Neo4j commit verification failed: ${commitCheck.matched}/${commitCheck.expected} commit nodes persisted, ` +
      `${commitCheck.linked}/${commitCheck.expected} linked to the repository.`,
    );
  }

  if (persisted.relationships < counts.relationships) {
    throw new Error(
      `Neo4j read-back verification failed: ${persisted.relationships} outgoing relationships persisted, expected at least ${counts.relationships}.`,
    );
  }

  // Only now may the repository be advertised as successfully ingested.
  await markIngestionComplete(repoId);
  counts.relationships = persisted.relationships;

  const repository: RepositorySummary = {
    id: repoId,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    url: repo.url,
    branch,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    private: repo.private,
    stars: repo.stars,
    language: repo.language,
    ingestedAt: new Date().toISOString(),
    ingestionStatus: "ingested",
    ingestionError: null,
    counts: {
      files: persisted.files,
      commits: persisted.commits,
      pulls: persisted.pulls,
      issues: persisted.issues,
      discussions: persisted.discussions,
      developers: persisted.developers,
      documents: persisted.documents,
      decisions: persisted.decisions,
      incidents: persisted.incidents,
      relationships: persisted.relationships,
    },
  };

  return { repository, graph, counts, warnings, durationMs: Date.now() - started };
}

export { changedFilesFromCommit };
