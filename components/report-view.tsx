"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown,
  CircleHelp, ExternalLink, FileCode2, FileText, GitBranch, GitCommitHorizontal, GitPullRequest,
  MessageSquare, Network, Sparkles, UserRound, XCircle,
} from "lucide-react";
import { GithubLogo as Github } from "@/components/icons";
import type { Citation, Claim, EvidenceItem, InvestigationReport, SourceKind } from "@/lib/types";
import { DossierOpen } from "@/components/motion";
import { Badge, Stamp } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const KIND_LABEL: Record<SourceKind, string> = {
  file: "FILE",
  commit: "COMMIT",
  pullRequest: "PULL REQUEST",
  issue: "ISSUE",
  discussion: "DISCUSSION",
  developer: "DEVELOPER",
  decision: "DECISION",
  designDocument: "DESIGN DOCUMENT",
  incident: "INCIDENT",
};

function kindIcon(kind: SourceKind) {
  switch (kind) {
    case "commit": return <GitCommitHorizontal className="h-3.5 w-3.5" />;
    case "pullRequest": return <GitPullRequest className="h-3.5 w-3.5" />;
    case "issue": return <CircleHelp className="h-3.5 w-3.5" />;
    case "discussion": return <MessageSquare className="h-3.5 w-3.5" />;
    case "decision": return <Sparkles className="h-3.5 w-3.5" />;
    case "designDocument": return <FileText className="h-3.5 w-3.5" />;
    case "file": return <FileCode2 className="h-3.5 w-3.5" />;
    case "developer": return <UserRound className="h-3.5 w-3.5" />;
    case "incident": return <AlertTriangle className="h-3.5 w-3.5" />;
  }
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={`${part}-${index}`} className="inline-code">{part.slice(1, -1)}</code>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function CitationChip({ citation, demo }: { citation?: Citation; demo?: boolean }) {
  if (!citation) return null;
  const url = citation.url;
  const label = citation.reference;
  if (demo || !url) {
    return (
      <span className="ml-1 inline-flex items-center rounded-sm border border-paper-muted/30 bg-warm-cream/60 px-1.5 py-0.5 align-baseline font-mono text-[10px] text-secondary" title="DEMO DATA · source unavailable">
        {label} · DEMO
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1 inline-flex items-center gap-0.5 rounded-sm border border-paper-muted/30 bg-warm-cream/60 px-1.5 py-0.5 align-baseline font-mono text-[10px] text-secondary underline decoration-secondary/35 underline-offset-2 hover:border-secondary/50 hover:decoration-secondary"
      title={`Open original source: ${label}`}
    >
      {label}
      <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
    </a>
  );
}

function ClaimList({
  claims,
  evidenceById,
  demo,
  numbered = false,
}: {
  claims: Claim[];
  evidenceById: Map<string, EvidenceItem>;
  demo?: boolean;
  numbered?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {claims.map((claim, index) => (
        <li key={`${claim.text.slice(0, 40)}-${index}`} className="flex items-baseline gap-2 font-body text-body-md text-on-paper">
          {numbered ? <span className="shrink-0 font-mono text-mono-sm text-secondary">[{index + 1}]</span> : <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary/70" aria-hidden="true" />}
          <span>
            <RichText text={claim.text} />
            {claim.evidenceIds.map((id) => {
              const evidence = evidenceById.get(id);
              return (
                <CitationChip
                  key={id}
                  demo={demo}
                  citation={evidence ? { evidenceId: id, kind: evidence.kind, title: evidence.title, reference: evidence.reference, url: evidence.url } : undefined}
                />
              );
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({ number, title, badge }: { number: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-label text-label-md uppercase tracking-[0.14em] text-on-paper">
        <span className="mr-2 font-mono text-secondary/80">{number}</span>
        {title}
      </h2>
      {badge}
    </div>
  );
}

function EvidenceQualityBlock({ report }: { report: InvestigationReport }) {
  const quality = report.evidenceQuality;
  const tone = quality.label === "high" ? "success" : quality.label === "medium" ? "brass" : "danger";
  return (
    <div className="rounded border border-paper-muted/30 bg-warm-cream/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-label text-label-md uppercase tracking-wider text-on-paper">Evidence quality</span>
        <Badge variant={report.demo ? "paper" : tone === "success" ? "success" : tone === "brass" ? "brass" : "danger"}>
          {report.demo ? "DEMO · " : ""}{quality.label.toUpperCase()} · {quality.confidence}%
        </Badge>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-muted/25">
        <div
          className={cn("h-full rounded-full", quality.label === "high" ? "bg-success" : quality.label === "medium" ? "bg-[#9b7437]" : "bg-secondary")}
          style={{ width: `${quality.confidence}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px] text-paper-muted">
        <span><strong className="block text-title-sm text-on-paper">{quality.evidenceCount}</strong>records</span>
        <span><strong className="block text-title-sm text-on-paper">{quality.directCount}</strong>direct</span>
        <span><strong className="block text-title-sm text-on-paper">{quality.coverage}%</strong>coverage</span>
      </div>
      <p className="mt-3 font-body text-body-sm text-paper-muted">{quality.explanation}</p>
      {quality.sourceTypes.length ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-paper-muted">
          Sources: {quality.sourceTypes.map((kind) => KIND_LABEL[kind as SourceKind] ?? kind).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

export function ReportView({ id }: { id: string }) {
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = id === "demo" ? await fetch("/api/demo", { cache: "no-store" }) : await fetch(`/api/investigations/${encodeURIComponent(id)}`, { cache: "no-store" });
        const body = (await response.json()) as { report?: InvestigationReport; error?: string };
        if (!response.ok || !body.report) throw new Error(body.error || "The case file could not be opened.");
        if (!cancelled) setReport(body.report);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "The case file could not be opened.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  const evidenceById = useMemo(() => new Map((report?.evidence ?? []).map((item) => [item.id, item])), [report]);

  if (loading) {
    return <main className="lamp-wash flex min-h-[calc(100dvh-4rem)] items-center justify-center"><LoadingState label="Opening the dossier…" /></main>;
  }
  if (error || !report) {
    return (
      <main className="lamp-wash flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
        <div className="w-full max-w-xl">
          <ErrorState title="Case file unavailable." message={error || "The dossier could not be found."} action={<ButtonLink href="/files" variant="secondary" size="sm">Open Case Files</ButtonLink>} />
        </div>
      </main>
    );
  }

  const answered = report.status === "answered";
  const sourceItems = report.evidence.filter((item) => item.url && !report.demo);
  const commits = report.evidence.filter((item) => item.kind === "commit");
  const pulls = report.evidence.filter((item) => item.kind === "pullRequest");
  const issues = report.evidence.filter((item) => item.kind === "issue" || item.kind === "incident");
  const discussions = report.evidence.filter((item) => item.kind === "discussion");
  const documents = report.evidence.filter((item) => item.kind === "designDocument" || item.kind === "decision");

  return (
    <main className="lamp-wash min-h-[calc(100dvh-4rem)] pb-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-page-margin md:py-8">
        {report.demo ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2.5">
            <p className="font-label text-label-sm uppercase tracking-[0.14em] text-primary">
              DEMO DATA · synthetic case · no GitHub, Neo4j or Gemini request was made
            </p>
            <Link href="/connect" className="font-label text-label-sm uppercase text-primary hover:underline">Run a real investigation</Link>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/investigate" className="inline-flex items-center gap-1.5 font-label text-label-md uppercase text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> New inquiry
            </Link>
            <span className="text-on-surface-variant/50">/</span>
            <span className="font-mono text-mono-sm text-on-surface-variant">CASE {report.caseNumber} · {report.repoFullName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 py-1.5">
              <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">Evidence</span>
              <span className="font-mono text-mono-sm text-primary">{report.evidenceQuality.confidence}% · {report.evidenceQuality.label.toUpperCase()}</span>
            </div>
            <Link href={report.demo ? "/board?demo=1" : `/board?case=${encodeURIComponent(report.id)}`} className={buttonClasses("secondary", "sm")}>
              <Network className="h-3.5 w-3.5" /> View evidence board
            </Link>
          </div>
        </div>

        <DossierOpen className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <article className="paper-sheet relative rounded-md border border-primary/50 p-5 text-on-paper md:p-8 lg:col-span-7">
            <div className="pointer-events-none absolute right-5 top-5 hidden sm:block">
              <Stamp tone={answered ? "oxblood" : "ink"}>{answered ? "Evidence on file" : "Insufficient evidence"}</Stamp>
            </div>

            <header className="border-b-2 border-paper-muted/25 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-wider">
                <span className="text-secondary">Investigation dossier · {report.caseNumber}</span>
                <span className="text-paper-muted">Filed {formatDate(report.createdAt)}</span>
              </div>
              <h1 className="mt-3 text-balance font-headline text-[27px] font-semibold leading-[33px] text-on-paper md:text-headline-lg">
                {report.question}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-paper-muted">
                <span className="inline-flex items-center gap-1"><Github className="h-3 w-3" /> {report.repoFullName}</span>
                <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" /> {report.branch}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {formatDateTime(report.createdAt)}</span>
                {report.focus ? <span>focus: {report.focus.type} · {report.focus.value}</span> : null}
              </div>
            </header>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {report.synthesis.status === "completed" ? (
                <Badge variant="success"><Sparkles className="h-3 w-3" /> AI synthesis complete</Badge>
              ) : report.synthesis.status === "not_configured" ? (
                <Badge variant="danger"><AlertTriangle className="h-3 w-3" /> AI synthesis not configured</Badge>
              ) : (
                <Badge variant="danger"><XCircle className="h-3 w-3" /> AI synthesis unavailable</Badge>
              )}
              <Tooltip label={report.synthesis.message}>
                <span className="cursor-help font-mono text-[10px] text-paper-muted underline decoration-dotted underline-offset-2">
                  {report.synthesis.model ?? "deterministic report"}
                </span>
              </Tooltip>
              <span className="font-mono text-[10px] text-paper-muted">{report.citations.length} validated citations</span>
            </div>

            <section className="mt-6">
              <SectionHeading
                number="1."
                title="Direct answer"
                badge={
                  answered ? (
                    <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Documented answer</Badge>
                  ) : (
                    <Badge variant="danger"><AlertTriangle className="h-3 w-3" /> Abstained</Badge>
                  )
                }
              />
              <div className={cn("mt-3 rounded border p-4", answered ? "border-success/25 bg-success/5" : "border-secondary/25 bg-secondary/5")}>
                <p className="font-body text-body-md leading-relaxed text-on-paper">
                  <RichText text={report.summary} />
                </p>
                {!answered ? (
                  <p className="mt-2 border-t border-paper-muted/20 pt-2 font-mono text-[11px] text-paper-muted">
                    WHYTRACE did not convert insufficient evidence into an answer. Retrieved records remain available below for inspection.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="mt-6 border-t border-paper-muted/25 pt-4">
              <SectionHeading
                number="2."
                title="Documented rationale"
                badge={<Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Documented fact</Badge>}
              />
              <div className="mt-3">
                {report.documentedRationale.length ? (
                  <ClaimList claims={report.documentedRationale} evidenceById={evidenceById} demo={report.demo} numbered />
                ) : (
                  <p className="rounded border border-paper-muted/25 bg-warm-cream/40 p-3 font-body text-body-sm text-paper-muted">
                    No documented rationale was found in the retrieved records. Absence of documentation is not evidence of a reason.
                  </p>
                )}
              </div>
            </section>

            <section className="mt-6 border-t border-paper-muted/25 pt-4">
              <SectionHeading
                number="3."
                title="Technical observations"
                badge={<Badge variant="brass">Observed from evidence</Badge>}
              />
              <div className="mt-3">
                {report.technicalObservations.length ? (
                  <ClaimList claims={report.technicalObservations} evidenceById={evidenceById} demo={report.demo} />
                ) : (
                  <p className="font-body text-body-sm text-paper-muted">No technical observation was asserted beyond the retrieved records.</p>
                )}
              </div>
            </section>

            <section className="mt-6 border-t border-paper-muted/25 pt-4">
              <SectionHeading
                number="4."
                title="Probable inference"
                badge={<Badge variant="brass"><CircleHelp className="h-3 w-3" /> Labelled inference</Badge>}
              />
              <div className="mt-3">
                {report.inferences.length ? (
                  <ClaimList claims={report.inferences} evidenceById={evidenceById} demo={report.demo} />
                ) : (
                  <p className="font-body text-body-sm text-paper-muted">No inference was made. This is deliberate.</p>
                )}
              </div>
            </section>

            <section className="mt-6 border-t border-paper-muted/25 pt-4">
              <SectionHeading number="5." title="Uncertainty & evidence gaps" badge={<Badge variant="paper">Explicit limits</Badge>} />
              <ul className="mt-3 flex flex-col gap-2">
                {(report.uncertainties.length ? report.uncertainties : ["No uncertainty statement was returned."]).map((item, index) => (
                  <li key={`${item.slice(0, 30)}-${index}`} className="flex items-start gap-2 font-body text-body-sm text-paper-muted">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary/80" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-6 border-t border-paper-muted/25 pt-4">
              <SectionHeading
                number="6."
                title="Decision status"
                badge={
                  <Badge variant={report.supersessionStatus === "superseded" ? "danger" : report.supersessionStatus === "active" ? "success" : "paper"}>
                    {report.supersessionStatus.toUpperCase()}
                  </Badge>
                }
              />
              <p className="mt-3 font-body text-body-md text-on-paper">{report.supersessionNote}</p>
            </section>

            <section className="mt-6 border-t border-paper-muted/25 pt-4">
              <SectionHeading number="7." title="Evidence quality & coverage" />
              <div className="mt-3"><EvidenceQualityBlock report={report} /></div>
            </section>

            {report.timeline.length ? (
              <section className="mt-6 border-t border-paper-muted/25 pt-4">
                <SectionHeading number="8." title="Historical timeline" />
                <ol className="relative mt-4 ml-1 border-l border-paper-muted/30 pl-5">
                  {report.timeline.map((event, index) => (
                    <li key={`${event.date}-${event.reference}-${index}`} className="relative pb-4 last:pb-0">
                      <span className="absolute -left-[25px] top-1 h-2 w-2 rounded-full border border-paper bg-secondary" aria-hidden="true" />
                      <p className="font-mono text-[10px] uppercase tracking-wider text-paper-muted">{formatDate(event.date)} · {KIND_LABEL[event.kind as SourceKind] ?? event.kind}</p>
                      {event.url ? (
                        <a href={event.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block font-body text-body-sm text-on-paper underline decoration-paper-muted/40 underline-offset-2 hover:text-secondary">
                          {event.title}
                        </a>
                      ) : (
                        <p className="mt-0.5 font-body text-body-sm text-on-paper">{event.title}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-paper-muted/25 pt-4">
              <p className="font-mono text-[10px] text-paper-muted">
                Evidence IDs preserved · {report.evidence.length} records · {report.developers.length} developers
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/investigate" className={buttonClasses("paper", "sm")}>New inquiry</Link>
                <Link href={report.demo ? "/board?demo=1" : `/board?case=${encodeURIComponent(report.id)}`} className={buttonClasses("paper", "sm")}>
                  <Network className="h-3.5 w-3.5" /> Evidence board
                </Link>
              </div>
            </div>
          </article>

          <aside className="flex flex-col gap-5 lg:col-span-5">
            <section className="rounded-md border border-outline-variant bg-surface-container">
              <header className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">A · Supporting records</h2>
                <span className="font-mono text-mono-sm text-on-surface-variant">{report.evidence.length}</span>
              </header>
              <div className="flex flex-col gap-4 p-4">
                <EvidenceGroup title="Commits" items={commits} demo={report.demo} />
                <EvidenceGroup title="Pull requests" items={pulls} demo={report.demo} />
                <EvidenceGroup title="Issues & incidents" items={issues} demo={report.demo} />
                <EvidenceGroup title="Decisions & documents" items={documents} demo={report.demo} />
                <EvidenceGroup title="Discussions" items={discussions} demo={report.demo} />
                {!report.evidence.length ? <p className="font-body text-body-sm text-on-surface-variant">No evidence records were retrieved.</p> : null}
              </div>
            </section>

            <section className="rounded-md border border-outline-variant bg-surface-container">
              <header className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">B · Changed files & diffs</h2>
                <span className="font-mono text-mono-sm text-on-surface-variant">{report.changedFiles.length}</span>
              </header>
              <div className="flex flex-col gap-3 p-4">
                {report.changedFiles.length ? (
                  report.changedFiles.map((file) => (
                    <details key={`${file.source}-${file.path}`} className="group rounded border border-outline-variant bg-surface-container-low">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0">
                          <p className="break-all font-mono text-mono-sm text-on-surface">{file.path}</p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                            {file.source ? `${file.source} · ` : ""}{file.status}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                          <span className="text-[#86b592]">+{file.additions}</span>
                          <span className="text-[#d8938b]">−{file.deletions}</span>
                          <ChevronDown className="h-3.5 w-3.5 text-on-surface-variant transition-transform group-open:rotate-180" />
                        </div>
                      </summary>
                      <div className="border-t border-outline-variant bg-deep-charcoal/80 p-3">
                        {file.patch ? (
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[18px] text-on-surface-variant">
                            {file.patch.split("\n").map((line, index) => (
                              <span key={index} className={cn("block", line.startsWith("+") ? "diff-line diff-add" : line.startsWith("-") ? "diff-line diff-del" : "diff-line")}>{line || " "}</span>
                            ))}
                          </pre>
                        ) : (
                          <p className="font-body text-body-sm text-on-surface-variant">No patch was retrieved for this file. GitHub may omit large or binary diffs.</p>
                        )}
                        {file.url ? (
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-label text-label-sm uppercase text-primary hover:underline">
                            Open file on GitHub <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="font-body text-body-sm text-on-surface-variant">No changed files were retrieved for this investigation.</p>
                )}
              </div>
            </section>

            <section className="rounded-md border border-outline-variant bg-surface-container">
              <header className="border-b border-outline-variant px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">C · Relevant developers</h2>
              </header>
              <div className="flex flex-wrap gap-2 p-4">
                {report.developers.length ? report.developers.map((developer) => (
                  <a
                    key={developer.login}
                    href={developer.url ?? undefined}
                    target={developer.url ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className={cn("inline-flex items-center gap-2 rounded border border-outline-variant bg-surface-container-low px-2.5 py-1.5", developer.url ? "hover:border-primary" : "cursor-default")}
                  >
                    <UserRound className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono text-mono-sm text-on-surface">@{developer.login}</span>
                    <span className="font-mono text-[10px] text-on-surface-variant">{developer.count}</span>
                  </a>
                )) : <p className="font-body text-body-sm text-on-surface-variant">No author records were retrieved.</p>}
              </div>
            </section>

            <section className="rounded-md border border-outline-variant bg-surface-container">
              <header className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">D · Original source links</h2>
                <span className="font-mono text-mono-sm text-on-surface-variant">{sourceItems.length}</span>
              </header>
              <div className="flex flex-col gap-2 p-4">
                {sourceItems.length ? sourceItems.slice(0, 24).map((item) => (
                  <a key={item.id} href={item.url as string} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-2 rounded border border-outline-variant bg-surface-container-low px-3 py-2 hover:border-primary">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11px] text-primary">{item.reference}</span>
                      <span className="mt-0.5 block truncate font-body text-body-sm text-on-surface-variant">{item.title}</span>
                    </span>
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-on-surface-variant group-hover:text-primary" aria-hidden="true" />
                  </a>
                )) : (
                  <p className="font-body text-body-sm text-on-surface-variant">
                    {report.demo ? "DEMO DATA records have no original source URLs." : "No original source URLs were available for the retrieved records."}
                  </p>
                )}
              </div>
            </section>

            {report.synthesis.status !== "completed" ? (
              <section className="rounded-md border border-secondary/40 bg-secondary-container/20 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ffc7c2]" />
                  <div>
                    <p className="font-label text-label-sm uppercase text-[#ffc7c2]">Synthesis unavailable</p>
                    <p className="mt-1 font-body text-body-sm text-on-surface-variant">{report.synthesis.message}</p>
                  </div>
                </div>
              </section>
            ) : null}
          </aside>
        </DossierOpen>
      </div>
    </main>
  );
}

function EvidenceGroup({ title, items, demo }: { title: string; items: EvidenceItem[]; demo?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-2 font-label text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">{title} · {items.length}</p>
      <div className="flex flex-col gap-2">
        {items.slice(0, 6).map((item) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-primary">{kindIcon(item.kind)} {item.reference}</span>
                {item.url && !demo ? <ExternalLink className="h-3 w-3 text-on-surface-variant" /> : <span className="font-mono text-[9px] text-on-surface-variant">DEMO</span>}
              </div>
              <p className="mt-1 line-clamp-2 font-body text-body-sm text-on-surface">{item.title}</p>
              <p className="mt-0.5 font-mono text-[10px] text-on-surface-variant">{item.date ? formatDate(item.date) : "undated"}{item.author ? ` · @${item.author}` : ""}</p>
            </>
          );
          return item.url && !demo ? (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="rounded border border-outline-variant bg-surface-container-low p-2.5 hover:border-primary">
              {content}
            </a>
          ) : (
            <div key={item.id} className="rounded border border-outline-variant bg-surface-container-low p-2.5">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
