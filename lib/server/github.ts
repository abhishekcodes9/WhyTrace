import { serverEnv } from "./env";
import type { GitHubRateLimit } from "@/lib/types";

const API_BASE = "https://api.github.com";
const GRAPHQL_URL = "https://api.github.com/graphql";

export type GitHubErrorCode =
  | "NOT_FOUND"
  | "PRIVATE_ACCESS"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK"
  | "TIMEOUT"
  | "EMPTY_REPOSITORY"
  | "API_ERROR";

export class GitHubError extends Error {
  code: GitHubErrorCode;
  status: number | null;
  retryAt: string | null;
  constructor(code: GitHubErrorCode, message: string, status: number | null = null, retryAt: string | null = null) {
    super(message);
    this.name = "GitHubError";
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export interface GitHubRepoMeta {
  id: number;
  name: string;
  owner: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  private: boolean;
  stars: number;
  language: string | null;
  archived: boolean;
  sizeKb: number;
  avatarUrl: string | null;
}

export interface GitHubCommitListItem {
  sha: string;
  message: string;
  authorName: string | null;
  authoredAt: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorUrl: string | null;
  htmlUrl: string;
  parents: string[];
}

export interface GitHubCommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
}

export interface GitHubCommitDetail extends GitHubCommitListItem {
  additions: number;
  deletions: number;
  files: GitHubCommitFile[];
}

export interface GitHubPull {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  baseBranch: string;
  headBranch: string;
  mergeCommitSha: string | null;
  labels: string[];
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
}

export interface GitHubComment {
  id: string;
  body: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
  url: string;
  path?: string;
  line?: number;
}

export interface GitHubPrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GitHubTreeEntry {
  path: string;
  type: string;
  size: number;
}

export interface GitHubDoc {
  path: string;
  title: string;
  body: string;
  url: string;
  docType: "readme" | "adr" | "architecture" | "documentation";
}

export interface GitHubDiscussion {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  category: string | null;
  comments: GitHubComment[];
}

interface RateState {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

function parseRateLimit(headers: Headers): GitHubRateLimit {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  return {
    limit: limit ? Number(limit) : null,
    remaining: remaining ? Number(remaining) : null,
    resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
  };
}

function mapHttpError(status: number, body: string, retryAt: string | null): GitHubError {
  const lower = body.toLowerCase();
  if (status === 401) {
    return new GitHubError("UNAUTHORIZED", "GitHub rejected the configured token (HTTP 401). Verify GITHUB_TOKEN.", status);
  }
  if (status === 403 || status === 429) {
    if (lower.includes("rate limit") || status === 429 || lower.includes("secondary rate")) {
      return new GitHubError(
        "RATE_LIMITED",
        `GitHub rate limit reached. Retry after ${retryAt ? new Date(retryAt).toLocaleString("en-GB", { timeZone: "UTC" }) : "the reset window"}.`,
        status,
        retryAt,
      );
    }
    return new GitHubError("FORBIDDEN", "GitHub refused this request (HTTP 403). The token may lack permission.", status);
  }
  if (status === 404) {
    return new GitHubError(
      "NOT_FOUND",
      "Repository not found, or it is private and the server token cannot access it.",
      status,
    );
  }
  return new GitHubError("API_ERROR", `GitHub API error (HTTP ${status}).`, status);
}

export class GitHubClient {
  private rate: RateState = { limit: null, remaining: null, resetAt: null };
  readonly hasToken: boolean;

  constructor(private readonly token = serverEnv.githubToken) {
    this.hasToken = Boolean(token);
  }

  get rateLimit(): GitHubRateLimit {
    return { ...this.rate };
  }

