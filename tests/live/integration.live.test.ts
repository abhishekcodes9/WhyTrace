/**
 * LIVE integration checks. These are intentionally excluded from `npm test`.
 * Run with `npm run test:live` after configuring .env.local.
 *
 * A missing credential is reported as NOT CONFIGURED; these tests never mock a
 * service and never count mocked results as live verification.
 */
import { describe, expect, it } from "vitest";
import { isGeminiConfigured, isGitHubConfigured, isNeo4jConfigured, serverEnv } from "@/lib/server/env";
import { verifyNeo4j } from "@/lib/server/neo4j";
import { GitHubClient } from "@/lib/server/github";

describe("live service verification", () => {
  it("verifies Neo4j connectivity", async () => {
    if (!isNeo4jConfigured()) {
      console.warn("BLOCKED: Neo4j is NOT CONFIGURED (NEO4J_URI / USERNAME / PASSWORD).");
      expect(isNeo4jConfigured()).toBe(false);
      return;
    }
    const result = await verifyNeo4j();
    expect(result.connected, result.message).toBe(true);
  });

  it("fetches an arbitrary public GitHub repository", async () => {
    const client = new GitHubClient();
    const repo = await client.getRepo("octocat", "Hello-World");
    expect(repo.fullName.toLowerCase()).toBe("octocat/hello-world");
    expect(repo.defaultBranch.length).toBeGreaterThan(0);
    console.info(`GitHub verified: ${repo.fullName} default branch ${repo.defaultBranch}`);
    console.info(isGitHubConfigured() ? "GitHub token: configured" : "GitHub token: NOT CONFIGURED (anonymous limits)");
  });

  it("reports Gemini configuration without making a fake success claim", () => {
    if (!isGeminiConfigured()) {
      console.warn("BLOCKED: Gemini is NOT CONFIGURED (GEMINI_API_KEY).");
      expect(isGeminiConfigured()).toBe(false);
      return;
    }
    expect(serverEnv.geminiModel.length).toBeGreaterThan(0);
    console.info(`Gemini configured: ${serverEnv.geminiModel}`);
  });
});
