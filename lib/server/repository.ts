import type { GraphCounts, RepositorySummary } from "@/lib/types";
import { asNumber, asString } from "@/lib/utils";
import { ensureSchema, readQuery, writeQuery } from "./neo4j";
import { int as neo4jInt } from "neo4j-driver";

export function canonicalRepoId(fullName: string): string {
  return fullName.trim().toLowerCase();
}

export function repositoryUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

export function nodeId(repoId: string, kind: string, key: string | number): string {
  return `${repoId}:${kind}:${String(key)}`;
}

export interface SaveRepositoryInput {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  branch: string;
  defaultBranch: string;
  description: string | null;
  private: boolean;
  stars: number;
  language: string | null;
}

export async function saveRepository(repo: SaveRepositoryInput): Promise<void> {
  await ensureSchema();
  await writeQuery(
    `MERGE (r:Repository {id: $id})
     SET r.owner = $owner,
         r.name = $name,
         r.fullName = $fullName,
         r.url = $url,
         r.branch = $branch,
         r.defaultBranch = $defaultBranch,
         r.description = $description,
         r.private = $private,
         r.stars = $stars,
         r.language = $language,
         r.lastIngestionStatus = 'running',
         r.lastIngestionStartedAt = datetime($ingestedAt),
         r.lastIngestionError = null,
         r.lastIngestionFinishedAt = null`,
    {
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      url: repo.url,
      branch: repo.branch,
      defaultBranch: repo.defaultBranch,
      description: repo.description,
      private: repo.private,
      stars: repo.stars,
      language: repo.language,
      ingestedAt: new Date().toISOString(),
    },
  );
}

/** Mark a repository as fully ingested only after Neo4j read-back verification. */
export async function markIngestionComplete(repoId: string): Promise<void> {
  await writeQuery(
    `MATCH (r:Repository {id: $id})
     SET r.lastIngestionStatus = 'ingested',
         r.ingestedAt = datetime(),
         r.lastIngestionFinishedAt = datetime(),
         r.lastIngestionError = null`,
    { id: repoId },
  );
}

export async function markIngestionRunning(repoId: string, fullName: string): Promise<void> {
  await ensureSchema();
  await writeQuery(
    `MERGE (r:Repository {id: $id})
     ON CREATE SET r.fullName = $fullName, r.url = $url, r.createdAt = datetime()
     SET r.lastIngestionStatus = 'running', r.lastIngestionStartedAt = datetime()`,
    { id: repoId, fullName, url: repositoryUrl(fullName) },
  );
}

export async function markIngestionFailed(repoId: string, message: string): Promise<void> {
  await writeQuery(
    `MATCH (r:Repository {id: $id})
     SET r.lastIngestionStatus = 'failed', r.lastIngestionError = $message, r.lastIngestionFinishedAt = datetime()`,
    { id: repoId, message: message.slice(0, 500) },
  );
}

