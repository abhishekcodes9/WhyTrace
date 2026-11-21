# WHYTRACE — Demo and live verification

## Synthetic demo case

The only prebuilt case is `offscript/wayfarer-api`, a **synthetic repository** about a token-refresh retry storm.

It is shown with:

- a persistent `DEMO DATA` badge on the dossier, evidence board, and Case Files card;
- a banner stating that no GitHub, Neo4j or Gemini request was made;
- `report.demo = true`;
- null source URLs, so no evidence card can be mistaken for a real GitHub record;
- a synthesis message explicitly identifying `demo-fixture`;
- an uncertainty entry stating that every record is synthetic.

Open it from:

- `EXPLORE DEMO` on the landing page → `/report/demo`;
- the Case Files demo card → `/report/demo` or `/board?demo=1`;
- directly: `/report/demo` and `/board?demo=1`.

The demo is presentation data only. It does not prove live ingestion, Neo4j persistence, or Gemini synthesis.

## Real workflow checklist

1. Copy `.env.example` to `.env.local`.
2. Set a verified `NEO4J_URI` (`neo4j+s://...` from the current Aura console), username, password and database.
3. Optionally set `GITHUB_TOKEN` (recommended; required for private repositories and Discussions) and `GEMINI_API_KEY`.
4. `npm run dev`.
5. Open the Settings drawer. Confirm Neo4j reports a real connection; do not continue if it reports Not configured.
6. `/connect` → enter a small public repository URL.
7. Watch the nine ingestion stages. The completion card must show counts read back from Neo4j.
8. `/investigate` → ask e.g. `Why does this retry guard exist?` (choose a repository where such a rationale exists in PRs/ADRs).
9. Confirm the dossier shows:
   - a real answer, or the exact abstention sentence;
   - documented rationale separate from technical observation/inference;
   - source links that open GitHub;
   - correct synthesis status.
10. Open the Evidence Board. Confirm node labels correspond to real ingested records and the inspector edges are persisted relationships.
11. Reopen the case from Case Files after restarting the server; it should still load from Neo4j.
12. Delete a case and confirm it disappears and does not return after refresh.

## Live tests

```bash
npm run test:live
```

- GitHub public-repository fetch: runs without a token (anonymous limits).
- Neo4j: **BLOCKED** unless configured.
- Gemini: configuration probe; **BLOCKED** unless configured.

The live test never substitutes a mock for a real service.

## Acceptance evidence mapping

| Acceptance test | Implementation |
| --- | --- |
| 1. Arbitrary public repo URL | Strict GitHub URL parser + `/api/repositories/connect` |
| 2. Bounded history/changed files | Nine-stage ingest with configurable limits and commit details |
| 3. Persist records/relationships | Transactional Neo4j writes with allowlisted labels/relationships |
| 4. Read graph back | `readCounts` verification + API/report graph reads |
| 5. Ask why implementation chosen | Investigation workspace |
| 6. GraphRAG retrieval | Full-text seeds, 1–2 hop expansion, ranking |
| 7. Gemini explanation | Structured, citation-validated synthesis |
| 8. Facts vs observations vs inference | Separate dossier claim arrays and sections |
| 9. Citations open source | Evidence/claim/source links use canonical GitHub URLs |
| 10. Unsupported question abstains | Abstention guard + exact fixed sentence |
| 11. Commit investigation patch | Commit detail files→`MODIFIES` edges carry patches; dossier changed-files diffs |
| 12. Supersession only when explicit | `SUPERSEDES` edges/status only; deterministic supersession derivation |
| 13. Second repo no mixing | Repository-scoped canonical IDs and `repositoryId` filters |
| 14. Persistence survives restart | Cases stored in Neo4j, not browser memory |
| 15. Desktop/mobile | Single responsive system; tested at 390/768/1280/1440/1536 |

Live acceptance tests 1–14 require working credentials and a real ingestion run; this workspace has none configured. Do not treat the demo or unit tests as substitute evidence for those live checks.
