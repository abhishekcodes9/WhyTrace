"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Network } from "lucide-react";
import type { EvidenceGraph, InvestigationReport } from "@/lib/types";
import { useRepo } from "@/components/repo-provider";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/utils";

const EvidenceBoard = dynamic(() => import("@/components/evidence-board").then((module) => module.EvidenceBoard), {
  ssr: false,
  loading: () => <BoardSkeleton />,
});

interface BoardData {
  graph: EvidenceGraph;
  report: InvestigationReport | null;
  repoFullName: string;
  branch: string;
  caseId?: string;
  demo: boolean;
}

export function BoardPageView() {
  const searchParams = useSearchParams();
  const { repository, hydrated } = useRepo();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const demo = searchParams.get("demo") === "1";
  const caseId = searchParams.get("case") ?? searchParams.get("investigation");
  const repoParam = searchParams.get("repo");

  const targetRepo = useMemo(() => repoParam || repository?.fullName || null, [repoParam, repository?.fullName]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        if (demo) {
          const response = await fetch("/api/demo", { cache: "no-store" });
          const body = (await response.json()) as { report?: InvestigationReport; error?: string };
          if (!response.ok || !body.report) throw new Error(body.error || "The demo board could not be loaded.");
          if (!cancelled) {
            setData({
              graph: body.report.graph,
              report: body.report,
              repoFullName: body.report.repoFullName,
              branch: body.report.branch,
              caseId: body.report.id,
              demo: true,
            });
          }
          return;
        }
        if (caseId) {
          const response = await fetch(`/api/investigations/${encodeURIComponent(caseId)}`, { cache: "no-store" });
          const body = (await response.json()) as { report?: InvestigationReport; error?: string };
          if (!response.ok || !body.report) throw new Error(body.error || "The case file could not be opened.");
          if (!cancelled) {
            setData({
              graph: body.report.graph,
              report: body.report,
              repoFullName: body.report.repoFullName,
              branch: body.report.branch,
              caseId: body.report.id,
              demo: Boolean(body.report.demo),
            });
          }
          return;
        }
        if (!targetRepo) {
          if (!cancelled) {
            setLoading(false);
            setError("NO_REPO");
          }
          return;
        }
        const response = await fetch(`/api/graph?repoFullName=${encodeURIComponent(targetRepo)}&limit=220`, { cache: "no-store" });
        const body = (await response.json()) as { graph?: EvidenceGraph; error?: string };
        if (!response.ok || !body.graph) throw new Error(body.error || "The repository graph could not be loaded.");
        const repositoryNode = body.graph.nodes.find((node) => node.kind === "repository");
        const graphBranch = repositoryNode?.properties.branch;
        if (!cancelled) {
          setData({
            graph: body.graph,
            report: null,
            repoFullName: targetRepo,
            branch: typeof graphBranch === "string" ? graphBranch : repository?.branch ?? "unknown",
            demo: false,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "The evidence board could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [hydrated, demo, caseId, targetRepo, repository?.branch]);

  if (!hydrated || loading) {
    return (
      <main className="lamp-wash min-h-[calc(100dvh-4rem)]">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-page-margin">
          <div className="mb-4 flex items-center gap-3">
            <div className="shimmer h-8 w-48 rounded-sm" />
          </div>
          <BoardSkeleton />
        </div>
      </main>
    );
  }

  if (error === "NO_REPO") {
    return (
      <main className="lamp-wash flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
        <EmptyState
          title="No evidence board is open."
          message="Connect a repository to build its graph, open a saved dossier, or explore the synthetic demo board."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/connect">Connect repository</ButtonLink>
              <ButtonLink href="/board?demo=1" variant="secondary">Explore demo board</ButtonLink>
            </div>
          }
          className="max-w-xl"
        />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="lamp-wash flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
        <div className="w-full max-w-xl">
          <ErrorState title="The evidence board could not be assembled." message={error || "Unknown error."} action={<ButtonLink href="/connect" variant="secondary" size="sm">Connect repository</ButtonLink>} />
        </div>
      </main>
    );
  }

  const directIds = data.report?.evidence.map((item) => item.id) ?? [];
  return (
    <main className="lamp-wash min-h-[calc(100dvh-4rem)] pb-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:px-page-margin md:py-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {data.caseId ? (
                <Link href={data.demo ? "/report/demo" : `/report/${encodeURIComponent(data.caseId)}`} className="inline-flex items-center gap-1.5 font-label text-label-sm uppercase text-primary hover:underline">
                  <ArrowLeft className="h-3 w-3" /> Dossier
                </Link>
              ) : (
                <Link href="/investigate" className="inline-flex items-center gap-1.5 font-label text-label-sm uppercase text-primary hover:underline">
                  <ArrowLeft className="h-3 w-3" /> Workspace
                </Link>
              )}
              {data.demo ? <Badge variant="brass">Demo data</Badge> : null}
              {data.report ? <Badge variant="outline">Case {data.report.caseNumber}</Badge> : <Badge variant="outline">Repository graph</Badge>}
            </div>
            <h1 className="font-headline text-[30px] leading-[36px] text-on-surface md:text-headline-lg">Evidence Board</h1>
            <p className="mt-1 font-mono text-mono-sm text-on-surface-variant">
              {data.repoFullName} · branch {data.branch}
              {data.report ? ` · filed ${formatDate(data.report.createdAt)}` : ""}
            </p>
            {data.report ? (
              <p className="mt-2 max-w-2xl font-body text-body-sm text-on-surface-variant">
                “{data.report.question}”
              </p>
            ) : (
              <p className="mt-2 max-w-2xl font-body text-body-sm text-on-surface-variant">
                Persisted repository subgraph read from Neo4j. Select a pinned record to inspect its actual properties and relationships.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.report ? (
              <ButtonLink href={data.demo ? "/report/demo" : `/report/${encodeURIComponent(data.report.id)}`} variant="secondary" size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                Open dossier
              </ButtonLink>
            ) : null}
            <ButtonLink href="/investigate" variant="ghost" size="sm" icon={<Network className="h-3.5 w-3.5" />}>
              New inquiry
            </ButtonLink>
          </div>
        </div>

        {data.demo ? (
          <div className="rounded border border-primary/35 bg-primary/8 px-3 py-2 font-label text-[10px] uppercase tracking-[0.12em] text-primary">
            DEMO DATA · synthetic nodes and relationships · no live Neo4j read produced this board
          </div>
        ) : null}

        <EvidenceBoard
          graph={data.graph}
          repoFullName={data.repoFullName}
          branch={data.branch}
          question={data.report?.question}
          caseId={data.report?.id}
          demo={data.demo}
          directIds={directIds}
          evidenceCount={data.report?.evidence.length}
        />
      </div>
    </main>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="corkboard relative h-[58vh] min-h-[440px] rounded-md border-4 border-dark-walnut lg:col-span-8 lg:h-[calc(100dvh-15rem)]">
        <div className="absolute inset-6 grid grid-cols-3 gap-4 opacity-50">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="h-20 rounded border border-primary/20 bg-paper/25" />
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <LoadingState label="Pinning evidence…" />
        </div>
      </div>
      <div className="rounded-md border border-outline-variant bg-surface-container p-4 lg:col-span-4">
        <div className="shimmer mb-3 h-4 w-1/2 rounded-sm" />
        <div className="shimmer mb-2 h-8 w-full rounded-sm" />
        <div className="shimmer h-40 w-full rounded-sm" />
      </div>
    </div>
  );
}
