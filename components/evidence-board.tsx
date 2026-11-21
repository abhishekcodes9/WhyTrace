"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  useNodesInitialized, useNodesState, useReactFlow, type Edge, type NodeTypes,
} from "@xyflow/react";
import {
  ExternalLink, Filter, Focus, LocateFixed, Maximize2, Network, Search, X,
} from "lucide-react";
import type { EvidenceGraph, GraphEdge, GraphNode, NodeKind } from "@/lib/types";
import { EvidenceNode, kindAccent, kindIcon, kindLabel, type EvidenceFlowNode } from "./evidence-node";
import { Badge } from "./ui/badge";
import { Button, ButtonLink } from "./ui/button";
import { cn, formatDate } from "@/lib/utils";

const nodeTypes: NodeTypes = { evidence: EvidenceNode };

const KIND_ORDER: NodeKind[] = [
  "repository", "decision", "designDocument", "pullRequest", "commit",
  "issue", "incident", "discussion", "file", "developer",
];

const FILTER_ORDER: NodeKind[] = KIND_ORDER.filter((kind) => kind !== "repository");

function layoutNodes(
  nodes: GraphNode[],
  directIds: Set<string>,
): EvidenceFlowNode[] {
  const repository = nodes.filter((node) => node.kind === "repository");
  const groups = new Map<NodeKind, GraphNode[]>();
  for (const kind of KIND_ORDER) {
    const items = nodes
      .filter((node) => node.kind === kind && kind !== "repository")
      .sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
    if (items.length) groups.set(kind, items);
  }

  const positioned: EvidenceFlowNode[] = [];
  for (const node of repository) {
    positioned.push({
      id: node.id,
      type: "evidence",
      position: { x: 0, y: 0 },
      data: { node, dimmed: false, direct: directIds.has(node.id) },
      selected: false,
    });
  }

  let groupIndex = 0;
  for (const [, items] of groups) {
    const rows = 6;
    for (const [index, node] of items.entries()) {
      const subColumn = Math.floor(index / rows);
      const row = index % rows;
      const x = 320 + groupIndex * 250 + subColumn * 238;
      const y = (row - (Math.min(rows, items.length) - 1) / 2) * 126;
      positioned.push({
        id: node.id,
        type: "evidence",
        position: { x, y },
        data: { node, dimmed: false, direct: directIds.has(node.id) },
        selected: false,
      });
    }
    groupIndex += 1;
  }

  return positioned;
}

function nodeHaystack(node: GraphNode): string {
  const props = node.properties;
  return [
    node.label,
    node.sublabel,
    node.kind,
    props.path,
    props.sha,
    props.number,
    props.authorLogin,
    props.status,
    props.branch,
    props.title,
  ].filter((value) => value !== undefined && value !== null).join(" ").toLowerCase();
}

export interface EvidenceBoardProps {
  graph: EvidenceGraph;
  repoFullName: string;
  branch: string;
  question?: string;
  caseId?: string;
  demo?: boolean;
  directIds?: string[];
  evidenceCount?: number;
}

export function EvidenceBoard(props: EvidenceBoardProps) {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  );
}

