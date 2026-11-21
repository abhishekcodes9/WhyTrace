import { describe, expect, it } from "vitest";
import { DEMO_CASE, DEMO_REPORT, demoGraph } from "@/lib/demo-data";
import { parseQueryPlan } from "@/lib/server/graph-retrieval";

describe("DEMO DATA integrity", () => {
  it("is explicitly labelled as synthetic", () => {
    expect(DEMO_REPORT.demo).toBe(true);
    expect(DEMO_CASE.demo).toBe(true);
    expect(DEMO_REPORT.summary.toLowerCase()).not.toContain("real github");
    expect(DEMO_REPORT.uncertainties[0]).toContain("DEMO DATA");
    expect(DEMO_REPORT.synthesis.message).toContain("DEMO DATA");
  });

  it("has internally consistent graph node and edge identifiers", () => {
    const graph = demoGraph();
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(ids.size).toBe(graph.nodes.length);
    for (const edge of graph.edges) {
      expect(ids.has(edge.source), `missing source ${edge.source}`).toBe(true);
      expect(ids.has(edge.target), `missing target ${edge.target}`).toBe(true);
    }
  });

  it("only cites evidence that exists in the evidence package and graph", () => {
    const evidenceIds = new Set(DEMO_REPORT.evidence.map((item) => item.id));
    const graphIds = new Set(DEMO_REPORT.graph.nodes.map((node) => node.id));
    for (const claim of [
      ...DEMO_REPORT.documentedRationale,
      ...DEMO_REPORT.technicalObservations,
      ...DEMO_REPORT.inferences,
    ]) {
      expect(claim.evidenceIds.length).toBeGreaterThan(0);
      for (const id of claim.evidenceIds) {
        expect(evidenceIds.has(id), `claim cites missing evidence ${id}`).toBe(true);
        expect(graphIds.has(id), `claim cites missing graph node ${id}`).toBe(true);
      }
    }
    for (const citation of DEMO_REPORT.citations) {
      expect(evidenceIds.has(citation.evidenceId)).toBe(true);
    }
  });

  it("does not expose fabricated external URLs", () => {
    for (const item of DEMO_REPORT.evidence) expect(item.url).toBeNull();
    for (const node of DEMO_REPORT.graph.nodes) expect(node.url).toBeNull();
  });
});

describe("query plan parsing", () => {
  it("extracts files, SHAs, numbers and keywords", () => {
    const plan = parseQueryPlan(
      'Why did commit 8f3a91c change "router cache" in src/auth/tokenStore.ts and reference PR #412 / issue #388?',
    );
    expect(plan.filePaths).toContain("src/auth/tokenStore.ts");
    expect(plan.shas).toContain("8f3a91c");
    expect(plan.numbers).toEqual(expect.arrayContaining([412, 388]));
    expect(plan.quoted).toContain("router cache");
    expect(plan.keywords.length).toBeGreaterThan(0);
  });

  it("produces an empty plan for a question with no meaningful terms", () => {
    const plan = parseQueryPlan("Why?");
    expect(plan.keywords).toEqual([]);
    expect(plan.filePaths).toEqual([]);
  });
});
