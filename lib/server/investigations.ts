import { randomUUID } from "node:crypto";
import type { CaseFileSummary, InvestigationReport } from "@/lib/types";
import { asNumber, asString, safeJson } from "@/lib/utils";
import { ensureSchema, readQuery, writeQuery } from "./neo4j";
import { int as neo4jInt } from "neo4j-driver";

export interface StoredInvestigation extends CaseFileSummary {
  report: InvestigationReport;
}

export function createInvestigationId(): string {
  return `inv_${randomUUID()}`;
}

export function caseNumber(id: string, createdAt: string): string {
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  const suffix = id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return `WT-${date}-${suffix}`;
}

export async function saveInvestigation(report: InvestigationReport, sessionId: string): Promise<CaseFileSummary> {
  await ensureSchema();
  const caseNo = caseNumber(report.id, report.createdAt);
  await writeQuery(
    `MATCH (r:Repository {id: $repoId})
     MERGE (i:Investigation {id: $id})
     SET i.caseNumber = $caseNumber,
         i.repositoryId = $repoId,
         i.repoFullName = $repoFullName,
         i.branch = $branch,
         i.question = $question,
         i.status = $status,
         i.summary = $summary,
         i.confidence = $confidence,
         i.evidenceCount = $evidenceCount,
         i.sessionId = $sessionId,
         i.createdAt = $createdAt,
         i.engine = 'graphrag',
         i.model = $model,
         i.synthesisStatus = $synthesisStatus,
         i.evidenceQuality = $evidenceQuality,
         i.reportJson = $reportJson,
         i.demo = false
     MERGE (i)-[:INVESTIGATED]->(r)
     RETURN i.id`,
    {
      id: report.id,
      repoId: report.repoFullName.toLowerCase(),
      repoFullName: report.repoFullName,
      branch: report.branch,
      question: report.question,
      status: report.status,
      summary: report.summary,
      confidence: report.evidenceQuality.confidence,
      evidenceCount: report.evidence.length,
      sessionId,
      createdAt: report.createdAt,
      model: report.synthesis.model,
      synthesisStatus: report.synthesis.status,
      caseNumber: caseNo,
      evidenceQuality: report.evidenceQuality.label,
      reportJson: JSON.stringify(report),
    },
  );

  if (report.evidence.length) {
    await writeQuery(
      `MATCH (i:Investigation {id: $id, sessionId: $sessionId})
       UNWIND $evidenceIds AS evidenceId
       MATCH (n {repositoryId: $repoId})
       WHERE n.id = evidenceId
       MERGE (n)-[:SUPPORTS]->(i)`,
      {
        id: report.id,
        sessionId,
        repoId: report.repoFullName.toLowerCase(),
        evidenceIds: report.evidence.map((item) => item.id),
      },
    );
  }

  return {
    id: report.id,
    repoFullName: report.repoFullName,
    question: report.question,
    status: report.status,
    synthesisStatus: report.synthesis.status,
    createdAt: report.createdAt,
    confidence: report.evidenceQuality.confidence,
    evidenceCount: report.evidence.length,
    summary: report.summary,
  };
}

export async function readInvestigation(id: string, sessionId: string): Promise<InvestigationReport | null> {
  await ensureSchema();
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (i:Investigation {id: $id, sessionId: $sessionId})
     RETURN i.reportJson AS reportJson`,
    { id, sessionId },
  );
  if (!rows.length) return null;
  return safeJson<InvestigationReport | null>(asString(rows[0].reportJson), null);
}

export async function listInvestigations(sessionId: string, limit = 60): Promise<CaseFileSummary[]> {
  await ensureSchema();
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (i:Investigation {sessionId: $sessionId})
     RETURN i.id AS id, i.repoFullName AS repoFullName, i.question AS question, i.status AS status,
            i.synthesisStatus AS synthesisStatus, i.createdAt AS createdAt, i.confidence AS confidence,
            i.evidenceCount AS evidenceCount, i.summary AS summary
     ORDER BY i.createdAt DESC LIMIT $limit`,
    { sessionId, limit: neo4jInt(Math.max(1, Math.floor(limit))) },
  );
  return rows.map((row) => ({
    id: asString(row.id),
    repoFullName: asString(row.repoFullName),
    question: asString(row.question),
    status: (asString(row.status) as CaseFileSummary["status"]) || "insufficient",
    synthesisStatus: row.synthesisStatus === "completed" || row.synthesisStatus === "unavailable" || row.synthesisStatus === "not_configured"
      ? row.synthesisStatus
      : undefined,
    createdAt: asString(row.createdAt),
    confidence: asNumber(row.confidence),
    evidenceCount: asNumber(row.evidenceCount),
    summary: asString(row.summary),
  }));
}

export async function deleteInvestigation(id: string, sessionId: string): Promise<boolean> {
  await ensureSchema();
  const rows = await readQuery<Record<string, unknown>>(
    `MATCH (i:Investigation {id: $id, sessionId: $sessionId})
     WITH collect(i) AS matches, count(i) AS deletedCount
     FOREACH (node IN matches | DETACH DELETE node)
     RETURN deletedCount`,
    { id, sessionId },
  );
  return asNumber(rows[0]?.deletedCount) > 0;
}
