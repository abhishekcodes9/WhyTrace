# WHYTRACE

**Don't just read the code. Investigate why it became this way.**

WHYTRACE is an evidence-first engineering history investigator. Connect an accessible GitHub repository, ingest its bounded commit/PR/issue/document history into a Neo4j knowledge graph, ask why something exists, and receive a dossier whose claims are tied to retrieved source records. When the evidence is insufficient, WHYTRACE abstains instead of inventing a rationale.

Built for **PS T1.1 — Applied AI — Why The Code Is Like This** and the **Neo4j Track**.

---

## What is actually implemented

| Capability | Status |
| --- | --- |
| Next.js App Router application, responsive noir design system | Implemented |
| GitHub URL validation + repository metadata check | Implemented |
| Bounded real GitHub ingestion (commits, patches, PRs, issues, discussions, docs/ADRs) | Implemented |
| Neo4j schema, constraints, idempotent upserts, repo-scoped IDs, read-back verification | Implemented |
| GraphRAG retrieval (full-text seeds → graph expansion → discussion of evidence) | Implemented |
| Gemini structured synthesis with citation validation | Implemented (requires `GEMINI_API_KEY`) |
| Deterministic quote-only fallback when Gemini is absent or fails | Implemented |
| Honest abstention guard and deterministic confidence calculation | Implemented |
| Antique-paper dossier with separated facts / observations / inferences / uncertainty | Implemented |
| React Flow evidence board with actual graph nodes, red threads, search, filters, progressive expansion, inspector | Implemented |
| Persistent case files in Neo4j scoped to an anonymous session cookie | Implemented |
| Clearly labelled synthetic DEMO DATA case | Implemented |
| Unit tests, live-test scaffold, production build | Implemented; see verification status |

### Honest verification status in this workspace

- `npm run typecheck` — **passes**
- `npm run lint` — **passes with no errors** (18 non-blocking warnings)
- `npm test` — **passes** (15 unit tests; mocked/fixture only)
- `npm run build` — **passes**
- Live Neo4j / Gemini / private GitHub checks — **BLOCKED / NOT CONFIGURED** in this workspace because no credentials were supplied.
- Public GitHub API checks can be run with `npm run test:live`; no token is needed for the public-repository probe, though unauthenticated limits apply.

A passing unit test is **not** evidence that AuraDB, Gemini or a live ingestion succeeded. The in-app diagnostics drawer and the live test command report real configuration state and never fake a connection.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Create local environment (never commit this file)
copy .env.example .env.local     # Windows
# cp .env.example .env.local     # macOS / Linux

# 3. Fill in Neo4j (required for real ingestion)
#    NEO4J_URI=neo4j+s://<your-instance>.databases.neo4j.io
#    NEO4J_USERNAME=neo4j
#    NEO4J_PASSWORD=<your-password>
#    NEO4J_DATABASE=neo4j

# 4. Optional but recommended
#    GITHUB_TOKEN=<fine-grained token with public repo read; private needs contents+issues+PR read>
#    GEMINI_API_KEY=<Google AI Studio key>
#    GEMINI_MODEL=gemini-2.5-flash

# 5. Run
npm run dev
```

Open `http://localhost:3000`.

The old AuraDB endpoint mentioned in earlier project history is **not** assumed valid. Use the verified `neo4j+s://` URI from the current Aura console.

---

## The one core journey

1. **Home** → `START INVESTIGATION`.
2. **Choose Your Case** → paste `https://github.com/owner/repository`.
3. WHYTRACE validates the repository with GitHub, checks Neo4j, then streams real ingestion stages. Counts shown at the end are counts read back from Neo4j, not estimates.
4. **Investigation Workspace** → ask a question, optionally attach a file/commit/PR/issue focus.
5. GraphRAG seeds and expands through the persisted graph, ranks records, validates citations, and stores the case.
6. **Investigation Dossier** → read the evidence-backed answer, inspect patches, open original GitHub sources.
7. **Evidence Board** → inspect only actual Neo4j nodes/relationships, search, filter, expand and open the related record.
8. **Case Files** → reopen or delete persisted investigations.

No repository is preloaded as if it were the user's. The only prebuilt case is explicitly marked **DEMO DATA** and uses synthetic records with no source URLs.

---

## Architecture

