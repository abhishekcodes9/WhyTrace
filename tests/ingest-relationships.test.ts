import { describe, expect, it } from "vitest";
import {
  aggregateDiscussComments,
  dedupeRelationshipRows,
  formatRelationshipDiagnostics,
  planRelationships,
  relationshipKey,
  type RelationshipGroup,
} from "@/lib/server/ingest-relationships";
import { nodeId } from "@/lib/server/repository";
import { extractReferences } from "@/lib/server/text-extraction";

const repo = "acme/widgets";
const otherRepo = "acme/gadgets";

function idsByLabel(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([label, ids]) => [label, new Set(ids)]));
}

describe("comment relationships", () => {
  it("collapses multiple comments by the same author on one PR into one relationship", () => {
    const result = aggregateDiscussComments(repo, "pull", 42, [
      { id: "c1", authorLogin: "ada", url: "https://github.com/acme/widgets/pull/42#c1", createdAt: "2024-01-01T10:00:00Z" },
      { id: "c2", authorLogin: "ada", url: "https://github.com/acme/widgets/pull/42#c2", createdAt: "2024-01-02T10:00:00Z" },
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].from).toBe(nodeId(repo, "developer", "ada"));
    expect(result.rows[0].to).toBe(nodeId(repo, "pull", 42));
    expect(result.rows[0].props).toMatchObject({
      via: "comment",
      commentCount: 2,
      firstCommentAt: "2024-01-01T10:00:00Z",
      lastCommentAt: "2024-01-02T10:00:00Z",
    });
    expect(result.rows[0].props?.commentUrls).toEqual([
      "https://github.com/acme/widgets/pull/42#c1",
      "https://github.com/acme/widgets/pull/42#c2",
    ]);
    expect(result.duplicateInputRows).toBe(1);
  });

  it("keeps one relationship per distinct author on the same PR", () => {
    const result = aggregateDiscussComments(repo, "pull", 42, [
      { id: "c1", authorLogin: "ada", url: "u1", createdAt: "2024-01-01T10:00:00Z" },
      { id: "c2", authorLogin: "grace", url: "u2", createdAt: "2024-01-01T11:00:00Z" },
      { id: "c3", authorLogin: "ada", url: "u3", createdAt: "2024-01-01T12:00:00Z" },
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.from).sort()).toEqual([
      nodeId(repo, "developer", "ada"),
      nodeId(repo, "developer", "grace"),
    ]);
    expect(result.duplicateInputRows).toBe(1);
  });

  it("keeps the same author distinct across different PRs", () => {
    const first = aggregateDiscussComments(repo, "pull", 42, [
      { id: "c1", authorLogin: "ada", url: "u1", createdAt: "2024-01-01T10:00:00Z" },
    ]);
    const second = aggregateDiscussComments(repo, "pull", 43, [
      { id: "c2", authorLogin: "ada", url: "u2", createdAt: "2024-01-01T11:00:00Z" },
    ]);
    const combined = [...first.rows, ...second.rows];

    expect(combined).toHaveLength(2);
    expect(combined.map((row) => row.to)).toEqual([
      nodeId(repo, "pull", 42),
      nodeId(repo, "pull", 43),
    ]);
  });

  it("does not double count a repeated comment payload", () => {
    const result = aggregateDiscussComments(repo, "issue", 7, [
      { id: "same", authorLogin: "ada", url: "u1", createdAt: "2024-01-01T10:00:00Z" },
      { id: "same", authorLogin: "ada", url: "u1", createdAt: "2024-01-01T10:00:00Z" },
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].props?.commentCount).toBe(1);
    expect(result.duplicateInputRows).toBe(1);
  });
});

describe("reference extraction", () => {
  it("deduplicates repeated issue and pull references", () => {
    const refs = extractReferences(
      "Fixes #12, see #12 again, https://github.com/acme/widgets/issues/12 and https://github.com/acme/widgets/pull/12",
    );
    expect([...refs]).toEqual([12]);
  });
});

