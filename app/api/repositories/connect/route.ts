import { NextResponse } from "next/server";
import type { ConnectResponse, GraphCounts, RepositorySummary } from "@/lib/types";
import { connectSchema, parseGitHubRepoUrl } from "@/lib/validation";
import { errorResponse, noStoreHeaders } from "@/lib/server/http";
import { GitHubClient } from "@/lib/server/github";
import { getRepository } from "@/lib/server/repository";
import { verifyNeo4j, Neo4jNotConfiguredError } from "@/lib/server/neo4j";
import { isNeo4jConfigured } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { url } = connectSchema.parse(body);
    const parsed = parseGitHubRepoUrl(url);
    const client = new GitHubClient();
    const repo = await client.getRepo(parsed.owner, parsed.name);
    const rateLimit = await client.fetchRateLimit();

    let alreadyIndexed = false;
    let existingCounts: GraphCounts | undefined;
    let existingIngestedAt: string | null = null;
    let neo4jVerified = false;
    let neo4jMessage = "Neo4j is not configured.";
    if (isNeo4jConfigured()) {
      const health = await verifyNeo4j();
      neo4jVerified = health.connected;
      neo4jMessage = health.message;
      if (health.connected) {
        try {
          const existing = await getRepository(repo.fullName);
          alreadyIndexed = Boolean(
            existing?.counts?.commits &&
            existing.ingestionStatus !== "running" &&
            existing.ingestionStatus !== "failed",
          );
          if (alreadyIndexed && existing) {
            existingCounts = existing.counts;
            existingIngestedAt = existing.ingestedAt ?? null;
          }
        } catch (error) {
          neo4jVerified = false;
          neo4jMessage = error instanceof Error ? error.message : "Neo4j read failed.";
        }
      }
    } else {
      neo4jMessage = new Neo4jNotConfiguredError().message;
    }

    const repository: RepositorySummary = {
      id: repo.fullName.toLowerCase(),
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      url: repo.url,
      branch: repo.defaultBranch,
      defaultBranch: repo.defaultBranch,
      description: repo.description,
      private: repo.private,
      stars: repo.stars,
      language: repo.language,
      ingestedAt: existingIngestedAt,
      counts: existingCounts,
    };

    const response: ConnectResponse = {
      repository,
      alreadyIndexed,
      neo4jVerified,
      neo4jMessage,
      rateLimit,
    };
    return NextResponse.json(response, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
