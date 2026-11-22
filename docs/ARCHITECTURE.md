# WHYTRACE — Architecture

## 1. Product shape

WHYTRACE is one repository-scoped investigation engine. The five stakeholder concerns (new developer, maintainer, reviewer, architect, security/reliability) are question types against the same graph, retrieval pipeline and evidence policy — not separate systems.

## 2. Runtime topology

- **Next.js 16 App Router**, React 19, TypeScript 5.9, Tailwind CSS 4, Motion, React Flow 13, Lucide.
- All data-plane work runs in **Node.js route handlers** (`export const runtime = "nodejs"`). Neo4j operations never execute in an edge runtime.
- No message broker, no second database, no microservices.
- The cinematic hero image is a local SVG; the graph library is lazy-loaded only on `/board`.

```
Client screens
  ├── /connect        → /api/repositories/connect → /api/repositories/ingest (SSE)
  ├── /investigate    → /api/investigate
  ├── /report/[id]    → /api/investigations/[id]
  ├── /board          → /api/graph or persisted report graph
  ├── /files          → /api/investigations
  └── Settings        → /api/health
```

## 3. Ingestion pipeline

`lib/server/ingest.ts` orchestrates nine observable stages:

1. Validate/normalize repository and branch.
2. Fetch commit list (bounded), then fetch patch-bearing commit details (bounded subset).
3. Fetch pull requests; for each bounded PR fetch **API-confirmed** changed files, commits and comments. PR→commit edges come only from this endpoint.
4. Fetch issues (excluding PRs), then comments for selected/referenced/incident issues.
5. Fetch GitHub Discussions through GraphQL when a token is present.
6. Fetch the recursive tree (bounded), select README/ADR/architecture/docs by score, fetch markdown content.
7. Deterministically extract ADR decisions and labelled incidents.
8. Build a relationship plan keyed by `(source, type, target)`, collapse duplicate input rows (including multiple comments by one developer on one thread), reject missing endpoints before writing, then write all nodes and supported relationships to Neo4j in a transaction using repository-scoped canonical IDs.
9. Read counts back from Neo4j and compare node counts plus this ingestion run's unique relationship counts by type before emitting `complete`. A repository is marked ingested only after this verification passes; missing endpoints and duplicate/skipped rows are reported with sample IDs, and stale edges from earlier runs are retained rather than deleted.

The SSE stream emits only events that correspond to completed work. It is not a timed fake progress bar.

### GitHub request policy

- Bearer token is server-side and optional for public repositories.
- Timeouts via `AbortSignal.timeout`.
- 429/5xx/secondary-limit retries with capped backoff; reset time surfaced to the client.
- `canSpend()` prevents optional detail requests when authenticated quota is low.
- Without a token, effective limits shrink to fit the 60-request/hour anonymous budget.
- Failed optional pages become explicit warnings in the ingestion result.

### Canonical identity

```
Repository ID  = lower(owner/name)
File ID        = repoId:file:<path>
Commit ID      = repoId:commit:<sha>
PullRequest ID = repoId:pull:<number>
Issue ID       = repoId:issue:<number>
Discussion ID  = repoId:discussion:<number>
Developer ID   = repoId:developer:<login>
Document ID    = repoId:doc:<path>
Decision ID    = repoId:decision:<path>#decision
Incident ID    = repoId:incident:<issueNumber>
```

Every node carries `repositoryId`. Cross-repository contamination is therefore impossible through the application queries, and unique constraints enforce uniqueness per node type.

### Decision extraction

Only ADR-style material creates `Decision` nodes. A document must be classified as an ADR (ADR/decisions path, an ADR heading, or an explicit `## Decision` section) and have a non-empty decision/context body. The node stores:

- `rationale` and `quote` (verbatim source excerpt),
- `status` parsed from explicit Status text,
- `sourceDocId` and `sourceUrl` provenance,
- `adrNumber` where explicit.

`SUPERSEDES` edges are created only when a document explicitly references superseding an ADR number that exists in the same repository.

### Incident extraction

Incident nodes are created only from issues with explicit incident/outage/postmortem/sev/production/regression labels or a title beginning with incident/outage. No incident is inferred from an arbitrary bug report.

## 4. GraphRAG retrieval

`lib/server/graph-retrieval.ts`

