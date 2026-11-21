import { z } from "zod";

/** GitHub owner names: alphanumeric or hyphen. Repository names may contain . _ - */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,160}$/;

export interface ParsedRepoUrl {
  owner: string;
  name: string;
  fullName: string;
  canonicalUrl: string;
}

export class RepoUrlError extends Error {
  code: "INVALID_URL" | "INVALID_HOST" | "INVALID_PATH";
  constructor(code: RepoUrlError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "RepoUrlError";
  }
}

/**
 * Strictly parses a GitHub repository URL. Rejects other hosts, credentials,
 * ports, query strings and paths that are not exactly /owner/repository.
 */
export function parseGitHubRepoUrl(input: string): ParsedRepoUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new RepoUrlError("INVALID_URL", "Enter a GitHub repository URL.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RepoUrlError("INVALID_URL", "That is not a valid URL. Use https://github.com/owner/repository.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RepoUrlError("INVALID_URL", "Repository URLs must use http or https.");
  }
  if (url.username || url.password) {
    throw new RepoUrlError("INVALID_URL", "Credentials are not allowed in the repository URL.");
  }
  if (url.hostname.toLowerCase() !== "github.com" && url.hostname.toLowerCase() !== "www.github.com") {
    throw new RepoUrlError("INVALID_HOST", "WHYTRACE only connects to repositories hosted on github.com.");
  }
  if (url.port) {
    throw new RepoUrlError("INVALID_URL", "Repository URLs must not include a port.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new RepoUrlError("INVALID_PATH", "Use the repository root URL: https://github.com/owner/repository.");
  }

  const rawOwner = segments[0];
  let rawName = segments[1];
  if (rawName.toLowerCase().endsWith(".git")) rawName = rawName.slice(0, -4);

  if (!OWNER_RE.test(rawOwner)) {
    throw new RepoUrlError("INVALID_PATH", "The GitHub owner name is not valid.");
  }
  if (!REPO_RE.test(rawName) || rawName === "." || rawName === "..") {
    throw new RepoUrlError("INVALID_PATH", "The GitHub repository name is not valid.");
  }

  return {
    owner: rawOwner,
    name: rawName,
    fullName: `${rawOwner}/${rawName}`,
    canonicalUrl: `https://github.com/${rawOwner}/${rawName}`,
  };
}

export function isValidRepositoryFullName(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && OWNER_RE.test(parts[0]) && REPO_RE.test(parts[1] ?? "");
}

export function isValidBranch(value: string): boolean {
  return BRANCH_RE.test(value) && !value.includes("..") && !value.startsWith("/") && !value.endsWith("/");
}

export const connectSchema = z.object({
  url: z.string().trim().min(8).max(300),
});

export const ingestSchema = z.object({
  url: z.string().trim().min(8).max(300).optional(),
  fullName: z.string().trim().min(3).max(140).optional(),
  branch: z.string().trim().max(160).optional(),
});

export const investigateSchema = z.object({
  repoFullName: z.string().trim().min(3).max(140),
  branch: z.string().trim().max(160).optional(),
  question: z.string().trim().min(8, "Ask a more specific question.").max(1000),
  focus: z
    .union([
      z.object({ type: z.literal("file"), value: z.string().trim().min(1).max(400) }),
      z.object({ type: z.literal("commit"), value: z.string().trim().min(4).max(64) }),
      z.object({ type: z.literal("pullRequest"), value: z.string().trim().min(1).max(20) }),
      z.object({ type: z.literal("issue"), value: z.string().trim().min(1).max(20) }),
    ])
    .optional(),
});

export const graphQuerySchema = z.object({
  repoFullName: z.string().trim().min(3).max(140),
  investigationId: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(10).max(400).optional(),
  kinds: z.string().trim().max(300).optional(),
});

export const repositoryQuerySchema = z.object({
  fullName: z.string().trim().min(3).max(140),
});