  private headers(accept = "application/vnd.github+json"): HeadersInit {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "whytrace/1.0",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private captureRate(headers: Headers) {
    const parsed = parseRateLimit(headers);
    if (parsed.limit !== null) this.rate = parsed;
  }

  canSpend(cost = 1): boolean {
    if (!this.hasToken) return true; // still bounded by the configured limits
    return this.rate.remaining === null || this.rate.remaining > cost + 2;
  }

  async request<T>(path: string, options: { allow404?: boolean; accept?: string; method?: string; body?: string } = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers: { ...this.headers(options.accept), ...(options.body ? { "Content-Type": "application/json" } : {}) },
          body: options.body,
          signal: AbortSignal.timeout(serverEnv.limits.requestTimeoutMs),
          cache: "no-store",
        });
        this.captureRate(response.headers);
        if (response.ok) {
          const text = await response.text();
          if (!text.trim()) {
            throw new GitHubError("API_ERROR", "GitHub returned an empty response body.", response.status);
          }
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new GitHubError("API_ERROR", "GitHub returned malformed JSON.", response.status);
          }
        }
        const text = await response.text().catch(() => "");
        if (response.status === 404 && options.allow404) {
          return null as T;
        }
        const error = mapHttpError(response.status, text, this.rate.resetAt);
        const retryable = response.status === 429 || response.status >= 500 || (response.status === 403 && error.code === "RATE_LIMITED");
        if (retryable && attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const wait = Math.min(5_000, Math.max(500, retryAfter * 1000 || 800 * (attempt + 1)));
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        throw error;
      } catch (error) {
        if (error instanceof GitHubError) throw error;
        if (error instanceof DOMException && error.name === "TimeoutError") {
          if (attempt < 2) continue;
          throw new GitHubError("TIMEOUT", "GitHub did not respond within the request timeout.", null);
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
          continue;
        }
        throw new GitHubError("NETWORK", "Could not reach the GitHub API. Check the server network connection.", null);
      }
    }
    throw new GitHubError("NETWORK", "Could not reach the GitHub API after retries.", null);
  }

  async getRepo(owner: string, name: string): Promise<GitHubRepoMeta> {
    const data = await this.request<{
      id: number;
      name: string;
      full_name: string;
      html_url: string;
      default_branch: string;
      description: string | null;
      private: boolean;
      stargazers_count: number;
      language: string | null;
      archived: boolean;
      size: number;
      owner: { login: string; avatar_url: string | null };
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    if (!data.default_branch) {
      throw new GitHubError("EMPTY_REPOSITORY", "This repository has no default branch yet. It may be empty.");
    }
    return {
      id: data.id,
      name: data.name,
      owner: data.owner.login,
      fullName: data.full_name,
      url: data.html_url,
      defaultBranch: data.default_branch,
      description: data.description,
      private: data.private,
      stars: data.stargazers_count,
      language: data.language,
      archived: data.archived,
      sizeKb: data.size,
      avatarUrl: data.owner.avatar_url,
    };
  }

  async listCommits(owner: string, name: string, branch: string, limit: number): Promise<GitHubCommitListItem[]> {
    const target = Math.max(1, Math.floor(limit));
    // Keep per_page stable across pages: GitHub's page offset is based on the
    // current per_page value, so changing it between requests re-reads records.
    const perPage = Math.min(100, target);
    const commits: GitHubCommitListItem[] = [];
    const seen = new Set<string>();

    // Follow pages until the requested bound is reached, GitHub returns a short
    // page, or the repository is exhausted. A 404 is treated as an empty branch.
    for (let page = 1; commits.length < target; page += 1) {
      let data: Array<{
        sha: string;
        html_url: string;
        commit: { message: string; author: { name: string | null; date: string | null } | null };
        author: { login: string; avatar_url: string | null; html_url: string } | null;
        parents: { sha: string }[];
      }> | null;
      try {
        data = await this.request(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}&page=${page}`,
          { allow404: true },
        );
      } catch (error) {
        // Keep a partial first page rather than losing commits already fetched
        // if a later page hits the rate limit. A first-page failure still throws.
        if (commits.length > 0 && error instanceof GitHubError && error.code === "RATE_LIMITED") break;
        throw error;
      }

      if (data === null) break;
      if (!Array.isArray(data)) {
        throw new GitHubError("API_ERROR", "GitHub returned an unexpected commit-history response.", null);
      }
      if (data.length === 0) break;

      let added = 0;
      for (const item of data) {
        const sha = String(item.sha ?? "").toLowerCase();
        if (!sha || seen.has(sha)) continue;
        seen.add(sha);
        added += 1;
        commits.push({
          sha,
          message: item.commit?.message ?? "",
          authorName: item.commit?.author?.name ?? null,
          authoredAt: item.commit?.author?.date ?? null,
          authorLogin: item.author?.login ?? null,
          authorAvatarUrl: item.author?.avatar_url ?? null,
          authorUrl: item.author?.html_url ?? null,
          htmlUrl: item.html_url,
          parents: item.parents?.map((parent) => parent.sha.toLowerCase()) ?? [],
        });
        if (commits.length >= target) break;
      }

      if (added === 0 || data.length < perPage) break;
    }

    return commits.slice(0, target);
  }

  async getCommit(owner: string, name: string, sha: string): Promise<GitHubCommitDetail | null> {
    const data = await this.request<{
      sha: string;
      html_url: string;
      commit: { message: string; author: { name: string | null; date: string | null } | null };
      author: { login: string; avatar_url: string | null; html_url: string } | null;
      parents: { sha: string }[];
      stats?: { additions: number; deletions: number };
      files?: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        patch?: string;
      }>;
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${sha}`, { allow404: true });
    if (!data) return null;
    return {
      sha: data.sha.toLowerCase(),
      message: data.commit.message ?? "",
      authorName: data.commit.author?.name ?? null,
      authoredAt: data.commit.author?.date ?? null,
      authorLogin: data.author?.login ?? null,
      authorAvatarUrl: data.author?.avatar_url ?? null,
      authorUrl: data.author?.html_url ?? null,
      htmlUrl: data.html_url,
      parents: data.parents?.map((parent) => parent.sha.toLowerCase()) ?? [],
      additions: data.stats?.additions ?? 0,
      deletions: data.stats?.deletions ?? 0,
      files: (data.files ?? []).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ? file.patch.slice(0, 12_000) : null,
      })),
    };
  }

  async listPulls(owner: string, name: string, limit: number): Promise<GitHubPull[]> {
    const perPage = Math.min(100, Math.max(limit, 1));
    const data = await this.request<
      Array<{
        number: number;
        title: string;
        body: string | null;
        state: string;
        merged_at: string | null;
        created_at: string;
        updated_at: string;
        html_url: string;
        user: { login: string; avatar_url: string | null } | null;
        base: { ref: string };
        head: { ref: string };
        merge_commit_sha: string | null;
        merged?: boolean;
        labels: Array<{ name: string }>;
      }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}`, {
      allow404: true,
    });
    if (!data) return [];
    return data.slice(0, limit).map((pull) => ({
      number: pull.number,
      title: pull.title,
      body: pull.body ?? "",
      state: pull.state,
      merged: Boolean(pull.merged_at) || Boolean(pull.merged),
      mergedAt: pull.merged_at,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      htmlUrl: pull.html_url,
      authorLogin: pull.user?.login ?? null,
      authorAvatarUrl: pull.user?.avatar_url ?? null,
      baseBranch: pull.base?.ref ?? "",
      headBranch: pull.head?.ref ?? "",
      mergeCommitSha: pull.merge_commit_sha,
      labels: pull.labels?.map((label) => label.name) ?? [],
    }));
  }

  async listPullFiles(owner: string, name: string, number: number): Promise<GitHubPrFile[]> {
    const data = await this.request<
      Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/files?per_page=30`, { allow404: true });
    return (data ?? []).slice(0, 30).map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch ? file.patch.slice(0, 10_000) : null,
    }));
  }

  async listPullCommits(owner: string, name: string, number: number): Promise<{ sha: string }[]> {
    const data = await this.request<Array<{ sha: string }>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/commits?per_page=30`,
      { allow404: true },
    );
    return (data ?? []).slice(0, 30).map((commit) => ({ sha: commit.sha }));
  }

  async listPullComments(owner: string, name: string, number: number, limit: number): Promise<GitHubComment[]> {
    const [review, issue] = await Promise.all([
      this.request<
        Array<{
          id: number;
          body: string | null;
          created_at: string;
          html_url: string;
          path?: string;
          line?: number;
          user: { login: string; avatar_url: string | null } | null;
        }>
      >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/comments?per_page=${Math.max(1, limit)}`, {
        allow404: true,
      }),
      this.request<
        Array<{
          id: number;
          body: string | null;
          created_at: string;
          html_url: string;
          user: { login: string; avatar_url: string | null } | null;
        }>
      >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/comments?per_page=${Math.max(1, limit)}`, {
        allow404: true,
      }),
    ]);
    const mapped: GitHubComment[] = [
      ...(review ?? []).map((comment) => ({
        id: `review-${comment.id}`,
        body: comment.body ?? "",
        authorLogin: comment.user?.login ?? null,
        authorAvatarUrl: comment.user?.avatar_url ?? null,
        createdAt: comment.created_at,
        url: comment.html_url,
        path: comment.path,
        line: comment.line,
      })),
      ...(issue ?? []).map((comment) => ({
        id: `issue-${comment.id}`,
        body: comment.body ?? "",
        authorLogin: comment.user?.login ?? null,
        authorAvatarUrl: comment.user?.avatar_url ?? null,
        createdAt: comment.created_at,
        url: comment.html_url,
      })),
    ];
    return mapped
      .filter((comment) => comment.body.trim().length > 0)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit);
  }

  async listIssues(owner: string, name: string, limit: number): Promise<GitHubIssue[]> {
    const perPage = Math.min(100, Math.max(limit, 1));
    const data = await this.request<
      Array<{
        number: number;
        title: string;
        body: string | null;
        state: string;
        created_at: string;
        updated_at: string;
        closed_at: string | null;
        html_url: string;
        user: { login: string; avatar_url: string | null } | null;
        labels: Array<{ name: string } | string>;
        pull_request?: unknown;
      }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=all&sort=updated&direction=desc&per_page=${Math.min(100, perPage * 2)}`, {
      allow404: true,
    });
    return (data ?? [])
      .filter((issue) => !issue.pull_request)
      .slice(0, limit)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at,
        htmlUrl: issue.html_url,
        authorLogin: issue.user?.login ?? null,
        authorAvatarUrl: issue.user?.avatar_url ?? null,
        labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
      }));
  }

  async listIssueComments(owner: string, name: string, number: number, limit: number): Promise<GitHubComment[]> {
    const data = await this.request<
      Array<{
        id: number;
        body: string | null;
        created_at: string;
        html_url: string;
        user: { login: string; avatar_url: string | null } | null;
      }>
    >(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/comments?per_page=${Math.max(1, limit)}`, {
      allow404: true,
    });
    return (data ?? [])
      .filter((comment) => (comment.body ?? "").trim().length > 0)
      .slice(0, limit)
      .map((comment) => ({
        id: `issue-${comment.id}`,
        body: comment.body ?? "",
        authorLogin: comment.user?.login ?? null,
        authorAvatarUrl: comment.user?.avatar_url ?? null,
        createdAt: comment.created_at,
        url: comment.html_url,
      }));
  }

  async listTree(owner: string, name: string, branch: string): Promise<{ entries: GitHubTreeEntry[]; truncated: boolean }> {
    const data = await this.request<{
      tree: Array<{ path: string; type: string; size?: number }>;
      truncated: boolean;
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
      allow404: true,
    });
    if (!data) return { entries: [], truncated: false };
    return {
      entries: (data.tree ?? [])
        .filter((entry) => entry.type === "blob")
        .slice(0, serverEnv.limits.maxTreeEntries)
        .map((entry) => ({ path: entry.path, type: entry.type, size: entry.size ?? 0 })),
      truncated: Boolean(data.truncated),
    };
  }

  async getFile(owner: string, name: string, path: string, branch: string): Promise<{ body: string; url: string } | null> {
    const data = await this.request<{
      type: string;
      encoding: string;
      content: string;
      size: number;
      html_url: string;
    }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(branch)}`,
      { allow404: true },
    );
    if (!data || data.type !== "file") return null;
    if (data.size > serverEnv.limits.maxDocBytes) return null;
    const body = data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : data.content;
    return { body: body.slice(0, serverEnv.limits.maxDocBytes), url: data.html_url };
  }

  async listDiscussions(owner: string, name: string, limit: number): Promise<GitHubDiscussion[]> {
    if (!this.hasToken || limit <= 0) return [];
    const query = `query($owner: String!, $name: String!, $limit: Int!) {
      repository(owner: $owner, name: $name) {
        discussions(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            number
            title
            body
            createdAt
            updatedAt
            url
            author { login avatarUrl }
            category { name }
            answer { ... on DiscussionComment { body createdAt author { login } url } }
            comments(first: 5) { nodes { body createdAt author { login } url } }
          }
        }
      }
    }`;
    try {
      const response = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { owner, name, limit } }),
        signal: AbortSignal.timeout(serverEnv.limits.requestTimeoutMs),
        cache: "no-store",
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as {
        data?: {
          repository?: {
            discussions?: {
              nodes?: Array<{
                number: number;
                title: string;
                body: string;
                createdAt: string;
                updatedAt: string;
                url: string;
                author: { login: string; avatarUrl: string | null } | null;
                category: { name: string } | null;
                answer: { body: string; createdAt: string; author: { login: string } | null; url: string } | null;
                comments: { nodes: Array<{ body: string; createdAt: string; author: { login: string } | null; url: string }> };
              }>;
            };
          };
        };
        errors?: Array<{ message: string }>;
      };
      if (payload.errors?.length) return [];
      const nodes = payload.data?.repository?.discussions?.nodes ?? [];
      return nodes.slice(0, limit).map((discussion) => {
        const comments: GitHubComment[] = discussion.comments.nodes
          .filter((comment) => comment.body?.trim())
          .map((comment, index) => ({
            id: `discussion-${discussion.number}-${index}`,
            body: comment.body,
            authorLogin: comment.author?.login ?? null,
            authorAvatarUrl: null,
            createdAt: comment.createdAt,
            url: comment.url,
          }));
        if (discussion.answer) {
          comments.unshift({
            id: `discussion-answer-${discussion.number}`,
            body: discussion.answer.body,
            authorLogin: discussion.answer.author?.login ?? null,
            authorAvatarUrl: null,
            createdAt: discussion.answer.createdAt,
            url: discussion.answer.url,
          });
        }
        return {
          number: discussion.number,
          title: discussion.title,
          body: discussion.body ?? "",
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
          url: discussion.url,
          authorLogin: discussion.author?.login ?? null,
          authorAvatarUrl: discussion.author?.avatarUrl ?? null,
          category: discussion.category?.name ?? null,
          comments,
        };
      });
    } catch {
      return [];
    }
  }

  async fetchRateLimit(): Promise<GitHubRateLimit> {
    if (!this.hasToken) return { limit: 60, remaining: null, resetAt: null };
    try {
      const data = await this.request<{ resources: { core: { limit: number; remaining: number; reset: number } } }>("/rate_limit");
      this.rate = {
        limit: data.resources.core.limit,
        remaining: data.resources.core.remaining,
        resetAt: new Date(data.resources.core.reset * 1000).toISOString(),
      };
    } catch {
      // A rate-limit probe failure must not break connection validation.
    }
    return this.rateLimit;
  }
}

/** Bounded concurrency helper; preserves input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
