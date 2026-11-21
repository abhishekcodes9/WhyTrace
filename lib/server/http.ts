import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { GitHubError } from "./github";
import { Neo4jNotConfiguredError, Neo4jUnavailableError } from "./neo4j";
import { RepositoryEmptyError, RepositoryIngestionFailedError, RepositoryIngestionInProgressError, RepositoryNotIngestedError } from "./investigation";
import { RepoUrlError } from "@/lib/validation";

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: string[];
}

function statusFor(error: unknown): number {
  if (error instanceof RepoUrlError) return 400;
  if (error instanceof ZodError) return 400;
  if (error instanceof RepositoryNotIngestedError) return 409;
  if (error instanceof RepositoryIngestionInProgressError) return 409;
  if (error instanceof RepositoryIngestionFailedError) return 422;
  if (error instanceof RepositoryEmptyError) return 422;
  if (error instanceof Neo4jNotConfiguredError) return 503;
  if (error instanceof Neo4jUnavailableError) return 503;
  if (error instanceof GitHubError) {
    switch (error.code) {
      case "NOT_FOUND":
      case "PRIVATE_ACCESS":
        return 404;
      case "UNAUTHORIZED":
      case "FORBIDDEN":
        return 403;
      case "RATE_LIMITED":
        return 429;
      case "EMPTY_REPOSITORY":
        return 422;
      case "TIMEOUT":
        return 504;
      case "NETWORK":
        return 502;
      default:
        return 502;
    }
  }
  return 500;
}

export function userMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join(" ");
  }
  if (error instanceof Error) {
    // Strip anything that looks like a credential if a library included one.
    return error.message
      .replace(/(?:password|token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
      .slice(0, 900);
  }
  return "An unexpected server error occurred.";
}

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  const status = statusFor(error);
  const body: ApiErrorBody = {
    error: userMessage(error),
    code: typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : undefined,
  };
  if (error instanceof ZodError) {
    body.details = error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
  }
  return NextResponse.json(body, { status });
}

export function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store, max-age=0" };
}
