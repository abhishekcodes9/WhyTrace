import { describe, expect, it } from "vitest";
import { ABSTENTION, synthesizeInvestigation } from "@/lib/server/gemini";
import { DEMO_REPORT } from "@/lib/demo-data";
import { isGeminiConfigured } from "@/lib/server/env";

describe("deterministic evidence-grounded fallback", () => {
  it("never claims successful Gemini synthesis when the key is absent", async () => {
    if (isGeminiConfigured()) {
      // Live credentials are outside the unit test contract.
      expect(true).toBe(true);
      return;
    }
    const result = await synthesizeInvestigation({
      question: "Why was the retry limit introduced?",
      repoFullName: DEMO_REPORT.repoFullName,
      branch: DEMO_REPORT.branch,
      evidence: DEMO_REPORT.evidence,
      relationships: DEMO_REPORT.graph.edges.map((edge) => ({ type: edge.type, source: edge.source, target: edge.target })),
      supersessionHint: "ACTIVE — demo fixture",
    });
    expect(result.synthesis.status).toBe("not_configured");
    expect(result.summary).not.toBe(ABSTENTION);
    expect(result.documentedRationale.length).toBeGreaterThan(0);
    const evidenceIds = new Set(DEMO_REPORT.evidence.map((item) => item.id));
    for (const claim of result.documentedRationale) {
      expect(claim.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
    for (const citation of result.citations) {
      expect(evidenceIds.has(citation.evidenceId)).toBe(true);
    }
  });

  it("abstains when graph retrieval returns no evidence", async () => {
    const result = await synthesizeInvestigation({
      question: "Why does this exist?",
      repoFullName: "example/missing",
      branch: "main",
      evidence: [],
      relationships: [],
      supersessionHint: "UNKNOWN — no evidence",
    });
    expect(result.summary).toBe(ABSTENTION);
    expect(result.documentedRationale).toEqual([]);
    expect(result.synthesis.status).toBe("unavailable");
  });
});
