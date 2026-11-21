export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "undated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "undated";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDate(value, true);
}

export function truncate(value: string, max = 420): string {
  if (value.length <= max) return value;
  const sliced = value.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trim()}…`;
}

/** Collapse untrusted repository text for safe display. */
export function cleanText(value: string | null | undefined, max = 12_000): string {
  if (!value) return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .slice(0, max);
}

export function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "undated";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "undated";
  const diff = Date.now() - date;
  const days = Math.round(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function confidenceLabel(score: number): "high" | "medium" | "low" | "insufficient" {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  if (score >= 20) return "low";
  return "insufficient";
}

/** Escape Lucene special characters for Neo4j full-text queryNodes. */
export function escapeLucene(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim();
}

export const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "why", "what", "when", "where", "which", "who", "how", "was", "were", "is", "are", "be", "been",
  "being", "do", "does", "did", "done", "for", "from", "with", "without", "into", "onto", "about",
  "does", "introduced", "introduce", "changed", "change", "implementation", "implemented", "code",
  "function", "method", "file", "please", "explain", "tell", "me", "there", "their", "its", "it",
  "of", "to", "in", "on", "at", "by", "as", "we", "our", "you", "your", "can", "could", "should",
  "would", "has", "have", "had", "not", "no", "yes", "so", "such", "also", "just", "only", "any",
  "all", "some", "more", "most", "other", "used", "use", "using", "does", "like", "became",
]);

export function keywords(question: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of question.toLowerCase().split(/[^a-z0-9_.:/-]+/)) {
    const token = raw.replace(/^[._/-]+|[._/-]+$/g, "");
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return fallback;
}