```
Question
  → query plan (keywords, file paths, SHAs, PR/issue numbers, quoted phrases, optional focus)
  → seed retrieval
       • explicit file/SHA/number/focus matches
       • Neo4j full-text index (entitySearch)
       • label-scoped title/body fallback
  → bounded graph expansion (1 hop from top seeds, 2 hops from high-value frontier)
  → candidate loading by indexed repository-scoped IDs
  → ranking
       reliability(kind) + directness + distance decay + query-term hits
       + explicit file/SHA/number matches + recency
  → evidence package (≤32 records, 1–2 hop context)
  → evidence subgraph (actual nodes/edges, ≤110 nodes)
  → Gemini synthesis (or deterministic fallback)
  → citation validation
  → deterministic quality/coverage/confidence
  → abstention guard
  → Neo4j case persistence + read-back
```

### Ranking inputs

| Signal | Purpose |
| --- | --- |
| Source reliability | ADR/design docs and merged PRs outrank peripheral files/developers |
| Direct seed match | Records that directly matched the question rank above neighbours |
| Graph distance | A 2-hop record is contextual, not equal to a direct source |
| Topic hits | Keywords present in title/body/path |
| Explicit identifiers | File path, SHA prefix, PR/issue number |
| Recency | Small tie-breaker only; older decisions are not discarded for age |
| Developer penalty | Authors are only surfaced when relevant, not as filler |

Graph relationships materially affect retrieval: expansion discovers PR→issue→commit→file paths that full-text search alone would miss, and relationship types are shown on the board/inspector.

## 5. Synthesis and evidence validation

`lib/server/gemini.ts`

- Official `@google/genai` SDK, configured model (default `gemini-2.5-flash`).
- Only the retrieved evidence package, relationship summary and deterministic supersession hint are sent.
- Prompt requires JSON and exact evidence IDs.
- Response parsed with Zod.
- Every claim's `evidenceIds` is filtered against the set of retrieved IDs. Claims with no valid id are discarded and counted.
- Citations are built only from validated claim IDs.
- Gemini's supersession field is ignored in favour of the deterministic graph-derived status.
- On timeout/error/invalid JSON or missing key: deterministic quote-only report, with synthesis explicitly marked `unavailable` or `not_configured`.

### Deterministic evidence quality

```
confidence =
    8
  + min(directMatches, 6) * 7
  + sourceTypes * 5
  + min(evidenceCount, 12) * 0.8
  + queryTermCoverage * 12
  + min(documentedClaims, 4) * 3
  capped at 92
```

Abstention caps confidence at 15 and labels it `insufficient`. The model never supplies the confidence value.

### Abstention guard

Forced abstention when:

- graph retrieval returns zero records;
- Gemini itself returns the exact abstention sentence;
- no claim cites valid evidence;
- retrieval is weak (zero direct matches, fewer than three records, and the question had meaningful terms).

When abstaining, claim arrays are cleared and the summary is the exact fixed sentence. Evidence remains visible for inspection.

## 6. Persistence and ownership

`Investigation` nodes store:

- case number, repository, branch, question, status, summary, confidence, evidence count;
- session ID, engine, model, synthesis status, report JSON (the complete dossier and graph);
- `(Investigation)-[:INVESTIGATED]->(Repository)`;
- `(evidence)-[:SUPPORTS]->(Investigation)` for every selected evidence node.

Reads and deletes require the anonymous httpOnly `wt_session` cookie. It is an anonymous browser scope, not authentication. The cookie value is never rendered.

## 7. Rendering and performance

- Landing hero: local SVG, no video.
- Graph library: `next/dynamic` with `ssr:false` on `/board` only.
- Board: initial 90 nodes, progressive expansion, type filters, search, `onlyRenderVisibleElements`, memoised custom node, deterministic layout.
- Motion: transform/opacity only; `prefers-reduced-motion` disables scans, threads, shimmer, reveal and the magnifier.
- Spotlight: pointer CSS variables via rAF, no React state per mouse move; touch uses tap-to-focus.
- Fonts: `next/font` with `display: swap`.

## 8. Error mapping

| Condition | HTTP | User-visible behaviour |
| --- | --- | --- |
| Invalid URL/path | 400 | Specific validation message |
| GitHub 404 | 404 | Not found or private without access |
| GitHub 401/403 | 403 | Token/permission error |
| GitHub rate limit | 429 | Reset window shown |
| Empty repo | 422 | Empty repository message |
| Repo not ingested | 409 | Connect/ingest first |
| Neo4j missing | 503 | Configuration instructions, no fake graph |
| Gemini missing | 200 | Report with synthesis `not_configured` |
| Neo4j write/read-back failure | 503/500 | Investigation does not claim success |
