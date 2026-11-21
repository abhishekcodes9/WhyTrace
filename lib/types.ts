/* Shared domain contracts for WHYTRACE. */

export type NodeKind =
  | "repository"
  | "file"
  | "commit"
  | "pullRequest"
  | "issue"
  | "discussion"
  | "developer"
  | "decision"
  | "designDocument"
  | "incident";

export type SourceKind = Exclude<NodeKind, "repository">;

export interface RepositorySummary {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  branch: string;
  defaultBranch: string;
  description: string | null;
  private: boolean;
  stars: number;
  language: string | null;
  ingestedAt?: string | null;
  counts?: GraphCounts;
  ingestionStatus?: "running" | "ingested" | "failed" | null;
  ingestionError?: string | null;
}

export interface GraphCounts {
  files: number;
  commits: number;
  pulls: number;
  issues: number;
  discussions: number;
  developers: number;
  documents: number;
  decisions: number;
  incidents: number;
  relationships: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  sublabel?: string;
  date?: string | null;
  url?: string | null;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
}

export interface EvidenceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EvidenceItem {
  id: string;
  kind: SourceKind;
  title: string;
  excerpt: string;
  url: string | null;
  date: string | null;
  author: string | null;
  reference: string;
  direct: boolean;
  score: number;
  sourceTypes: string[];
  meta: Record<string, string | number | boolean | null>;
}

export interface Claim {
  text: string;
  evidenceIds: string[];
}

export interface Citation {
  evidenceId: string;
  kind: SourceKind;
  title: string;
  reference: string;
  url: string | null;
}

export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  url: string | null;
  source?: string;
}

export interface EvidenceQuality {
  confidence: number;
  label: "high" | "medium" | "low" | "insufficient";
  evidenceCount: number;
  directCount: number;
  sourceTypes: string[];
  coverage: number;
  explanation: string;
}

export type SupersessionStatus = "superseded" | "active" | "unknown";

export interface SynthesisState {
  provider: "gemini";
  status: "completed" | "unavailable" | "not_configured";
  model: string | null;
  message: string;
}

export type InvestigationStatus = "answered" | "insufficient" | "failed";

export interface InvestigationReport {
  id: string;
  caseNumber: string;
  repoFullName: string;
  branch: string;
  question: string;
  createdAt: string;
  status: InvestigationStatus;
  summary: string;
  documentedRationale: Claim[];
  technicalObservations: Claim[];
  inferences: Claim[];
  citations: Citation[];
  uncertainties: string[];
  supersessionStatus: SupersessionStatus;
  supersessionNote: string;
  evidenceQuality: EvidenceQuality;
  evidence: EvidenceItem[];
  changedFiles: ChangedFile[];
  developers: { login: string; url: string | null; count: number }[];
  timeline: { date: string; kind: string; title: string; reference: string; url: string | null }[];
  graph: EvidenceGraph;
  synthesis: SynthesisState;
  focus: InvestigationFocus | null;
  demo?: boolean;
}

export type InvestigationFocus =
  | { type: "file"; value: string }
  | { type: "commit"; value: string }
  | { type: "pullRequest"; value: string }
  | { type: "issue"; value: string }
  | { type: "question"; value: string };

export interface CaseFileSummary {
  id: string;
  repoFullName: string;
  question: string;
  status: InvestigationStatus;
  createdAt: string;
  confidence: number;
  evidenceCount: number;
  summary: string;
  demo?: boolean;
}

export interface Diagnostics {
  neo4j: { configured: boolean; connected: boolean; message: string; database: string | null; latencyMs?: number };
  github: { configured: boolean; message: string };
  gemini: { configured: boolean; model: string; message: string };
  environment: string;
}

export interface GitHubRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

export interface ConnectResponse {
  repository: RepositorySummary;
  alreadyIndexed: boolean;
  neo4jVerified: boolean;
  neo4jMessage: string;
  rateLimit: GitHubRateLimit;
}

export interface IngestionCounts {
  commits: number;
  pullRequests: number;
  issues: number;
  discussions: number;
  documents: number;
  decisions: number;
  incidents: number;
  files: number;
  developers: number;
  relationships: number;
}

export type IngestionEvent =
  | { type: "stage"; stage: number; stageName: string; message: string; counts?: Partial<IngestionCounts> }
  | { type: "progress"; stageName: string; message: string; current?: number; total?: number }
  | { type: "warning"; message: string }
  | { type: "complete"; repository: RepositorySummary; counts: IngestionCounts; warnings: string[]; durationMs: number }
  | { type: "error"; message: string; code?: string };
