import { beforeEach, describe, expect, it, vi } from "vitest";
import { ABSTENTION } from "@/lib/server/gemini";
import { DEMO_REPORT } from "@/lib/demo-data";
import { classifyInvestigationStatus } from "@/lib/report-status";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  configured: true,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
  isGeminiConfigured: () => mocks.configured,
}));

import { synthesizeInvestigation } from "@/lib/server/gemini";

const input = {
  question: DEMO_REPORT.question,
  repoFullName: DEMO_REPORT.repoFullName,
  branch: DEMO_REPORT.branch,
  evidence: DEMO_REPORT.evidence,
  relationships: DEMO_REPORT.graph.edges.map((edge) => ({ type: edge.type, source: edge.source, target: edge.target })),
  supersessionHint: "ACTIVE — demo fixture",
};

const citedId = DEMO_REPORT.evidence[0].id;

beforeEach(() => {
  mocks.generateContent.mockReset();
  mocks.configured = true;
});

describe("Gemini synthesis states", () => {
  it("preserves successful synthesis with validated claims and citations", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: "The five-attempt cap was explicitly documented as a bounded retry guard.",
        documentedRationale: [
          { text: "The cap is explicitly documented as a bounded retry guard.", evidenceIds: [citedId] },
        ],
        technicalObservations: [],
        inferences: [],
        uncertainties: ["The exact number five is not explained."],
        supersessionStatus: "active",
        supersessionNote: "The source states the decision is active.",
      }),
    });

    const result = await synthesizeInvestigation(input);
    expect(result.synthesis.status).toBe("completed");
    expect(result.synthesis.model).toBe("gemini-test");
    expect(result.documentedRationale).toHaveLength(1);
    expect(result.documentedRationale[0].evidenceIds).toEqual([citedId]);
    expect(result.citations).toHaveLength(1);
    expect(
      classifyInvestigationStatus({
        synthesisStatus: result.synthesis.status,
        claimsCount: result.documentedRationale.length + result.technicalObservations.length + result.inferences.length,
        modelAbstained: result.summary.trim() === ABSTENTION,
        evidenceCount: input.evidence.length,
        directCount: input.evidence.filter((item) => item.direct).length,
        keywordCount: 3,
      }),
    ).toBe("answered");
  });

  it("returns a quote-only evidence report when the Gemini API fails", async () => {
    mocks.generateContent.mockRejectedValue(new Error("Gemini API returned 503 UNAVAILABLE"));

    const result = await synthesizeInvestigation(input);
    expect(result.synthesis.status).toBe("unavailable");
    expect(result.summary).toContain("Evidence retrieved — AI interpretation unavailable");
    expect(result.documentedRationale).toEqual([]);
    expect(result.technicalObservations).toEqual([]);
    expect(result.inferences).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.uncertainties.join(" ")).toContain("source material only");
    expect(
      classifyInvestigationStatus({
        synthesisStatus: result.synthesis.status,
        claimsCount: 0,
        modelAbstained: false,
        evidenceCount: input.evidence.length,
        directCount: input.evidence.filter((item) => item.direct).length,
        keywordCount: 3,
      }),
    ).toBe("evidence_only");
  });

  it("distinguishes an unconfigured Gemini key from an API failure", async () => {
    mocks.configured = false;

    const result = await synthesizeInvestigation(input);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(result.synthesis.status).toBe("not_configured");
    expect(result.synthesis.model).toBeNull();
    expect(result.summary).toContain("Evidence retrieved — AI interpretation unavailable");
    expect(result.summary).toContain("Gemini is not configured");
    expect(result.documentedRationale).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(
      classifyInvestigationStatus({
        synthesisStatus: result.synthesis.status,
        claimsCount: 0,
        modelAbstained: false,
        evidenceCount: input.evidence.length,
        directCount: input.evidence.filter((item) => item.direct).length,
        keywordCount: 3,
      }),
    ).toBe("synthesis_not_configured");
  });

  it("abstains without calling Gemini when graph retrieval returns no evidence", async () => {
    const result = await synthesizeInvestigation({ ...input, evidence: [] });
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(result.summary).toBe(ABSTENTION);
    expect(result.synthesis.status).toBe("unavailable");
    expect(result.documentedRationale).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(
      classifyInvestigationStatus({
        synthesisStatus: result.synthesis.status,
        claimsCount: 0,
        modelAbstained: true,
        evidenceCount: 0,
        directCount: 0,
        keywordCount: 3,
      }),
    ).toBe("insufficient");
  });
});