export async function getRepository(fullName: string): Promise<RepositorySummary | null> {
  await ensureSchema();
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (r:Repository {id: $id})
     RETURN r`,
    { id: canonicalRepoId(fullName) },
  );
  if (!rows.length) return null;
  const node = rows[0].r as { properties?: Record<string, unknown> };
  const raw = node.properties ?? (node as unknown as Record<string, unknown>);
  const counts = await readCounts(String(raw.id));
  return {
    id: asString(raw.id),
    owner: asString(raw.owner),
    name: asString(raw.name),
    fullName: asString(raw.fullName),
    url: asString(raw.url),
    branch: asString(raw.branch),
    defaultBranch: asString(raw.defaultBranch),
    description: raw.description ? asString(raw.description) : null,
    private: Boolean(raw.private),
    stars: asNumber(raw.stars),
    language: raw.language ? asString(raw.language) : null,
    ingestedAt: raw.ingestedAt ? new Date(String(raw.ingestedAt)).toISOString() : null,
    counts,
    ingestionStatus: raw.lastIngestionStatus === "running" || raw.lastIngestionStatus === "ingested" || raw.lastIngestionStatus === "failed"
      ? raw.lastIngestionStatus
      : null,
    ingestionError: raw.lastIngestionError ? asString(raw.lastIngestionError) : null,
  };
}

export async function readCounts(repoId: string): Promise<GraphCounts> {
  const rows = await readQuery<Record<string, unknown>>(
    `CALL {
       MATCH (n:File {repositoryId: $repoId}) RETURN count(n) AS files
     }
     CALL { MATCH (n:Commit {repositoryId: $repoId}) RETURN count(n) AS commits }
     CALL { MATCH (n:PullRequest {repositoryId: $repoId}) RETURN count(n) AS pulls }
     CALL { MATCH (n:Issue {repositoryId: $repoId}) RETURN count(n) AS issues }
     CALL { MATCH (n:Discussion {repositoryId: $repoId}) RETURN count(n) AS discussions }
     CALL { MATCH (n:Developer {repositoryId: $repoId}) RETURN count(n) AS developers }
     CALL { MATCH (n:DesignDocument {repositoryId: $repoId}) RETURN count(n) AS documents }
     CALL { MATCH (n:Decision {repositoryId: $repoId}) RETURN count(n) AS decisions }
     CALL { MATCH (n:Incident {repositoryId: $repoId}) RETURN count(n) AS incidents }
     CALL {
       MATCH (n {repositoryId: $repoId})-[r]->(m {repositoryId: $repoId})
       WHERE NOT n:Investigation AND NOT m:Investigation
       RETURN count(r) AS relationships
       UNION ALL
       MATCH (:Repository {id: $repoId})-[r]->(m {repositoryId: $repoId})
       WHERE NOT m:Investigation
       RETURN count(r) AS relationships
     }
     RETURN files, commits, pulls, issues, discussions, developers, documents, decisions, incidents, sum(relationships) AS relationships`,
    { repoId },
  );
  const row = rows[0] ?? {};
  return {
    files: asNumber(row.files),
    commits: asNumber(row.commits),
    pulls: asNumber(row.pulls),
    issues: asNumber(row.issues),
    discussions: asNumber(row.discussions),
    developers: asNumber(row.developers),
    documents: asNumber(row.documents),
    decisions: asNumber(row.decisions),
    incidents: asNumber(row.incidents),
    relationships: asNumber(row.relationships),
  };
}

export async function readRelationshipCounts(repoId: string, runId?: string): Promise<Record<string, number>> {
  const runFilter = runId ? "AND r.lastIngestedRunId = $runId" : "";
  const params: Record<string, string> = { repoId };
  if (runId) params.runId = runId;
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (n)-[r]->(m)
     WHERE ((n:Repository AND n.id = $repoId) OR (n.repositoryId = $repoId AND NOT n:Investigation))
       AND m.repositoryId = $repoId AND NOT m:Investigation
       ${runFilter}
     RETURN type(r) AS type, count(r) AS count
     ORDER BY type`,
    params,
  );
  return Object.fromEntries(rows.map((row) => [asString(row.type), asNumber(row.count)]));
}

export async function listRecentRepositories(limit = 12): Promise<RepositorySummary[]> {
  await ensureSchema();
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (r:Repository)
     WHERE r.lastIngestionStatus = 'ingested'
     RETURN r ORDER BY r.ingestedAt DESC LIMIT $limit`,
    { limit: neo4jInt(Math.max(1, Math.floor(limit))) },
  );
  return rows.map((row) => {
    const node = row.r as { properties?: Record<string, unknown> };
    const raw = node.properties ?? (node as unknown as Record<string, unknown>);
    return {
      id: asString(raw.id),
      owner: asString(raw.owner),
      name: asString(raw.name),
      fullName: asString(raw.fullName),
      url: asString(raw.url),
      branch: asString(raw.branch),
      defaultBranch: asString(raw.defaultBranch),
      description: raw.description ? asString(raw.description) : null,
      private: Boolean(raw.private),
      stars: asNumber(raw.stars),
      language: raw.language ? asString(raw.language) : null,
      ingestedAt: raw.ingestedAt ? new Date(String(raw.ingestedAt)).toISOString() : null,
      ingestionStatus: raw.lastIngestionStatus === "running" || raw.lastIngestionStatus === "ingested" || raw.lastIngestionStatus === "failed"
        ? raw.lastIngestionStatus
        : null,
      ingestionError: raw.lastIngestionError ? asString(raw.lastIngestionError) : null,
    };
  });
}
