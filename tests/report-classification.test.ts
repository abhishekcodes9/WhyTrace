import { describe, expect, it } from "vitest";
import { DEMO_REPORT } from "@/lib/demo-data";
import {
  classifyInvestigationStatus,
  resolveCaseStatus,
  resolveReportStatus,
} from "@/lib/report-status";
import type { InvestigationReport } from "@/lib/types";

function reportWith(overrides: Partial<InvestigationReport>): InvestigationReport {
  return { ...DEMO_REPORT, ...overrides };
}

describe("investigation report classification", () => {
  it("classifies a completed synthesis with validated claims as answered", () => {
    expect(
      classifyInvestigationStatus({
        synthesisStatus: "completed",
        claimsCount: 2,
        modelAbstained: false,
        evidenceCount: 8,
        directCount: 3,
        keywordCount: 4,
      }),
    ).toBe("answered");
    expect(resolveReportStatus(DEMO_REPORT)).toMatchObject({
      status: "answered",
      hasInterpretation: true,
      isAnswered: true,
    });
  });

  it("never classifies an unavailable-synthesis quote fallback as answered", () => {
    const legacyFallback = reportWith({
      status: "answered",
      synthesis: {
        provider: "gemini",
        status: "unavailable",
        model: "gemini-test",
        message: "Gemini failed; evidence only.",
      },
      documentedRationale: [
        { text: "Quoted raw commit message", evidenceIds: [DEMO_REPORT.evidence[0].id] },
      ],
      technicalObservations: [],
      inferences: [],
    });
    expect(
      classifyInvestigationStatus({
        synthesisStatus: "unavailable",
        claimsCount: 1,
        modelAbstained: false,
        evidenceCount: 8,
        directCount: 2,
        keywordCount: 3,
      }),
    ).toBe("evidence_only");
    expect(resolveReportStatus(legacyFallback)).toMatchObject({
      status: "evidence_only",
      hasInterpretation: false,
      isAnswered: false,
      isEvidenceOnly: true,
    });
  });

  it("distinguishes synthesis not configured from synthesis failure", () => {
    expect(
      classifyInvestigationStatus({
        synthesisStatus: "not_configured",
        claimsCount: 0,
        modelAbstained: false,
        evidenceCount: 8,
        directCount: 2,
        keywordCount: 3,
      }),
    ).toBe("synthesis_not_configured");
    expect(
      resolveReportStatus(reportWith({
        status: "answered",
        synthesis: {
          provider: "gemini",
          status: "not_configured",
          model: null,
          message: "Gemini is not configured.",
        },
      })),
    ).toMatchObject({ status: "synthesis_not_configured", hasInterpretation: false });
  });

  it("keeps an empty graph as insufficient, even when synthesis is unavailable", () => {
    expect(
      classifyInvestigationStatus({
        synthesisStatus: "unavailable",
        claimsCount: 0,
        modelAbstained: false,
        evidenceCount: 0,
        directCount: 0,
        keywordCount: 3,
      }),
    ).toBe("insufficient");
    expect(
      classifyInvestigationStatus({
        synthesisStatus: "not_configured",
        claimsCount: 0,
        modelAbstained: false,
        evidenceCount: 0,
        directCount: 0,
        keywordCount: 3,
      }),
    ).toBe("insufficient");
    expect(resolveReportStatus(reportWith({
      status: "insufficient",
      evidence: [],
      documentedRationale: [],
      technicalObservations: [],
      inferences: [],
      synthesis: {
        provider: "gemini",
        status: "unavailable",
        model: null,
        message: "No evidence was retrieved.",
      },
    }))).toMatchObject({ status: "insufficient", hasInterpretation: false });
  });

  it("treats weak direct evidence as insufficient rather than a documented answer", () => {
    expect(
      classifyInvestigationStatus({
        synthesisStatus: "completed",
        claimsCount: 1,
        modelAbstained: false,
        evidenceCount: 2,
        directCount: 0,
        keywordCount: 3,
      }),
    ).toBe("insufficient");
  });

  it("resolves legacy case-list statuses using persisted synthesis state", () => {
    expect(resolveCaseStatus("answered", "unavailable")).toBe("evidence_only");
    expect(resolveCaseStatus("answered", "not_configured")).toBe("synthesis_not_configured");
    expect(resolveCaseStatus("answered", "completed")).toBe("answered");
    expect(resolveCaseStatus("insufficient", "unavailable")).toBe("insufficient");
  });
});
