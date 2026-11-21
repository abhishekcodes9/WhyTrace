# WHYTRACE — Graph Schema

All nodes carry `id` (canonical, repository-scoped) and `repositoryId` (lowercase `owner/name`). Every uniqueness constraint below is created idempotently at first graph access.

## Nodes

| Label | Key properties | Created when |
| --- | --- | --- |
| `Repository` | `id`, `owner`, `name`, `fullName`, `url`, `branch`, `defaultBranch`, `description`, `private`, `stars`, `language`, `ingestedAt`, `lastIngestionStatus` | Repository validated/ingested |
| `File` | `path`, `name`, `url`, `changeCount`, `lastChangedAt`, `excerpt` | A commit/PR changed it |
| `Commit` | `sha`, `shortSha`, `title`, `message`, `body`, `authorLogin`, `authorName`, `authoredAt`, `url`, `additions`, `deletions`, `changedFiles` | Commit list/detail fetch |
| `PullRequest` | `number`, `title`, `body`, `commentsText`, `state`, `merged`, dates, `url`, `authorLogin`, branches, `mergeCommitSha`, `labels` | PR list fetch |
| `Issue` | `number`, `title`, `body`, `commentsText`, `state`, dates, `url`, `authorLogin`, `labels` | Issue list fetch (PRs excluded) |
| `Discussion` | `number`, `title`, `body`, `commentsText`, `category`, dates, `url`, `authorLogin` | GraphQL discussions (token required) |
| `Developer` | `login`, `avatarUrl`, `url`, `name` | Commit/PR/issue/discussion/comment author |
| `DesignDocument` | `path`, `title`, `body`, `url`, `docType` (`readme`/`adr`/`architecture`/`documentation`), `excerpt` | Selected README/ADR/architecture/docs file |
| `Decision` | `title`, `rationale`, `quote`, `status`, `adrNumber`, `sourceDocId`, `sourceUrl` | Explicit ADR-style document only |
| `Incident` | `issueNumber`, `title`, `summary`, `url`, `happenedAt`, `labels`, `status` | Explicitly labelled incident issue only |
| `Investigation` | `caseNumber`, `repoFullName`, `branch`, `question`, `status`, `summary`, `confidence`, `evidenceCount`, `sessionId`, `createdAt`, `engine`, `model`, `synthesisStatus`, `reportJson` | Investigation completed |

## Relationships

| Type | Source → target | Evidence requirement |
| --- | --- | --- |
| `CONTAINS` | Repository → File/Commit/PR/Issue/Discussion/Developer/Document/Decision/Incident | Record was ingested for that repository |
| `CONTAINS` | PullRequest → Commit | GitHub `GET /pulls/:number/commits` confirmed it |
| `MODIFIES` | Commit → File | Commit detail returned that file, with additions/deletions/patch/status properties |
| `AFFECTS` | PullRequest → File | PR files endpoint returned that file |
| `AFFECTS` | Incident → File | Issue body explicitly named an existing file path |
| `AUTHORED` | Developer → Commit | Commit author login |
| `OPENED` | Developer → PR/Issue/Discussion | Author of record |
| `DISCUSSES` | Developer → PR/Issue/Discussion | Author of a retrieved comment; properties include `via: "comment"` |
| `REFERENCES` | Commit/PR/Issue/Discussion/Document → Issue/PR | Explicit `#N`, `/issues/N`, `/pull/N` reference to an ingested record |
| `REFERENCES` | Incident → Issue | Incident created from that labelled issue |
| `DOCUMENTS` | DesignDocument → Decision | Decision extracted from that document |
| `SUPERSEDES` | Decision → Decision | Source document explicitly supersedes that ADR number |
| `SUPPORTS` | Evidence node → Investigation | Evidence was selected into the investigation package |
| `INVESTIGATED` | Investigation → Repository | Investigation belongs to that repository |

## Constraints and indexes

Unique constraints exist for every node label on `id`. Repository-scoped indexes exist on `repositoryId`; `fullName` is indexed on Repository; `sessionId` and `createdAt` are indexed on Investigation.

A full-text index `entitySearch` covers:

```
Commit | PullRequest | Issue | Discussion | DesignDocument | Decision | File
ON EACH [title, body, message, path, rationale, excerpt]
```

Queries always filter `node.repositoryId = $repoId` after full-text hits, preventing cross-repository mixing.

## Temporal semantics

- GitHub timestamps are stored as ISO strings from the source, not regenerated.
- A decision is never inferred to be active merely because no newer record was ingested.
- `superseded` requires an explicit `SUPERSEDES` edge or explicit Superseded status.
- `active` requires explicit Active/Accepted status and no explicit supersession; the UI still states that absence of a newer record is not proof.
- Otherwise the status is `unknown`.

## What is deliberately absent

- No `Comment` nodes (comments are attached to their parent record as text).
- No automatic PR↔commit links.
- No invented decisions, incidents, or relationships from LLM output.
- No cross-repository edges.
- No decorative graph nodes. The evidence board renders only persisted (or explicitly DEMO DATA) nodes.