function BoardCanvas({ graph, repoFullName, branch, question, caseId, demo, directIds, evidenceCount }: EvidenceBoardProps) {
  const { fitView, setCenter } = useReactFlow();
  const fitViewRef = useRef(fitView);
  const nodesInitialized = useNodesInitialized();
  const directSet = useMemo(() => new Set(directIds ?? []), [directIds]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeKinds, setActiveKinds] = useState<Set<NodeKind>>(() => new Set(FILTER_ORDER));
  const [visibleLimit, setVisibleLimit] = useState(240);
  const [highlightPath, setHighlightPath] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<EvidenceFlowNode>([]);

  const typeCounts = useMemo(() => {
    const counts = new Map<NodeKind, number>();
    for (const node of graph.nodes) {
      if (node.kind === "repository") continue;
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return counts;
  }, [graph.nodes]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return graph.nodes.filter((node) => {
      if (node.kind !== "repository" && !activeKinds.has(node.kind)) return false;
      if (term && !nodeHaystack(node).includes(term)) return false;
      return true;
    });
  }, [graph.nodes, activeKinds, search]);

  const displayed = useMemo(() => {
    if (filtered.length <= visibleLimit) return filtered;
    const repository = filtered.filter((node) => node.kind === "repository");
    const rest = filtered.filter((node) => node.kind !== "repository").slice(0, Math.max(0, visibleLimit - repository.length));
    return [...repository, ...rest];
  }, [filtered, visibleLimit]);

  const displayedIds = useMemo(() => new Set(displayed.map((node) => node.id)), [displayed]);

  const baseNodes = useMemo(() => layoutNodes(displayed, directSet), [displayed, directSet]);

  useEffect(() => {
    fitViewRef.current = fitView;
  }, [fitView]);

  useEffect(() => {
    setNodes(baseNodes);
  }, [baseNodes, setNodes]);

  useEffect(() => {
    if (!nodesInitialized || !baseNodes.length) return;
    // Wait until React Flow has measured every node. Fitting before measurement
    // produces a viewport based on partial bounds and can push the graph offscreen.
    const handle = window.setTimeout(() => {
      void fitViewRef.current({ padding: 0.18, duration: 450, maxZoom: 1.05 });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [nodesInitialized, baseNodes]);

  useEffect(() => {
    if (selectedId && !displayedIds.has(selectedId)) {
      setSelectedId(null);
      setMobileInspectorOpen(false);
    }
  }, [displayedIds, selectedId]);

  const connected = useMemo(() => {
    if (!selectedId) return { ids: new Set<string>(), edges: new Map<string, GraphEdge>() };
    const ids = new Set<string>([selectedId]);
    const edges = new Map<string, GraphEdge>();
    for (const edge of graph.edges) {
      if (!displayedIds.has(edge.source) || !displayedIds.has(edge.target)) continue;
      if (edge.source === selectedId || edge.target === selectedId) {
        ids.add(edge.source);
        ids.add(edge.target);
        edges.set(edge.id, edge);
      }
    }
    return { ids, edges };
  }, [selectedId, graph.edges, displayedIds]);

  const renderedNodes = useMemo(() => {
    return nodes.map((node) => {
      const dimmed = Boolean(highlightPath && selectedId && !connected.ids.has(node.id));
      return {
        ...node,
        selected: node.id === selectedId,
        data: { ...node.data, dimmed },
      };
    });
  }, [nodes, selectedId, connected.ids, highlightPath]);

  const renderedEdges = useMemo<Edge[]>(() => {
    return graph.edges
      .filter((edge) => displayedIds.has(edge.source) && displayedIds.has(edge.target))
      .map((edge) => {
        const isConnected = connected.edges.has(edge.id);
        const dim = Boolean(highlightPath && selectedId && !isConnected);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "default",
          className: isConnected ? "thread-edge is-highlighted" : "thread-edge",
          label: isConnected ? edge.label ?? edge.type : undefined,
          labelStyle: isConnected ? { fill: "#e8dcc5", fontSize: 9, fontFamily: "var(--font-mono)" } : undefined,
          labelBgStyle: isConnected ? { fill: "#201813", fillOpacity: 0.92 } : undefined,
          labelBgPadding: isConnected ? [5, 2] : undefined,
          labelBgBorderRadius: isConnected ? 2 : undefined,
          style: {
            stroke: isConnected ? "#b84d43" : "#8e3830",
            strokeWidth: isConnected ? 2.4 : 1.5,
            opacity: dim ? 0.1 : isConnected ? 0.98 : 0.62,
          },
        };
      });
  }, [graph.edges, displayedIds, connected.edges, selectedId, highlightPath]);

  const inspectedId = hoveredId ?? selectedId;
  const inspectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === inspectedId) ?? null,
    [graph.nodes, inspectedId],
  );
  const connectedEdges = useMemo(() => {
    if (!inspectedNode) return [];
    return graph.edges.filter((edge) => edge.source === inspectedNode.id || edge.target === inspectedNode.id);
  }, [graph.edges, inspectedNode]);

  const selectNode = useCallback((node: EvidenceFlowNode) => {
    setSelectedId(node.id);
    setMobileInspectorOpen(true);
  }, []);

  const locateFirst = () => {
    if (!filtered.length) return;
    const target = filtered[0];
    const node = renderedNodes.find((item) => item.id === target.id);
    if (node) {
      setSelectedId(target.id);
      void setCenter(node.position.x, node.position.y, { zoom: 1.15, duration: 500 });
    }
  };

  const allTypesActive = activeKinds.size === FILTER_ORDER.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-outline-variant bg-surface-container p-3 md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/80" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search pinned evidence…"
                aria-label="Search evidence nodes"
                className="w-full rounded border border-outline-variant bg-surface-container-low py-2.5 pl-9 pr-8 font-mono text-mono-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none"
              />
              {search ? (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={locateFirst} icon={<LocateFixed className="h-3.5 w-3.5" />} disabled={!filtered.length}>
                Locate
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void fitView({ padding: 0.2, duration: 450, maxZoom: 1.05 })} icon={<Maximize2 className="h-3.5 w-3.5" />}>
                Fit
              </Button>
              <Button
                variant={highlightPath ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setHighlightPath((value) => !value)}
                icon={<Focus className="h-3.5 w-3.5" />}
                aria-pressed={highlightPath}
              >
                Path
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Direct</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-secondary" /> Red thread</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-paper" /> Paper exhibit</span>
            <span>{displayed.length}/{graph.nodes.length}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveKinds(allTypesActive ? new Set() : new Set(FILTER_ORDER))}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-label text-[10px] uppercase tracking-wider transition-colors",
              allTypesActive ? "border-primary/60 bg-primary/15 text-primary" : "border-outline-variant text-on-surface-variant hover:text-on-surface",
            )}
            aria-pressed={allTypesActive}
          >
            <Filter className="h-3 w-3" /> All
          </button>
          {FILTER_ORDER.map((kind) => {
            const count = typeCounts.get(kind) ?? 0;
            if (!count) return null;
            const active = activeKinds.has(kind);
            return (
              <button
                key={kind}
                onClick={() => {
                  setActiveKinds((current) => {
                    const next = new Set(current);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    return next;
                  });
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-label text-[10px] uppercase tracking-wider transition-colors",
                  active ? "border-primary/45 bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant/60 hover:text-on-surface",
                )}
                aria-pressed={active}
              >
                {kindIcon(kind, "h-3 w-3")} {kindLabel(kind)} <span className="font-mono text-[9px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <section
          aria-label="Interactive evidence board"
          className="corkboard relative h-[58vh] min-h-[440px] overflow-hidden rounded-md border-4 border-dark-walnut lg:col-span-8 lg:h-[calc(100dvh-15rem)] lg:min-h-[560px]"
        >
          <ReactFlow
            nodes={renderedNodes}
            edges={renderedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_event, node) => selectNode(node as EvidenceFlowNode)}
            onNodeMouseEnter={(_event, node) => setHoveredId(node.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            onPaneClick={() => {
              setSelectedId(null);
              setMobileInspectorOpen(false);
            }}
            fitView
            minZoom={0.03}
            maxZoom={1.7}
            nodeOrigin={[0.5, 0.5]}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            nodesDraggable
            elevateNodesOnSelect
            className="rounded-sm"
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} color="rgba(232,220,197,0.16)" bgColor="transparent" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              className="!hidden lg:!block"
              pannable
              zoomable
              nodeColor={(node) => {
                const data = node.data as { node?: GraphNode };
                return data.node ? kindAccent(data.node.kind) : "#8e3830";
              }}
              maskColor="rgba(23,18,15,0.72)"
              position="bottom-right"
            />
          </ReactFlow>

          {!filtered.length ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="rounded-md border border-outline-variant bg-surface-container/95 p-5 text-center">
                <Network className="mx-auto h-5 w-5 text-primary/70" />
                <p className="mt-2 font-headline text-headline-sm text-on-surface">No pinned records match.</p>
                <p className="mt-1 max-w-xs font-body text-body-sm text-on-surface-variant">Clear the search or enable more evidence types. The board only renders actual graph records.</p>
              </div>
            </div>
          ) : null}

          {filtered.length > displayed.length ? (
            <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
              <Button variant="secondary" size="sm" onClick={() => setVisibleLimit((value) => value + 70)}>
                Expand board +{Math.min(70, filtered.length - displayed.length)}
              </Button>
            </div>
          ) : null}

          {demo ? (
            <div className="absolute right-3 top-3 z-10 rounded-sm border border-primary/50 bg-deep-charcoal/90 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-primary">
              Demo data
            </div>
          ) : null}
        </section>

        <aside className="rounded-md border border-outline-variant bg-surface-container lg:col-span-4">
          <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-primary">Node inspector</p>
              <p className="truncate font-mono text-[10px] text-on-surface-variant">{repoFullName} · {branch}</p>
            </div>
            <button
              className="rounded border border-outline-variant px-2 py-1 font-label text-[9px] uppercase text-on-surface-variant lg:hidden"
              onClick={() => setMobileInspectorOpen((value) => !value)}
              aria-expanded={mobileInspectorOpen}
            >
              {mobileInspectorOpen ? "Hide" : "Open"}
            </button>
          </div>

          <div className={cn("flex flex-col gap-4 p-4", mobileInspectorOpen ? "block" : "hidden lg:flex")}>
            {inspectedNode ? (
              <Inspector
                node={inspectedNode}
                direct={directSet.has(inspectedNode.id)}
                demo={demo}
                caseId={caseId}
                connectedEdges={connectedEdges}
                graphNodes={graph.nodes}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Network className="h-6 w-6 text-primary/60" aria-hidden="true" />
                <p className="font-headline text-headline-sm text-on-surface">Select a pinned exhibit.</p>
                <p className="max-w-xs font-body text-body-sm text-on-surface-variant">
                  Hover to preview. Click a node to illuminate its evidence path and inspect the source record.
                </p>
                {question ? (
                  <div className="mt-2 rounded border border-outline-variant bg-surface-container-low p-3">
                    <p className="font-label text-[9px] uppercase tracking-wider text-on-surface-variant">Investigation question</p>
                    <p className="mt-1 font-body text-body-sm text-on-surface">{question}</p>
                  </div>
                ) : null}
                {caseId ? (
                  <Link href={demo ? "/report/demo" : `/report/${encodeURIComponent(caseId)}`} className="mt-2 font-label text-label-sm uppercase text-primary hover:underline">
                    Open the dossier
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </div>

      {evidenceCount !== undefined ? (
        <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70">
          {evidenceCount} evidence records support this dossier · board renders {graph.nodes.length} graph nodes / {graph.edges.length} relationships
        </p>
      ) : null}
    </div>
  );
}

function Inspector({
  node,
  direct,
  demo,
  caseId,
  connectedEdges,
  graphNodes,
}: {
  node: GraphNode;
  direct: boolean;
  demo?: boolean;
  caseId?: string;
  connectedEdges: GraphEdge[];
  graphNodes: GraphNode[];
}) {
  const byId = new Map(graphNodes.map((item) => [item.id, item]));
  const focusLink = (() => {
    const props = node.properties;
    if (node.kind === "file" && typeof props.path === "string") {
      return `/investigate?focusType=file&focus=${encodeURIComponent(props.path)}`;
    }
    if (node.kind === "commit" && typeof props.sha === "string") {
      return `/investigate?focusType=commit&focus=${encodeURIComponent(props.sha)}`;
    }
    if (node.kind === "pullRequest" && typeof props.number === "number") {
      return `/investigate?focusType=pullRequest&focus=${encodeURIComponent(String(props.number))}`;
    }
    if (node.kind === "issue" && typeof props.number === "number") {
      return `/investigate?focusType=issue&focus=${encodeURIComponent(String(props.number))}`;
    }
    return null;
  })();

  const propEntries = Object.entries(node.properties)
    .filter(([key, value]) => value !== null && value !== "" && key !== "id" && !["body", "commentsText", "excerpt", "rationale", "summary"].includes(key))
    .slice(0, 10);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Badge variant={direct ? "brass" : "neutral"} dot={direct ? "primary" : "neutral"}>
            {kindLabel(node.kind)}
          </Badge>
          <h2 className="mt-2 font-headline text-headline-md text-on-surface">{node.label}</h2>
          {node.sublabel ? <p className="mt-1 break-all font-mono text-mono-sm text-on-surface-variant">{node.sublabel}</p> : null}
        </div>
        <span className="brass-pin mt-1" aria-hidden="true" />
      </div>

      {node.date ? (
        <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          {formatDate(node.date, true)} {direct ? "· direct evidence" : "· contextual graph record"}
        </p>
      ) : null}

      {node.properties.body || node.properties.rationale || node.properties.summary || node.properties.excerpt ? (
        <p className="max-h-38 overflow-y-auto rounded border border-outline-variant bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">
          {String(node.properties.rationale ?? node.properties.summary ?? node.properties.body ?? node.properties.excerpt).slice(0, 900)}
        </p>
      ) : null}

      <div>
        <p className="mb-2 font-label text-[9px] uppercase tracking-[0.14em] text-on-surface-variant">Graph properties</p>
        <dl className="grid grid-cols-1 gap-1.5">
          {propEntries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[100px_1fr] gap-2 border-b border-outline-variant/50 pb-1">
              <dt className="font-mono text-[10px] uppercase text-on-surface-variant">{key}</dt>
              <dd className="break-all font-mono text-[10px] text-on-surface">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="mb-2 font-label text-[9px] uppercase tracking-[0.14em] text-on-surface-variant">Neo4j relationships · {connectedEdges.length}</p>
        <div className="flex flex-col gap-1.5">
          {connectedEdges.slice(0, 14).map((edge) => {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            const other = byId.get(otherId);
            return (
              <div key={edge.id} className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-low px-2.5 py-1.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-secondary">{edge.type}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-on-surface">{other?.label ?? otherId}</span>
              </div>
            );
          })}
          {!connectedEdges.length ? <p className="font-body text-body-sm text-on-surface-variant">No relationships in the visible subgraph.</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-3">
        {node.url && !demo ? (
          <a href={node.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-2.5 py-1.5 font-label text-[10px] uppercase tracking-wider text-primary hover:border-primary">
            <ExternalLink className="h-3 w-3" /> Original source
          </a>
        ) : (
          <span className="inline-flex items-center rounded border border-outline-variant px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">
            {demo ? "Demo · no source URL" : "Source URL unavailable"}
          </span>
        )}
        {focusLink ? (
          <ButtonLink href={focusLink} variant="secondary" size="sm" icon={<Search className="h-3 w-3" />}>
            Investigate
          </ButtonLink>
        ) : null}
        {caseId ? (
          <ButtonLink href={demo ? "/report/demo" : `/report/${encodeURIComponent(caseId)}`} variant="ghost" size="sm">
            Open dossier
          </ButtonLink>
        ) : null}
      </div>
    </>
  );
}
