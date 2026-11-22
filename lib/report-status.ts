import type { InvestigationReport, InvestigationStatus, SynthesisState } from "@/lib/types";

export type ReportClassification = Exclude<InvestigationStatus, "failed">;

export interface ReportStatusView {
  status: ReportClassification;
  hasInterpretation: boolean;
  isAnswered: boolean;
  isEvidenceOnly: boolean;
  isSynthesisNotConfigured: boolean;
  isInsufficient: boolean;
}

export interface InvestigationClassificationInput {
  synthesisStatus: SynthesisState["status"];
  claimsCount: number;
  modelAbstained: boolean;
  evidenceCount: number;
  directCount: number;
  keywordCount: number;
}

/**
 * Single source of truth for report classification.
 *
 * A quote-only fallback must never reach `answered`: only a completed Gemini
 * response that retained at least one cited claim and passed the weak-evidence
 * guard qualifies.
 */
export function classifyInvestigationStatus(input: InvestigationClassificationInput): ReportClassification {
  if (input.evidenceCount === 0) return "insufficient";
  if (input.synthesisStatus !== "completed") {
    return input.synthesisStatus === "not_configured" ? "synthesis_not_configured" : "evidence_only";
  }
  const weakRetrieval =
    input.directCount === 0 &&
    input.keywordCount > 0 &&
    input.evidenceCount < 3;
  if (input.modelAbstained || input.claimsCount === 0 || weakRetrieval) return "insufficient";
  return "answered";
}

function claimCount(report: Pick<InvestigationReport, "documentedRationale" | "technicalObservations" | "inferences">): number {
  return report.documentedRationale.length + report.technicalObservations.length + report.inferences.length;
}

/**
 * Resolves the displayed classification, including legacy reports that were
 * incorrectly persisted as `answered` before the fallback fix.
 */
export function resolveReportStatus(
  report: Pick<
    InvestigationReport,
    "status" | "synthesis" | "evidence" | "documentedRationale" | "technicalObservations" | "inferences"
  >,
): ReportStatusView {
  let status: ReportClassification = report.status === "failed" ? "insufficient" : report.status;
  const claims = claimCount(report);
  const hasEvidence = report.evidence.length > 0;

  if (status === "answered" && report.synthesis.status !== "completed") {
    status = report.synthesis.status === "not_configured"
      ? "synthesis_not_configured"
      : hasEvidence
        ? "evidence_only"
        : "insufficient";
  }
  if (status === "answered" && (claims === 0 || !hasEvidence)) {
    status = "insufficient";
  }

  const hasInterpretation = status === "answered" && report.synthesis.status === "completed" && claims > 0;
  return {
    status,
    hasInterpretation,
    isAnswered: status === "answered",
    isEvidenceOnly: status === "evidence_only",
    isSynthesisNotConfigured: status === "synthesis_not_configured",
    isInsufficient: status === "insufficient",
  };
}

/** Resolve a case-list status without loading the full report. */
export function resolveCaseStatus(
  status: InvestigationStatus,
  synthesisStatus?: SynthesisState["status"],
): ReportClassification {
  if (status === "failed") return "insufficient";
  if (status === "answered" && synthesisStatus && synthesisStatus !== "completed") {
    return synthesisStatus === "not_configured" ? "synthesis_not_configured" : "evidence_only";
  }
  return status;
}
