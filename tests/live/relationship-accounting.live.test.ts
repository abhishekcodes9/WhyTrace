/**
 * LIVE relationship-accounting verification. This test writes to Neo4j and is
 * excluded from the unit suite. It proves that the expected unique relationship
 * count matches the persisted graph and that re-ingestion is idempotent.
 *
 * Run with: npm run test:live
 */
import { afterAll, describe, expect, it } from "vitest";
import { isNeo4jConfigured } from "@/lib/server/env";
import { ingestRepository } from "@/lib/server/ingest";
import { closeDriver } from "@/lib/server/neo4j";
import { readRelationshipCounts } from "@/lib/server/repository";

const repoFullName = (process.env.WHYTRACE_LIVE_RELATIONSHIP_REPO || "octocat/Hello-World").trim();
const [owner, name] = repoFullName.split("/");

describe("live relationship accounting", () => {
  afterAll(async () => {
    await closeDriver();
  });

  it("matches expected unique relationships and does not multiply them on re-ingestion", async () => {
    if (!isNeo4jConfigured()) {
      console.warn("BLOCKED: Neo4j is NOT CONFIGURED (NEO4J_URI / USERNAME / PASSWORD).");
      expect(isNeo4jConfigured()).toBe(false);
      return;
    }

    const first = await ingestRepository({ owner, name });
    expect(first.repository.ingestionStatus).toBe("ingested");
    expect(first.relationshipAudit.expectedTotal).toBeGreaterThan(0);
    expect(first.relationshipAudit.missingEndpoints).toEqual([]);

    const firstByType = await readRelationshipCounts(first.repository.id, first.ingestionRunId);
    for (const [type, expected] of Object.entries(first.relationshipAudit.expectedByType)) {
      expect(firstByType[type] ?? 0, `${type} should have ${expected} relationships from this run`).toBe(expected);
    }
    const firstTotal = Object.values(firstByType).reduce((sum, count) => sum + count, 0);
    expect(firstTotal).toBe(first.relationshipAudit.expectedTotal);
    const firstAllRuns = await readRelationshipCounts(first.repository.id);

    const second = await ingestRepository({ owner, name });
    expect(second.repository.ingestionStatus).toBe("ingested");
    expect(second.relationshipAudit.expectedTotal).toBe(first.relationshipAudit.expectedTotal);
    expect(second.relationshipAudit.expectedByType).toEqual(first.relationshipAudit.expectedByType);

    const secondByType = await readRelationshipCounts(second.repository.id, second.ingestionRunId);
    for (const [type, expected] of Object.entries(second.relationshipAudit.expectedByType)) {
      expect(secondByType[type] ?? 0, `${type} should have ${expected} relationships from the re-ingestion`).toBe(expected);
    }
    const secondAllRuns = await readRelationshipCounts(second.repository.id);
    expect(secondAllRuns).toEqual(firstAllRuns);

    console.info(
      `Relationship accounting verified for ${second.repository.fullName}: ` +
      `${second.relationshipAudit.expectedTotal} unique relationships, ` +
      `${second.relationshipAudit.duplicateInputRows} duplicate inputs collapsed, ` +
      `persisted by type ${JSON.stringify(secondByType)}, total graph by type ${JSON.stringify(secondAllRuns)}.`,
    );
  }, 180_000);
});
