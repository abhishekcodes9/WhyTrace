"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown,
  CircleHelp, Database, ExternalLink, FileCode2, FileText, GitBranch, GitCommitHorizontal, GitPullRequest,
  MessageSquare, Network, Sparkles, UserRound,
} from "lucide-react";
import { GithubLogo as Github } from "@/components/icons";
import type { Citation, Claim, EvidenceItem, InvestigationReport, SourceKind } from "@/lib/types";
import { DossierOpen } from "@/components/motion";
import { Badge, Stamp } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { resolveReportStatus } from "@/lib/report-status";

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

const MUTED = "text-on-surface-variant/70";
const QUIET = "text-on-surface-variant/55";
const CARD = "rounded-sm border border-primary/20 bg-deep-charcoal/55";
const SECTION = "mt-6 border-t border-primary/15 pt-5";

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
          <code key={`${part}-${index}`} className="inline-code border border-primary/15 bg-primary/10 text-antique-paper">{part.slice(1, -1)}</code>
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
      <span className="ml-1 inline-flex items-center rounded-sm border border-primary/30 bg-deep-charcoal/70 px-1.5 py-0.5 align-baseline font-mono text-[10px] text-antique-paper" title="DEMO DATA · source unavailable">
        {label} · DEMO
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1 inline-flex items-center gap-0.5 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 align-baseline font-mono text-[10px] text-antique-paper underline decoration-primary/40 underline-offset-2 transition-colors hover:border-primary hover:bg-primary/15"
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
        <li key={`${claim.text.slice(0, 40)}-${index}`} className="flex items-baseline gap-2 font-body text-body-md text-warm-cream">
          {numbered ? <span className="shrink-0 font-mono text-mono-sm text-primary">[{index + 1}]</span> : <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/75" aria-hidden="true" />}
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
      <h2 className="font-label text-label-md uppercase tracking-[0.14em] text-antique-paper">
        <span className="mr-2 font-mono text-primary/85">{number}</span>
        {title}
      </h2>
      {badge}
    </div>
  );
}