```
Browser (Next.js App Router / React 19 / Tailwind 4 / Motion / React Flow)
  │
  ├─ POST /api/repositories/connect      GitHub metadata + Neo4j health
  ├─ POST /api/repositories/ingest       SSE stream of real stages
  ├─ POST /api/investigate               GraphRAG + Gemini + persistence
  ├─ GET  /api/investigations            session-scoped case list
  ├─ GET  /api/investigations/:id        full dossier / ownership check
  ├─ GET  /api/graph                     persisted repo subgraph
  └─ GET  /api/health                    live integration diagnostics
      │
      ├─ GitHub REST (+ GraphQL discussions when token available)
      ├─ Neo4j official JavaScript driver (Node runtime only)
      └─ Google GenAI official SDK (structured JSON, citation-validated)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for retrieval/scoring and persistence details.
See [`docs/GRAPH_SCHEMA.md`](docs/GRAPH_SCHEMA.md) for node/relationship contracts.
See [`docs/DEMO.md`](docs/DEMO.md) for the demo case and how it is labelled.

### Key directories

```
app/                 routes, route handlers, design tokens
components/          shared noir component system, dossier, board, forms
lib/server/          GitHub, Neo4j, ingestion, GraphRAG, Gemini, sessions
lib/types.ts         shared domain contracts
lib/demo-data.ts     synthetic DEMO DATA fixture
tests/               unit tests (fixtures only)
tests/live/          separately identified live integration checks
docs/                architecture, graph schema, demo notes
public/              local cinematic noir office artwork
```

---

## Ingestion bounds

Ingestion is deliberately bounded (configurable in `.env.local`):

| Variable | Default |
| --- | --- |
| `WHYTRACE_MAX_COMMITS` | 40 |
| `WHYTRACE_MAX_COMMIT_DETAILS` | 18 |
| `WHYTRACE_MAX_PULLS` | 24 |
| `WHYTRACE_MAX_ISSUES` | 24 |
| `WHYTRACE_MAX_DOCS` | 8 |
| `WHYTRACE_MAX_PR_COMMENTS` | 8 |
| `WHYTRACE_MAX_ISSUE_COMMENTS` | 6 |

Unauthenticated requests automatically use a smaller slice because GitHub allows only 60 core requests/hour. Partial optional failures (comments, discussions, a patch) are reported in the ingestion result; core write verification failures abort the run.

PR↔commit relationships are created **only** from `GET /pulls/:number/commits`. A commit is never assumed to belong to a PR because it is nearby in time.

---

## Evidence policy

The dossier separates:

- **Documented rationale** — explicit reasoning found in PR bodies, issues, discussions, ADRs, design docs or commit messages.
- **Technical observations** — what the retrieved code/diff/history shows.
- **Probable inference** — explicitly labelled, with cited evidence.
- **Uncertainty** — missing rationale, insufficient coverage, truncated data, conflicting records.
- **Decision status** — `active` only when an ADR explicitly says Active/Accepted; `superseded` only with an explicit SUPERSEDES edge or Superseded status; otherwise `unknown`.

Confidence is computed server-side from direct matches, source diversity, evidence count, query-term coverage and documented claims. It is not accepted from the model.

If the evidence does not support a reliable explanation, the summary is exactly:

> I could not establish a reliable historical explanation from the repository records currently available.

---

## Tests

```bash
npm test          # unit tests; fixtures/mocks only, excluded live folder
npm run test:live # live services; reports BLOCKED/NOT CONFIGURED if keys absent
npm run typecheck
npm run lint
npm run build
```

`tests/live/integration.live.test.ts` performs real Neo4j verification, a real public GitHub repository fetch and a Gemini configuration probe. It never substitutes a mock for a live service.

---

## Security notes

- All secrets remain server-side. Nothing is exposed to client components.
- `.env.local` is git-ignored; only `.env.example` is committed.
- GitHub URLs are parsed strictly (`github.com` only, exactly `/owner/repo`, no credentials, ports or extra path).
- Zod validates all API inputs.
- Cypher uses parameters; node labels/relationship types written dynamically are selected from fixed allowlists.
- Neo4j sessions explicitly select `NEO4J_DATABASE`.
- Cases are scoped by an httpOnly anonymous session cookie; case reads/deletes require the same session.
- External repository text is sanitized before storage/display; no repository HTML is executed.
- Request timeouts and bounded ingestion are enforced.

---

## Known limitations

- Live AuraDB, Gemini and private-repository access require credentials not present in this workspace.
- GitHub Discussions require an authenticated token and the repository must have Discussions enabled.
- Decision nodes are extracted only from explicit ADR-style documents (`## Decision` / ADR paths). They are not inferred from generic prose.
- Incident nodes are created only from explicitly labelled issues (`incident`, `outage`, `postmortem`, `sevN`, `production`, `regression`) or matching titles.
- Discussion comments are stored as text on the parent Discussion/PR/Issue record; comments are not separate graph nodes.
- Ingestion is a bounded historical slice, not a full GitHub mirror.
- Cross-repository comparison is intentionally out of scope; each investigation is scoped to one repository identity.