describe("relationship planning", () => {
  it("counts unique endpoint pairs and preserves merged properties", () => {
    const group: RelationshipGroup = {
      type: "MODIFIES",
      fromLabel: "Commit",
      toLabel: "File",
      rows: [
        { from: "c1", to: "f1", props: { additions: 2 } },
        { from: "c1", to: "f1", props: { deletions: 1 } },
        { from: "c1", to: "f2" },
      ],
    };
    const plan = planRelationships([group], idsByLabel({ Commit: ["c1"], File: ["f1", "f2"] }));

    expect(plan.expectedTotal).toBe(2);
    expect(plan.expectedByType.MODIFIES).toBe(2);
    expect(plan.duplicateInputRows).toBe(1);
    expect(plan.groups[0].rows[0].props).toEqual({ additions: 2, deletions: 1 });
    expect(plan.missingEndpoints).toEqual([]);
  });

  it("reports missing source and target endpoints with sample IDs", () => {
    const plan = planRelationships(
      [
        {
          type: "DISCUSSES",
          fromLabel: "Developer",
          toLabel: "PullRequest",
          rows: [
            { from: "developer:ghost", to: "pull:42" },
            { from: "developer:ada", to: "pull:missing" },
          ],
        },
      ],
      idsByLabel({ Developer: ["developer:ada"], PullRequest: ["pull:42"] }),
    );

    expect(plan.expectedTotal).toBe(2);
    expect(plan.missingEndpoints).toHaveLength(1);
    expect(plan.missingEndpoints[0]).toMatchObject({
      type: "DISCUSSES",
      fromLabel: "Developer",
      toLabel: "PullRequest",
      missingSources: 1,
      missingTargets: 1,
      sampleSources: ["developer:ghost"],
      sampleTargets: ["pull:missing"],
    });
    const diagnostics = formatRelationshipDiagnostics(plan, { DISCUSSES: 1 });
    expect(diagnostics).toContain("duplicate input rows collapsed 0");
    expect(diagnostics).toContain("DISCUSSES: expected 2, persisted 1");
    expect(diagnostics).toContain("developer:ghost");
    expect(diagnostics).toContain("pull:missing");
  });

  it("uses stable keys so the same plan is idempotent on re-ingestion", () => {
    const groups: RelationshipGroup[] = [
      {
        type: "CONTAINS",
        fromLabel: "Repository",
        toLabel: "File",
        rows: [{ from: repo, to: nodeId(repo, "file", "README.md") }],
      },
    ];
    const ids = idsByLabel({ Repository: [repo], File: [nodeId(repo, "file", "README.md")] });
    const first = planRelationships(groups, ids);
    const second = planRelationships(groups, ids);

    expect(first.expectedTotal).toBe(1);
    expect(second.expectedTotal).toBe(1);
    expect(second.groups[0].rows).toEqual(first.groups[0].rows);
    expect(relationshipKey("CONTAINS", first.groups[0].rows[0])).toBe(
      relationshipKey("CONTAINS", second.groups[0].rows[0]),
    );
  });

  it("keeps identical file names in different repositories separate", () => {
    const firstFile = nodeId(repo, "file", "src/index.ts");
    const secondFile = nodeId(otherRepo, "file", "src/index.ts");
    expect(firstFile).not.toBe(secondFile);

    const plan = planRelationships(
      [
        {
          type: "CONTAINS",
          fromLabel: "Repository",
          toLabel: "File",
          rows: [
            { from: repo, to: firstFile },
            { from: otherRepo, to: secondFile },
          ],
        },
      ],
      idsByLabel({ Repository: [repo, otherRepo], File: [firstFile, secondFile] }),
    );

    expect(plan.expectedTotal).toBe(2);
    expect(new Set(plan.groups[0].rows.map((row) => row.to)).size).toBe(2);
  });

  it("counts duplicate endpoint rows once even when passed repeatedly", () => {
    const rows = [
      { from: "p1", to: "c1" },
      { from: "p1", to: "c1" },
      { from: "p1", to: "c2" },
    ];
    const deduped = dedupeRelationshipRows(rows);
    expect(deduped.rows).toHaveLength(2);
    expect(deduped.duplicateInputRows).toBe(1);
  });
});