function EvidenceQualityBlock({ report }: { report: InvestigationReport }) {
  const quality = report.evidenceQuality;
  const resolved = resolveReportStatus(report);
  const notConfigured = resolved.isSynthesisNotConfigured;
  const retrievalOnly = resolved.isEvidenceOnly || notConfigured;
  const tone = quality.label === "high" ? "success" : quality.label === "medium" ? "brass" : "danger";
  const barWidth = resolved.isAnswered ? quality.confidence : retrievalOnly ? quality.coverage : quality.confidence;
  return (
    <div className={cn(CARD, "p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-label text-label-md uppercase tracking-wider text-antique-paper">
          {resolved.isAnswered ? "Evidence quality" : "Evidence retrieval coverage"}
        </span>
        <Badge variant={report.demo ? "neutral" : resolved.isAnswered ? (tone === "success" ? "success" : tone === "brass" ? "brass" : "danger") : retrievalOnly ? "brass" : "danger"}>
          {report.demo ? "DEMO · " : ""}
          {resolved.isAnswered
            ? `${quality.label.toUpperCase()} · ${quality.confidence}%`
            : retrievalOnly
              ? `EVIDENCE ONLY · ${quality.evidenceCount} RECORDS`
              : `INSUFFICIENT · ${quality.confidence}%`}
        </Badge>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-deep-charcoal ring-1 ring-primary/15">
        <div
          className={cn("h-full rounded-full", resolved.isAnswered ? (quality.label === "high" ? "bg-[#7fa98a]" : quality.label === "medium" ? "bg-primary" : "bg-secondary") : retrievalOnly ? "bg-primary" : "bg-secondary")}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px] text-on-surface-variant/70">
        <span><strong className="block text-title-sm font-normal text-warm-cream">{quality.evidenceCount}</strong>records</span>
        <span><strong className="block text-title-sm font-normal text-warm-cream">{quality.directCount}</strong>direct</span>
        <span><strong className="block text-title-sm font-normal text-warm-cream">{quality.coverage}%</strong>coverage</span>
      </div>
      <p className={cn("mt-3 font-body text-body-sm", MUTED)}>
        {retrievalOnly
          ? `No interpretive confidence is assigned because AI synthesis was ${notConfigured ? "not configured" : "unavailable"}. Coverage describes retrieval only.`
          : quality.explanation}
      </p>
      {quality.sourceTypes.length ? (
        <p className={cn("mt-2 font-mono text-[10px] uppercase tracking-wider", QUIET)}>
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

  const resolved = resolveReportStatus(report);
  const { isAnswered: answered, isEvidenceOnly: evidenceOnly, isSynthesisNotConfigured: notConfigured } = resolved;
  const retrievalOnly = evidenceOnly || notConfigured;
  const evidencePill = answered
    ? `${report.evidenceQuality.confidence}% · ${report.evidenceQuality.label.toUpperCase()}`
    : evidenceOnly
      ? `${report.evidence.length} RECORDS · EVIDENCE ONLY`
      : notConfigured
        ? `${report.evidence.length} RECORDS · AI NOT CONFIGURED`
        : `NO SUPPORTING ANSWER`;
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
            <span className={QUIET}>/</span>
            <span className="font-mono text-mono-sm text-on-surface-variant">CASE {report.caseNumber} · {report.repoFullName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded border border-primary/30 bg-deep-charcoal/70 px-3 py-1.5">
              <span className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant/70">Evidence</span>
              <span className="font-mono text-mono-sm text-primary">{evidencePill}</span>
            </div>
            <Link href={report.demo ? "/board?demo=1" : `/board?case=${encodeURIComponent(report.id)}`} className={buttonClasses("secondary", "sm")}>
              <Network className="h-3.5 w-3.5" /> View evidence board
            </Link>
          </div>
        </div>

        <DossierOpen className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <article className="report-dossier relative overflow-hidden rounded-md border border-primary/35 bg-[#241B16] p-5 text-warm-cream shadow-[0_30px_90px_rgba(0,0,0,0.48),0_0_0_1px_rgba(196,154,88,0.08)_inset] md:p-8 lg:col-span-7">
            <div className="report-chrome pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(620px circle at 88% 2%, rgba(196,154,88,0.10), transparent 62%)" }} aria-hidden="true" />
            <div className="pointer-events-none absolute right-5 top-5 hidden sm:block">
              <Stamp tone={answered ? "oxblood" : retrievalOnly ? "brass" : "ink"}>
                {answered ? "Evidence on file" : evidenceOnly ? "Evidence only" : notConfigured ? "AI not configured" : "Insufficient evidence"}
              </Stamp>
            </div>

            <header className="relative border-b border-primary/20 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-wider">
                <span className="text-primary">Investigation dossier · {report.caseNumber}</span>
                <span className={QUIET}>Filed {formatDate(report.createdAt)}</span>
              </div>
              <h1 className="mt-3 text-balance font-headline text-[27px] font-semibold leading-[33px] text-warm-cream md:text-headline-lg">
                {report.question}
              </h1>
              <div className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]", MUTED)}>
                <span className="inline-flex items-center gap-1"><Github className="h-3 w-3 text-primary/80" /> {report.repoFullName}</span>
                <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3 text-primary/80" /> {report.branch}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3 text-primary/80" /> {formatDateTime(report.createdAt)}</span>
                {report.focus ? <span>focus: {report.focus.type} · {report.focus.value}</span> : null}
              </div>
            </header>

            <div className="relative mt-5 flex flex-wrap items-center gap-2">
              {answered ? (
                <Badge variant="success"><Sparkles className="h-3 w-3" /> AI synthesis complete</Badge>
              ) : evidenceOnly ? (
                <Badge variant="brass"><Database className="h-3 w-3" /> Evidence retrieved — AI interpretation unavailable</Badge>
              ) : notConfigured ? (
                <Badge variant="neutral"><Database className="h-3 w-3" /> Evidence retrieved — AI not configured</Badge>
              ) : (
                <Badge variant="danger"><AlertTriangle className="h-3 w-3" /> Insufficient evidence</Badge>
              )}
              <Tooltip label={report.synthesis.message}>
                <span className={cn("cursor-help font-mono text-[10px] underline decoration-dotted underline-offset-2", MUTED)}>
                  {answered ? report.synthesis.model ?? "deterministic report" : retrievalOnly ? "no AI interpretation generated" : "no validated explanation"}
                </span>
              </Tooltip>
              <span className={cn("font-mono text-[10px]", QUIET)}>
                {answered ? `${report.citations.length} validated citations` : `${report.evidence.length} retrieved records`}
              </span>
            </div>

            <section className={SECTION}>
              <SectionHeading
                number="1."
                title={answered ? "Direct answer" : retrievalOnly ? "Evidence status" : "Retrieval result"}
                badge={
                  answered ? (
                    <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Documented answer</Badge>
                  ) : evidenceOnly ? (
                    <Badge variant="brass"><Database className="h-3 w-3" /> Evidence only</Badge>
                  ) : notConfigured ? (
                    <Badge variant="neutral"><Database className="h-3 w-3" /> AI not configured</Badge>
                  ) : (
                    <Badge variant="danger"><AlertTriangle className="h-3 w-3" /> Abstained</Badge>
                  )
                }
              />
              <div className={cn("mt-3 rounded-sm border p-4", answered ? "border-[#7fa98a]/30 bg-[#3e6b4c]/10" : retrievalOnly ? "border-primary/35 bg-primary/8" : "border-secondary/45 bg-secondary/10")}>
                <p className="font-body text-body-md leading-relaxed text-warm-cream">
                  <RichText text={report.summary} />
                </p>
                {!answered ? (
                  <p className={cn("mt-2 border-t border-primary/15 pt-2 font-mono text-[11px]", MUTED)}>
                    {evidenceOnly
                      ? "AI interpretation is unavailable. The records below are real retrieved evidence, but no historical explanation or documented rationale has been generated."
                      : notConfigured
                        ? "Gemini is not configured. The records below are real retrieved evidence, but no AI interpretation or documented rationale has been generated."
                        : "WHYTRACE did not convert insufficient evidence into an answer. Retrieved records remain available below for inspection."}
                  </p>
                ) : null}
              </div>
            </section>

            <section className={SECTION}>
              <SectionHeading
                number="2."
                title="Documented rationale"
                badge={answered ? <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> Documented fact</Badge> : <Badge variant="neutral">Not generated</Badge>}
              />
              <div className={cn("mt-3 p-4", CARD)}>
                {answered ? (
                  report.documentedRationale.length ? (
                    <ClaimList claims={report.documentedRationale} evidenceById={evidenceById} demo={report.demo} numbered />
                  ) : (
                    <p className={cn("font-body text-body-sm", MUTED)}>
                      No documented rationale was found in the retrieved records. Absence of documentation is not evidence of a reason.
                    </p>
                  )
                ) : (
                  <p className={cn("font-body text-body-sm", MUTED)}>
                    Not generated. {evidenceOnly
                      ? "AI interpretation was unavailable, and raw commit messages or excerpts are not promoted to documented rationale without an explicit validated explanation."
                      : notConfigured
                        ? "Gemini is not configured, so raw commit messages or excerpts are not promoted to documented rationale without an explicit validated explanation."
                        : "No validated explanation passed the evidence checks, so no rationale is asserted."}
                  </p>
                )}
              </div>
            </section>

            <section className={SECTION}>
              <SectionHeading
                number="3."
                title="Technical observations"
                badge={answered ? <Badge variant="brass">Observed from evidence</Badge> : <Badge variant="neutral">Not generated</Badge>}
              />
              <div className={cn("mt-3 p-4", CARD)}>
                {answered ? (
                  report.technicalObservations.length ? (
                    <ClaimList claims={report.technicalObservations} evidenceById={evidenceById} demo={report.demo} />
                  ) : (
                    <p className={cn("font-body text-body-sm", MUTED)}>No technical observation was asserted beyond the retrieved records.</p>
                  )
                ) : (
                  <p className={cn("font-body text-body-sm", MUTED)}>
                    Not generated. {evidenceOnly ? "AI interpretation was unavailable." : notConfigured ? "Gemini is not configured." : "No evidence-supported technical conclusion was retained."}
                  </p>
                )}
              </div>
            </section>

            <section className={SECTION}>
              <SectionHeading
                number="4."
                title="Probable inference"
                badge={answered ? <Badge variant="brass"><CircleHelp className="h-3 w-3" /> Labelled inference</Badge> : <Badge variant="neutral">Not generated</Badge>}
              />
              <div className={cn("mt-3 p-4", CARD)}>
                {answered ? (
                  report.inferences.length ? (
                    <ClaimList claims={report.inferences} evidenceById={evidenceById} demo={report.demo} />
                  ) : (
                    <p className={cn("font-body text-body-sm", MUTED)}>No inference was made. This is deliberate.</p>
                  )
                ) : (
                  <p className={cn("font-body text-body-sm", MUTED)}>
                    Not generated. {evidenceOnly ? "No inference is drawn without AI interpretation." : notConfigured ? "No inference is drawn because Gemini is not configured." : "No evidence-supported inference was retained."}
                  </p>
                )}
              </div>
            </section>

            <section className={SECTION}>
              <SectionHeading number="5." title="Uncertainty & evidence gaps" badge={<Badge variant="neutral">Explicit limits</Badge>} />
              <ul className={cn("mt-3 flex flex-col gap-2 p-4", CARD)}>
                {(report.uncertainties.length ? report.uncertainties : ["No uncertainty statement was returned."]).map((item, index) => (
                  <li key={`${item.slice(0, 30)}-${index}`} className={cn("flex items-start gap-2 font-body text-body-sm", MUTED)}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary/90" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={SECTION}>
              <SectionHeading
                number="6."
                title="Decision status"
                badge={
                  <Badge variant={report.supersessionStatus === "superseded" ? "danger" : report.supersessionStatus === "active" ? "success" : "neutral"}>
                    {report.supersessionStatus.toUpperCase()}
                  </Badge>
                }
              />
              <p className={cn("mt-3 p-4 font-body text-body-md text-warm-cream", CARD)}>{report.supersessionNote}</p>
            </section>

            <section className={SECTION}>
              <SectionHeading number="7." title="Evidence quality & coverage" />
              <div className="mt-3"><EvidenceQualityBlock report={report} /></div>
            </section>

            {report.timeline.length ? (
              <section className={SECTION}>
                <SectionHeading number="8." title="Historical timeline" />
                <ol className="relative mt-4 ml-1 border-l border-primary/35 pl-5">
                  {report.timeline.map((event, index) => (
                    <li key={`${event.date}-${event.reference}-${index}`} className="relative pb-4 last:pb-0">
                      <span className="absolute -left-[25px] top-1 h-2 w-2 rounded-full border border-primary bg-[#241B16] shadow-[0_0_10px_rgba(196,154,88,0.35)]" aria-hidden="true" />
                      <p className={cn("font-mono text-[10px] uppercase tracking-wider", MUTED)}>{formatDate(event.date)} · {KIND_LABEL[event.kind as SourceKind] ?? event.kind}</p>
                      {event.url ? (
                        <a href={event.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block break-words font-body text-body-sm text-antique-paper underline decoration-primary/30 underline-offset-2 hover:text-primary">
                          {event.title}
                        </a>
                      ) : (
                        <p className="mt-0.5 font-body text-body-sm text-antique-paper">{event.title}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <div className="relative mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-primary/20 pt-4">
              <p className={cn("font-mono text-[10px]", QUIET)}>
                Evidence IDs preserved · {report.evidence.length} records · {report.developers.length} developers
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/investigate" className={buttonClasses("secondary", "sm")}>New inquiry</Link>
                <Link href={report.demo ? "/board?demo=1" : `/board?case=${encodeURIComponent(report.id)}`} className={buttonClasses("secondary", "sm")}>
                  <Network className="h-3.5 w-3.5" /> Evidence board
                </Link>
              </div>
            </div>
          </article>

          <aside className="flex flex-col gap-5 lg:col-span-5">
            <section className="overflow-hidden rounded-md border border-primary/20 bg-[#241B16] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
              <header className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">A · Supporting records</h2>
                <span className="font-mono text-mono-sm text-on-surface-variant/60">{report.evidence.length}</span>
              </header>
              <div className="flex flex-col gap-4 p-4">
                <EvidenceGroup title="Commits" items={commits} demo={report.demo} />
                <EvidenceGroup title="Pull requests" items={pulls} demo={report.demo} />
                <EvidenceGroup title="Issues & incidents" items={issues} demo={report.demo} />
                <EvidenceGroup title="Decisions & documents" items={documents} demo={report.demo} />
                <EvidenceGroup title="Discussions" items={discussions} demo={report.demo} />
                {!report.evidence.length ? <p className={cn("font-body text-body-sm", MUTED)}>No evidence records were retrieved.</p> : null}
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-primary/20 bg-[#241B16] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
              <header className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">B · Changed files & diffs</h2>
                <span className="font-mono text-mono-sm text-on-surface-variant/60">{report.changedFiles.length}</span>
              </header>
              <div className="flex flex-col gap-3 p-4">
                {report.changedFiles.length ? (
                  report.changedFiles.map((file) => (
                    <details key={`${file.source}-${file.path}`} className="group overflow-hidden rounded-sm border border-primary/20 bg-deep-charcoal/60">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0">
                          <p className="break-all font-mono text-mono-sm text-antique-paper">{file.path}</p>
                          <p className={cn("mt-1 font-mono text-[10px] uppercase tracking-wider", QUIET)}>
                            {file.source ? `${file.source} · ` : ""}{file.status}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                          <span className="text-[#8fc39c]">+{file.additions}</span>
                          <span className="text-[#e0a19a]">−{file.deletions}</span>
                          <ChevronDown className="h-3.5 w-3.5 text-on-surface-variant/60 transition-transform group-open:rotate-180" />
                        </div>
                      </summary>
                      <div className="border-t border-primary/15 bg-[#0F0B09] p-3">
                        {file.patch ? (
                          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[18px] text-on-surface-variant">
                            {file.patch.split("\n").map((line, index) => (
                              <span key={index} className={cn("block", line.startsWith("+") ? "diff-line diff-add" : line.startsWith("-") ? "diff-line diff-del" : "diff-line")}>{line || " "}</span>
                            ))}
                          </pre>
                        ) : (
                          <p className={cn("font-body text-body-sm", MUTED)}>No patch was retrieved for this file. GitHub may omit large or binary diffs.</p>
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
                  <p className={cn("font-body text-body-sm", MUTED)}>No changed files were retrieved for this investigation.</p>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-primary/20 bg-[#241B16] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
              <header className="border-b border-primary/15 px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">C · Relevant developers</h2>
              </header>
              <div className="flex flex-wrap gap-2 p-4">
                {report.developers.length ? report.developers.map((developer) => (
                  <a
                    key={developer.login}
                    href={developer.url ?? undefined}
                    target={developer.url ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className={cn("inline-flex items-center gap-2 rounded-sm border border-primary/20 bg-deep-charcoal/60 px-2.5 py-1.5", developer.url ? "hover:border-primary/60" : "cursor-default")}
                  >
                    <UserRound className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono text-mono-sm text-antique-paper">@{developer.login}</span>
                    <span className={cn("font-mono text-[10px]", QUIET)}>{developer.count}</span>
                  </a>
                )) : <p className={cn("font-body text-body-sm", MUTED)}>No author records were retrieved.</p>}
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-primary/20 bg-[#241B16] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
              <header className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
                <h2 className="font-label text-label-md uppercase tracking-wider text-primary">D · Original source links</h2>
                <span className="font-mono text-mono-sm text-on-surface-variant/60">{sourceItems.length}</span>
              </header>
              <div className="flex flex-col gap-2 p-4">
                {sourceItems.length ? sourceItems.slice(0, 24).map((item) => (
                  <a key={item.id} href={item.url as string} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-2 rounded-sm border border-primary/20 bg-deep-charcoal/60 px-3 py-2 hover:border-primary/60">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11px] text-primary">{item.reference}</span>
                      <span className={cn("mt-0.5 block truncate font-body text-body-sm", MUTED)}>{item.title}</span>
                    </span>
                    <ExternalLink className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-primary", QUIET)} aria-hidden="true" />
                  </a>
                )) : (
                  <p className={cn("font-body text-body-sm", MUTED)}>
                    {report.demo ? "DEMO DATA records have no original source URLs." : "No original source URLs were available for the retrieved records."}
                  </p>
                )}
              </div>
            </section>

            {report.synthesis.status !== "completed" ? (
              <section className="rounded-md border border-primary/30 bg-primary/8 p-4">
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-label text-label-sm uppercase text-primary">
                      Evidence only · AI interpretation {notConfigured ? "not configured" : "unavailable"}
                    </p>
                    <p className={cn("mt-1 font-body text-body-sm", MUTED)}>{report.synthesis.message}</p>
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
      <p className={cn("mb-2 font-label text-[10px] uppercase tracking-[0.14em]", MUTED)}>{title} · {items.length}</p>
      <div className="flex flex-col gap-2">
        {items.slice(0, 6).map((item) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 break-all font-mono text-[10px] uppercase text-primary">{kindIcon(item.kind)} {item.reference}</span>
                {item.url && !demo ? <ExternalLink className={cn("h-3 w-3", QUIET)} /> : <span className={cn("font-mono text-[9px]", QUIET)}>DEMO</span>}
              </div>
              <p className="mt-1 break-words font-body text-body-sm text-antique-paper">{item.title}</p>
              <p className={cn("mt-0.5 font-mono text-[10px]", QUIET)}>{item.date ? formatDate(item.date) : "undated"}{item.author ? ` · @${item.author}` : ""}</p>
            </>
          );
          return item.url && !demo ? (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-primary/20 bg-deep-charcoal/60 p-2.5 hover:border-primary/60">
              {content}
            </a>
          ) : (
            <div key={item.id} className="rounded-sm border border-primary/20 bg-deep-charcoal/60 p-2.5">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
