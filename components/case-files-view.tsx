"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Database, FolderSearch, Plus, RefreshCw, Trash2,
} from "lucide-react";
import type { CaseFileSummary } from "@/lib/types";
import { DEMO_CASE } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Modal } from "@/components/ui/modal";
import { cn, formatDate, truncate } from "@/lib/utils";

export function CaseFilesView() {
  const [cases, setCases] = useState<CaseFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseFileSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/investigations", { cache: "no-store" });
      const body = (await response.json()) as { cases?: CaseFileSummary[]; error?: string };
      if (!response.ok || !body.cases) throw new Error(body.error || "Could not read saved cases.");
      setCases(body.cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read saved cases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/investigations/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const body = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !body.deleted) throw new Error(body.error || "The case could not be deleted.");
      setCases((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "The case could not be deleted.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="lamp-wash min-h-[calc(100dvh-4rem)] pb-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 md:px-page-margin md:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-5">
          <div>
            <p className="mb-2 font-label text-label-md uppercase tracking-[0.2em] text-primary">Archive</p>
            <h1 className="font-headline text-[32px] leading-[38px] text-on-surface md:text-headline-lg">Case Files</h1>
            <p className="mt-2 max-w-xl font-body text-body-md text-on-surface-variant">
              Reopen previous repository investigations, dossiers and evidence boards. Cases are scoped to this browser session and persisted in Neo4j.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <ButtonLink href="/connect" size="md" icon={<Plus className="h-4 w-4" />}>New Case</ButtonLink>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success" dot="success">Persistent · Neo4j</Badge>
          <Badge variant="outline">{cases.length} saved case{cases.length === 1 ? "" : "s"}</Badge>
          <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            Session-scoped ownership enforced server-side
          </span>
        </div>

        {loading && !cases.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="rounded-md border border-outline-variant bg-surface-container p-6">
                <div className="shimmer mb-3 h-3 w-1/3 rounded-sm" />
                <div className="shimmer mb-2 h-6 w-5/6 rounded-sm" />
                <div className="shimmer h-16 w-full rounded-sm" />
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <ErrorState
            title="The archive could not be opened."
            message={error}
            onRetry={() => void load()}
            action={<ButtonLink href="/connect" variant="secondary" size="sm">Connect repository</ButtonLink>}
          />
        ) : null}

        {!loading && !error && !cases.length ? (
          <EmptyState
            title="No cases filed yet."
            message="Run an investigation and its dossier will be saved here with its evidence references. Nothing is invented to fill the archive."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/connect">Connect repository</ButtonLink>
                <ButtonLink href="/report/demo" variant="secondary">Open demo dossier</ButtonLink>
              </div>
            }
          />
        ) : null}

        {cases.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cases.map((item, index) => {
              const paper = index === 0 && item.status === "answered";
              const high = item.confidence >= 70;
              return (
                <article
                  key={item.id}
                  className={cn(
                    "flex h-full flex-col justify-between gap-4 rounded-md border p-5 md:p-6",
                    paper
                      ? "paper-sheet border-primary/60 text-on-paper"
                      : "border-outline-variant bg-surface-container text-on-surface",
                  )}
                >
                  <div className="flex flex-col gap-3">
                    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b pb-2 font-mono text-[10px] uppercase tracking-wider", paper ? "border-paper-muted/25" : "border-outline-variant")}>
                      <span className={paper ? "text-secondary" : "text-primary"}>CASE {item.id.replace("inv_", "").slice(-8).toUpperCase()} · {item.repoFullName}</span>
                      <span className={paper ? "text-paper-muted" : "text-on-surface-variant"}>{formatDate(item.createdAt)}</span>
                    </div>
                    <h2 className={cn("font-headline text-headline-sm", paper ? "text-on-paper" : "text-on-surface")}>{item.question}</h2>
                    <p className={cn("font-body text-body-sm", paper ? "text-paper-muted" : "text-on-surface-variant")}>
                      {truncate(item.summary, 240)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.status === "answered" ? (
                        <Badge variant={paper ? "paper" : "success"}><CheckCircle2 className="h-3 w-3" /> Answered</Badge>
                      ) : (
                        <Badge variant={paper ? "paper" : "danger"}><AlertTriangle className="h-3 w-3" /> Abstained</Badge>
                      )}
                      <Badge variant={paper ? "paper" : high ? "brass" : "neutral"}>{item.confidence}% confidence</Badge>
                      <Badge variant={paper ? "paper" : "outline"}>{item.evidenceCount} evidence</Badge>
                    </div>
                  </div>
                  <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t pt-3", paper ? "border-paper-muted/25" : "border-outline-variant")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/report/${encodeURIComponent(item.id)}`} className={cn("inline-flex items-center gap-1 font-label text-[11px] uppercase tracking-wider hover:underline", paper ? "text-secondary" : "text-primary")}>
                        Reopen dossier
                      </Link>
                      <Link href={`/board?case=${encodeURIComponent(item.id)}`} className={cn("font-label text-[11px] uppercase tracking-wider hover:underline", paper ? "text-paper-muted" : "text-on-surface-variant")}>
                        Evidence board
                      </Link>
                    </div>
                    <button
                      onClick={() => { setDeleteTarget(item); setDeleteError(null); }}
                      className={cn("inline-flex items-center gap-1 font-label text-[10px] uppercase tracking-wider", paper ? "text-paper-muted hover:text-secondary" : "text-on-surface-variant hover:text-[#ffc7c2]")}
                      aria-label={`Delete case: ${item.question}`}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        <section className="mt-2 overflow-hidden rounded-md border border-primary/35 bg-primary/5">
          <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-primary/40 bg-surface-container text-primary">
                <FolderSearch className="h-4 w-4" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-headline text-headline-sm text-on-surface">Demo case</h2>
                  <Badge variant="brass">DEMO DATA</Badge>
                </div>
                <p className="mt-1 max-w-xl font-body text-body-sm text-on-surface-variant">
                  {DEMO_CASE.question} · a synthetic, fully labelled dossier for exploring the interface without a live Neo4j graph.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <ButtonLink href="/report/demo" variant="secondary" size="sm">Open dossier</ButtonLink>
              <ButtonLink href="/board?demo=1" variant="ghost" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>Board</ButtonLink>
            </div>
          </div>
        </section>

        <div className="flex items-start gap-2 rounded border border-outline-variant bg-surface-container-low p-3">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
          <p className="font-body text-body-sm text-on-surface-variant">
            Case files live in Neo4j and survive a server restart. The anonymous session cookie is the ownership scope; clearing cookies or changing browsers hides this archive from the new session.
          </p>
        </div>
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        title="Delete this case?"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={() => void confirmDelete()} icon={<Trash2 className="h-3.5 w-3.5" />}>
              Delete case
            </Button>
          </>
        }
      >
        <p>
          The saved dossier for <strong className="text-on-surface">“{deleteTarget?.question}”</strong> will be permanently removed from Neo4j. Repository evidence is not deleted.
        </p>
        {deleteError ? <p className="mt-3 font-mono text-mono-sm text-[#ffc7c2]">{deleteError}</p> : null}
      </Modal>
    </main>
  );
}
