import { nodeId } from "./repository";

/** A relationship row exactly as it is sent to the Neo4j writer. */
export interface RelRow {
  from: string;
  to: string;
  props?: Record<string, unknown>;
}

export interface RelationshipGroup {
  type: string;
  fromLabel: string;
  toLabel: string;
  rows: RelRow[];
}

export interface MissingEndpointDiagnostic {
  type: string;
  fromLabel: string;
  toLabel: string;
  missingSources: number;
  missingTargets: number;
  sampleSources: string[];
  sampleTargets: string[];
}

export interface RelationshipPlan {
  groups: RelationshipGroup[];
  expectedByType: Record<string, number>;
  expectedTotal: number;
  duplicateInputRows: number;
  missingEndpoints: MissingEndpointDiagnostic[];
}

export interface DiscussComment {
  id?: string;
  authorLogin: string | null;
  url: string;
  createdAt: string;
}

export interface DiscussAggregation {
  rows: RelRow[];
  duplicateInputRows: number;
}

export function relationshipKey(type: string, row: Pick<RelRow, "from" | "to">): string {
  return `${type}\u0000${row.from}\u0000${row.to}`;
}

/**
 * Collapse identical endpoint/type combinations. Neo4j's MERGE gives one
 * relationship per pair, so the write plan must use the same uniqueness rule.
 * Properties from duplicate rows are merged, with later rows taking precedence.
 */
export function dedupeRelationshipRows(rows: RelRow[]): { rows: RelRow[]; duplicateInputRows: number } {
  const byKey = new Map<string, RelRow>();
  let duplicateInputRows = 0;
  for (const row of rows) {
    const key = `${row.from}\u0000${row.to}`;
    const existing = byKey.get(key);
    if (existing) {
      duplicateInputRows += 1;
      byKey.set(key, { ...existing, props: { ...existing.props, ...row.props } });
    } else {
      byKey.set(key, { ...row, props: row.props ? { ...row.props } : undefined });
    }
  }
  return { rows: [...byKey.values()], duplicateInputRows };
}

/**
 * Developers discuss a PR/issue/discussion once per endpoint pair. Several
 * comments by the same developer remain represented as one relationship with
 * aggregated comment metadata, not as fake duplicate edges.
 */
export function aggregateDiscussComments(
  repoId: string,
  targetKind: string,
  targetNumber: number,
  comments: DiscussComment[],
): DiscussAggregation {
  const byKey = new Map<string, RelRow & { props: Record<string, unknown> }>();
  const seenComments = new Set<string>();
  let duplicateInputRows = 0;

  for (const comment of comments) {
    if (!comment.authorLogin) continue;
    const commentKey = comment.id || comment.url;
    if (seenComments.has(commentKey)) {
      duplicateInputRows += 1;
      continue;
    }
    seenComments.add(commentKey);

    const from = nodeId(repoId, "developer", comment.authorLogin);
    const to = nodeId(repoId, targetKind, targetNumber);
    const key = relationshipKey("DISCUSSES", { from, to });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        from,
        to,
        props: {
          via: "comment",
          commentCount: 1,
          commentUrls: [comment.url],
          commentUrl: comment.url,
          firstCommentAt: comment.createdAt,
          lastCommentAt: comment.createdAt,
          createdAt: comment.createdAt,
        },
      });
      continue;
    }

    duplicateInputRows += 1;
    const count = Number(existing.props.commentCount ?? 1) + 1;
    const urls = Array.isArray(existing.props.commentUrls)
      ? existing.props.commentUrls.map(String)
      : [];
    if (!urls.includes(comment.url)) urls.push(comment.url);
    const first = String(existing.props.firstCommentAt ?? comment.createdAt);
    const last = String(existing.props.lastCommentAt ?? comment.createdAt);
    existing.props = {
      ...existing.props,
      commentCount: count,
      commentUrls: urls,
      commentUrl: comment.createdAt >= last ? comment.url : existing.props.commentUrl,
      firstCommentAt: comment.createdAt < first ? comment.createdAt : first,
      lastCommentAt: comment.createdAt > last ? comment.createdAt : last,
      createdAt: comment.createdAt > last ? comment.createdAt : last,
    };
  }

  return { rows: [...byKey.values()], duplicateInputRows };
}

