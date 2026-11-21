import { NextResponse } from "next/server";
import type { Diagnostics } from "@/lib/types";
import { isGeminiConfigured, isGitHubConfigured, isNeo4jConfigured, serverEnv } from "@/lib/server/env";
import { verifyNeo4j } from "@/lib/server/neo4j";
import { GitHubClient } from "@/lib/server/github";
import { noStoreHeaders } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const neo4j = await verifyNeo4j();
  let githubMessage = isGitHubConfigured()
    ? "Server token configured for authenticated GitHub requests."
    : "No GITHUB_TOKEN configured. Public repositories use unauthenticated limits (60 requests/hour).";
  if (isGitHubConfigured()) {
    try {
      const rate = await new GitHubClient().fetchRateLimit();
      githubMessage = `Authenticated. GitHub core quota: ${rate.remaining ?? "unknown"} / ${rate.limit ?? "unknown"} remaining.`;
    } catch {
      githubMessage = "GitHub token is configured but the rate-limit probe failed.";
    }
  }
  const diagnostics: Diagnostics = {
    neo4j: {
      configured: isNeo4jConfigured(),
      connected: neo4j.connected,
      message: neo4j.message,
      database: isNeo4jConfigured() ? serverEnv.neo4jDatabase : null,
      latencyMs: neo4j.latencyMs,
    },
    github: {
      configured: isGitHubConfigured(),
      message: githubMessage,
    },
    gemini: {
      configured: isGeminiConfigured(),
      model: serverEnv.geminiModel,
      message: isGeminiConfigured()
        ? "Gemini synthesis configured server-side."
        : "No GEMINI_API_KEY configured. Reports fall back to deterministic evidence quotes.",
    },
    environment: process.env.NODE_ENV ?? "development",
  };
  return NextResponse.json(diagnostics, { headers: noStoreHeaders() });
}
