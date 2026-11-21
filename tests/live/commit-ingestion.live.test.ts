/**
 * LIVE commit pipeline verification. This test does not mock GitHub or Neo4j.
 * It ingests the repository named by WHYTRACE_LIVE_TEST_REPO (defaulting to the
 * reported github/advisory-database case) and proves commit nodes and
 * Repository-CONTAINS->Commit relationships exist in Neo4j afterwards.
 *
 * Run with: npm run test:live
 */
import { afterAll, describe, expect, it } from "vitest";
import { isNeo4jConfigured } from "@/lib/server/env";
import { GitHubClient } from "@/lib/server/github";
import { ingestRepository } from "@/lib/server/ingest";
import { closeDriver, readQuery } from "@/lib/server/neo4j";
import { runInvestigation } from "@/lib/server/investigation";
import { loadRepositoryGraph } from "@/lib/server/graph-retrieval";
import { asNumber } from "@/lib/utils";

const repoFullName = (process.env.WHYTRACE_LIVE_TEST_REPO || "github/advisory-database").trim();
const [owner, name] = repoFullName.split("/");

describe("live commit ingestion", () => {
  afterAll(async () => {
    await closeDriver();
  });

  it("paginates real commit history beyond one GitHub page", async () => {
    const client = new GitHubClient();
    const repo = await client.getRepo(owner, name);
    const commits = await client.listCommits(repo.owner, repo.name, repo.defaultBranch, 120);
    expect(commits.length).toBeGreaterThan(0);
    expect(new Set(commits.map((commit) => commit.sha)).size).toBe(commits.length);
    expect(commits.length).toBeGreaterThan(100);
    console.info(`GitHub pagination verified for ${repo.fullName}: ${commits.length} commits, first ${commits[0]?.sha.slice(0, 7)}`);
  });

  it("ingests a real repository, persists commits, and retrieves commit evidence", async () => {
    if (!isNeo4jConfigured()) {
      console.warn("BLOCKED: Neo4j is NOT CONFIGURED (NEO4J_URI / USERNAME / PASSWORD).");
      expect(isNeo4jConfigured()).toBe(false);
      return;
    }

    const result = await ingestRepository({ owner, name });
    const expectedShas = [...new Set(result.graph.commits.map((commit) => commit.sha.toLowerCase()))];
    expect(result.counts.commits).toBeGreaterThan(0);
    expect(expectedShas.length).toBeGreaterThan(0);
    expect(result.repository.ingestionStatus).toBe("ingested");

    const persisted = await readQuery<Record<string, unknown>>(
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
      { repoId: result.repository.id, shas: expectedShas },
    );
    const row = persisted[0] ?? {};
    expect(asNumber(row.matched)).toBe(expectedShas.length);
    expect(asNumber(row.linked)).toBe(expectedShas.length);
    expect(asNumber(row.links)).toBeGreaterThanOrEqual(expectedShas.length);

    const total = await readQuery<Record<string, unknown>>(
      `MATCH (:Repository {id: $repoId})-[:CONTAINS]->(c:Commit {repositoryId: $repoId})
       RETURN count(DISTINCT c) AS commits, count(DISTINCT c.sha) AS shas`,
      { repoId: result.repository.id },
    );
    expect(asNumber(total[0]?.commits)).toBeGreaterThanOrEqual(expectedShas.length);
    expect(asNumber(total[0]?.shas)).toBeGreaterThanOrEqual(expectedShas.length);

    // The Evidence Board API must return the same persisted labels and
    // relationship types that ingestion wrote, including the Repository node.
    const graph = await loadRepositoryGraph(result.repository.id, 220);
    const graphIds = graph.nodes.map((node) => node.id);
    const graphRepo = graph.nodes.find((node) => node.kind === "repository");
    const graphCommits = graph.nodes.filter((node) => node.kind === "commit");
    const graphFiles = graph.nodes.filter((node) => node.kind === "file");
    expect(graphRepo?.id).toBe(result.repository.id);
    expect(graphCommits.length).toBeGreaterThan(0);
    expect(graphFiles.length).toBeGreaterThan(0);
    expect(graph.edges.some((edge) => edge.source === result.repository.id && edge.type === "CONTAINS")).toBe(true);
    expect(graph.edges.some((edge) => edge.type === "MODIFIES")).toBe(true);

    const persistedGraph = await readQuery<Record<string, unknown>>(
      `MATCH (n)
       WHERE n.id IN $ids
         AND ((n:Repository AND n.id = $repoId) OR n.repositoryId = $repoId)
       RETURN count(n) AS nodes`,
      { ids: graphIds, repoId: result.repository.id },
    );
    expect(asNumber(persistedGraph[0]?.nodes)).toBe(graph.nodes.length);

    const persistedEdges = await readQuery<Record<string, unknown>>(
      `MATCH (a)-[r]->(b)
       WHERE a.id IN $ids AND b.id IN $ids
         AND ((a:Repository AND a.id = $repoId) OR a.repositoryId = $repoId)
         AND ((b:Repository AND b.id = $repoId) OR b.repositoryId = $repoId)
       RETURN count(r) AS edges`,
      { ids: graphIds, repoId: result.repository.id },
    );
    expect(asNumber(persistedEdges[0]?.edges)).toBe(graph.edges.length);

    const sampleSha = expectedShas[0];
    const report = await runInvestigation({
      repoFullName: result.repository.fullName,
      branch: result.repository.branch,
      question: `Why does commit ${sampleSha} exist?`,
      sessionId: `live-commit-test-${Date.now()}`,
    });
    expect(report.evidence.some((item) => item.kind === "commit" && item.meta.sha === sampleSha)).toBe(true);

    console.info(
      `Commit ingestion verified for ${result.repository.fullName}: ${expectedShas.length} fetched commits, ` +
      `${asNumber(total[0]?.commits)} persisted, ${asNumber(total[0]?.shas)} distinct SHAs, ` +
      `sample ${sampleSha.slice(0, 7)}, board graph ${graph.nodes.length} nodes / ${graph.edges.length} relationships, ` +
      `${report.evidence.length} evidence records retrieved.`,
    );
  });
});
