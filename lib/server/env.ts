/** Server-only environment access. Never import this module from client components. */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const serverEnv = {
  neo4jUri: process.env.NEO4J_URI?.trim() ?? "",
  neo4jUsername: process.env.NEO4J_USERNAME?.trim() || "neo4j",
  neo4jPassword: process.env.NEO4J_PASSWORD ?? "",
  neo4jDatabase: process.env.NEO4J_DATABASE?.trim() || "neo4j",
  githubToken: process.env.GITHUB_TOKEN?.trim() ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
  limits: {
    maxCommits: intEnv("WHYTRACE_MAX_COMMITS", 40, 1, 150),
    maxCommitDetails: intEnv("WHYTRACE_MAX_COMMIT_DETAILS", 18, 1, 100),
    maxPulls: intEnv("WHYTRACE_MAX_PULLS", 24, 1, 100),
    maxIssues: intEnv("WHYTRACE_MAX_ISSUES", 24, 1, 100),
    maxDocs: intEnv("WHYTRACE_MAX_DOCS", 8, 1, 25),
    maxPrComments: intEnv("WHYTRACE_MAX_PR_COMMENTS", 8, 0, 50),
    maxIssueComments: intEnv("WHYTRACE_MAX_ISSUE_COMMENTS", 6, 0, 50),
    maxDiscussions: intEnv("WHYTRACE_MAX_DISCUSSIONS", 10, 0, 50),
    maxTreeEntries: 25_000,
    maxDocBytes: 160_000,
    requestTimeoutMs: 25_000,
  },
} as const;

export function isNeo4jConfigured(): boolean {
  return Boolean(serverEnv.neo4jUri && serverEnv.neo4jUsername && serverEnv.neo4jPassword);
}

export function isGitHubConfigured(): boolean {
  return Boolean(serverEnv.githubToken);
}

export function isGeminiConfigured(): boolean {
  return Boolean(serverEnv.geminiApiKey);
}