function pushSample(list: string[], value: string, limit = 5): void {
  if (list.length >= limit || list.includes(value)) return;
  list.push(value);
}

/**
 * Build a deterministic relationship plan and validate every endpoint against
 * the exact label sets that writeNodes() will create in the same transaction.
 */
export function planRelationships(
  groups: RelationshipGroup[],
  nodeIdsByLabel: Map<string, Set<string>>,
  additionalDuplicateInputRows = 0,
): RelationshipPlan {
  const plannedGroups: RelationshipGroup[] = [];
  const expectedByType: Record<string, number> = {};
  const missingByKey = new Map<string, MissingEndpointDiagnostic>();
  let expectedTotal = 0;
  let duplicateInputRows = additionalDuplicateInputRows;

  for (const group of groups) {
    const deduped = dedupeRelationshipRows(group.rows);
    duplicateInputRows += deduped.duplicateInputRows;
    const sourceIds = nodeIdsByLabel.get(group.fromLabel) ?? new Set<string>();
    const targetIds = nodeIdsByLabel.get(group.toLabel) ?? new Set<string>();
    const missingKey = `${group.type}\u0000${group.fromLabel}\u0000${group.toLabel}`;
    const diagnostic = missingByKey.get(missingKey) ?? {
      type: group.type,
      fromLabel: group.fromLabel,
      toLabel: group.toLabel,
      missingSources: 0,
      missingTargets: 0,
      sampleSources: [],
      sampleTargets: [],
    };

    for (const row of deduped.rows) {
      const sourceMissing = !sourceIds.has(row.from);
      const targetMissing = !targetIds.has(row.to);
      if (sourceMissing) {
        diagnostic.missingSources += 1;
        pushSample(diagnostic.sampleSources, row.from);
      }
      if (targetMissing) {
        diagnostic.missingTargets += 1;
        pushSample(diagnostic.sampleTargets, row.to);
      }
    }

    if (diagnostic.missingSources || diagnostic.missingTargets) {
      missingByKey.set(missingKey, diagnostic);
    }
    plannedGroups.push({ ...group, rows: deduped.rows });
    expectedByType[group.type] = (expectedByType[group.type] ?? 0) + deduped.rows.length;
    expectedTotal += deduped.rows.length;
  }

  const missingEndpoints = [...missingByKey.values()];
  return {
    groups: plannedGroups,
    expectedByType,
    expectedTotal,
    duplicateInputRows,
    missingEndpoints,
  };
}

export function formatRelationshipDiagnostics(
  plan: RelationshipPlan,
  persistedByType: Record<string, number>,
): string {
  const missingTypes = Object.entries(plan.expectedByType)
    .filter(([type, expected]) => (persistedByType[type] ?? 0) < expected)
    .map(([type, expected]) => {
      const group = plan.groups.find((candidate) => candidate.type === type);
      const samples = (group?.rows ?? []).slice(0, 3).map((row) => `${row.from} -> ${row.to}`);
      return `${type}: expected ${expected}, persisted ${persistedByType[type] ?? 0}${samples.length ? `; samples ${samples.join(" | ")}` : ""}`;
    });

  const endpointDiagnostics = plan.missingEndpoints.length
    ? plan.missingEndpoints.map((item) =>
        `${item.type} ${item.fromLabel}->${item.toLabel}: missing sources ${item.missingSources}, ` +
        `missing targets ${item.missingTargets}; sample sources ${item.sampleSources.join(", ") || "none"}; ` +
        `sample targets ${item.sampleTargets.join(", ") || "none"}`)
    : ["none"];

  return [
    `expected unique relationships ${plan.expectedTotal}`,
    `duplicate input rows collapsed ${plan.duplicateInputRows}`,
    `missing type counts ${missingTypes.length ? missingTypes.join(" | ") : "none"}`,
    `missing endpoints ${endpointDiagnostics.join(" | ")}`,
  ].join("; ");
}
