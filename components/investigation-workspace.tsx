"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ChevronDown, Network, Search, SlidersHorizontal, CircleAlert,
} from "lucide-react";
import { GithubLogo as Github } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea, Input, Select } from "@/components/ui/input";
import { Badge, StatusDot } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useRepo } from "@/components/repo-provider";
import { cn } from "@/lib/utils";
import type { InvestigationEvent, InvestigationFocus, InvestigationReport } from "@/lib/types";
import {
  InvestigationProgressPanel, initialInvestigationStages, type InvestigationStageMap,
} from "@/components/investigation-progress";

const SUGGESTIONS = [
  "Why was this function introduced?",
  "Which commit changed this behaviour?",
  "What issue motivated this change?",
  "Was this decision later superseded?",
];

type FocusType = "none" | "file" | "commit" | "pullRequest" | "issue";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; details?: string[] };
    return body.error || body.details?.join(" ") || `Request failed (HTTP ${response.status}).`;
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
}

async function consumeInvestigationStream(
  response: Response,
  onEvent: (event: InvestigationEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("The investigation stream was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as InvestigationEvent);
        } catch {
          // Ignore malformed fragments; real failures arrive as typed error events.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function InvestigationWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { repository, hydrated } = useRepo();
  const [question, setQuestion] = useState("Why was this implementation chosen?");
  const [showFocus, setShowFocus] = useState(false);
  const [focusType, setFocusType] = useState<FocusType>("none");
  const [focusValue, setFocusValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<InvestigationStageMap>(initialInvestigationStages);
  const [elapsed, setElapsed] = useState(0);
  const [indeterminate, setIndeterminate] = useState(false);
  const [completedCase, setCompletedCase] = useState<{ id: string; caseNumber: string } | null>(null);

  useEffect(() => {
    const type = searchParams.get("focusType") as FocusType | null;
    const value = searchParams.get("focus");
    if (type && ["file", "commit", "pullRequest", "issue"].includes(type)) {
      setFocusType(type);
      setShowFocus(true);
      if (value) setFocusValue(value);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!loading || completedCase) return;
    setElapsed(0);
    const elapsedTimer = setInterval(() => setElapsed((value) => value + 1), 1_000);
    return () => clearInterval(elapsedTimer);
  }, [loading, completedCase]);

  useEffect(() => {
    if (!completedCase) return;
    const timer = window.setTimeout(() => router.push(`/report/${completedCase.id}`), 1_700);
    return () => window.clearTimeout(timer);
  }, [completedCase, router]);

  const counts = repository?.counts;
  const storageSummary = useMemo(() => {
    if (!counts) return "Indexed graph available";
    return `${counts.commits.toLocaleString()} commits · ${counts.pulls.toLocaleString()} PRs · ${counts.issues.toLocaleString()} issues · ${counts.relationships.toLocaleString()} relationships`;
  }, [counts]);

  if (!hydrated) {
    return (
      <main className="lamp-wash flex min-h-[calc(100dvh-4rem)] items-center justify-center">
        <LoadingState label="Opening the case file…" />
      </main>
    );
  }

  if (!repository) {
    return (
      <main className="lamp-wash flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-16">
        <EmptyState
          title="No case is open yet."
          message="Connect a GitHub repository first. WHYTRACE needs a persisted Neo4j graph before it can investigate engineering history."
          action={
            <Link href="/connect" className="inline-flex items-center gap-2 rounded border border-primary bg-primary px-5 py-2.5 font-label text-label-lg uppercase tracking-wider text-on-primary hover:bg-on-primary-container">
              <Github className="h-4 w-4" /> Connect repository
            </Link>
          }
          className="max-w-xl"
        />
      </main>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || completedCase) return;
    const trimmed = question.trim();
    if (trimmed.length < 8) {
      setError("Ask a more specific question — at least a short sentence.");
      return;
    }
    if (focusType !== "none" && !focusValue.trim()) {
      setError("Add a value for the investigation focus, or switch focus off.");
      return;
    }

    const focus: InvestigationFocus | undefined =
      focusType === "none"
        ? undefined
        : focusType === "file"
          ? { type: "file", value: focusValue.trim() }
          : focusType === "commit"
            ? { type: "commit", value: focusValue.trim() }
            : focusType === "pullRequest"
              ? { type: "pullRequest", value: focusValue.trim() }
              : { type: "issue", value: focusValue.trim() };
    const payload = {
      repoFullName: repository.fullName,
      branch: repository.branch,
      question: trimmed,
      ...(focus ? { focus } : {}),
    };

    setLoading(true);
    setError(null);
    setStages(initialInvestigationStages());
    setElapsed(0);
    setIndeterminate(false);
    setCompletedCase(null);

    const finish = (report: InvestigationReport) => {
      try {
        window.sessionStorage.setItem("whytrace:lastCase", report.id);
      } catch {
        // Navigation still works if session storage is unavailable.
      }
      setCompletedCase({ id: report.id, caseNumber: report.caseNumber });
    };

    const loadLegacyReport = async () => {
      setIndeterminate(true);
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(150_000),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { report?: InvestigationReport; error?: string; details?: string[] };
      if (!body.report) throw new Error(body.error || body.details?.join(" ") || "Investigation failed.");
      finish(body.report);
    };

    try {
      let response: Response;
      try {
        response = await fetch("/api/investigate/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(150_000),
        });
      } catch {
        throw new Error("The investigation progress stream could not be reached. No result was assumed.");
      }

      if (response.status === 404 || response.status === 405) {
        await loadLegacyReport();
        return;
      }
      if (!response.ok) throw new Error(await readError(response));
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        await loadLegacyReport();
        return;
      }

      let completedReport: InvestigationReport | null = null;
      let streamError: string | null = null;
      await consumeInvestigationStream(response, (streamEvent) => {
        if (streamEvent.type === "stage") {
          setStages((current) => ({
            ...current,
            [streamEvent.stage]: {
              status: streamEvent.status,
              message: streamEvent.message,
              detail: streamEvent.detail,
              counts: streamEvent.counts,
            },
          }));
        } else if (streamEvent.type === "complete") {
          completedReport = streamEvent.report;
          finish(streamEvent.report);
        } else if (streamEvent.type === "error") {
          streamError = streamEvent.message;
          if (streamEvent.stage) {
            setStages((current) => ({
              ...current,
              [streamEvent.stage as keyof InvestigationStageMap]: {
                ...current[streamEvent.stage as keyof InvestigationStageMap],
                status: "failed",
                message: streamEvent.message,
              },
            }));
          }
        }
      });

      if (streamError) throw new Error(streamError);
      if (!completedReport) {
        throw new Error("The investigation progress stream ended before a case file was completed. No result was assumed.");
      }
    } catch (err) {
      const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
      setError(timedOut
        ? "The investigation took longer than 150 seconds and was not assumed complete. Check the case files before retrying."
        : err instanceof Error ? err.message : "Investigation failed.");
      setIndeterminate(false);
      setLoading(false);
    }
  };

  const openCompletedCase = () => {
    if (completedCase) router.push(`/report/${completedCase.id}`);
  };

  return (
    <main className="lamp-wash relative min-h-[calc(100dvh-4rem)]">
      <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 md:px-page-margin md:py-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 py-2">
            <StatusDot status="success" />
            <span className="font-mono text-mono-md text-on-surface">{repository.fullName}</span>
            <span className="font-mono text-mono-sm text-primary">{repository.branch}</span>
            <Badge variant="outline" className="ml-1">Graph ready</Badge>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/board" className="inline-flex items-center gap-1.5 font-label text-label-sm uppercase text-primary hover:underline">
              <Network className="h-3.5 w-3.5" /> Evidence board
            </Link>
            <Link href="/connect" className="font-label text-label-sm uppercase text-on-surface-variant hover:text-on-surface">
              Change repository
            </Link>
          </div>
        </div>

        <section className="flex flex-col gap-6">
          <div className="text-center">
            <p className="mb-3 font-label text-label-md uppercase tracking-[0.2em] text-primary">Investigation desk</p>
            <h1 className="font-display text-[36px] font-semibold leading-[40px] text-on-surface sm:text-display-md sm:leading-[54px]">
              What do you want to uncover?
            </h1>
            <p className="mx-auto mt-3 max-w-xl font-body text-body-md text-on-surface-variant">
              {storageSummary}
            </p>
          </div>

          <form onSubmit={submit} className={cn("relative overflow-hidden rounded-md border bg-surface-container p-5 md:p-7", loading ? "border-primary/70" : "border-primary/45")}>
            {loading ? (
              <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-surface-container-highest">
                <div className="scan-beam" />
              </div>
            ) : null}

            <Textarea
              id="investigation-question"
              label="Investigation question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              maxLength={1000}
              disabled={loading}
              placeholder="Ask why a module, workaround, safeguard or architectural decision exists…"
              className="min-h-32 border-outline-variant bg-surface-container-low text-body-lg"
            />

            <div className="mt-3 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowFocus((value) => !value)}
                className="inline-flex w-fit items-center gap-1.5 font-label text-label-sm uppercase text-on-surface-variant hover:text-primary"
                aria-expanded={showFocus}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {showFocus ? "Hide investigation focus" : "Attach a file, commit, PR or issue (optional)"}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showFocus ? "rotate-180" : "")} />
              </button>
              {showFocus ? (
                <div className="grid gap-3 rounded border border-outline-variant bg-surface-container-low/60 p-3 sm:grid-cols-[180px_1fr]">
                  <Select
                    id="focus-type"
                    label="Focus type"
                    value={focusType}
                    onChange={(event) => setFocusType(event.target.value as FocusType)}
                    disabled={loading}
                  >
                    <option value="none">Repository-wide</option>
                    <option value="file">File path</option>
                    <option value="commit">Commit SHA</option>
                    <option value="pullRequest">Pull request number</option>
                    <option value="issue">Issue number</option>
                  </Select>
                  <Input
                    id="focus-value"
                    label="Focus value"
                    value={focusValue}
                    onChange={(event) => setFocusValue(event.target.value)}
                    placeholder={focusType === "commit" ? "8f3a91c" : focusType === "pullRequest" ? "412" : focusType === "issue" ? "388" : "src/auth/tokenStore.ts"}
                    disabled={loading || focusType === "none"}
                    className="font-mono"
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
              <p className="font-mono text-mono-sm text-on-surface-variant">
                Evidence-grounded across commits, PRs, issues, discussions, ADRs and Neo4j relationships.
              </p>
              <Button type="submit" size="lg" loading={loading} icon={<Search className="h-4 w-4" />} className="shrink-0">
                Investigate
              </Button>
            </div>
          </form>

          {loading || completedCase ? (
            <InvestigationProgressPanel
              stages={stages}
              elapsed={elapsed}
              indeterminate={indeterminate}
              completedCase={completedCase}
              onOpenCase={openCompletedCase}
            />
          ) : null}

          {error ? (
            <ErrorState title="The investigation could not be completed." message={error} onRetry={() => setError(null)} />
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Suggested inquiries</h2>
            <span className="font-mono text-mono-sm text-on-surface-variant/60">Tap to load</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={loading}
                onClick={() => {
                  setQuestion(suggestion);
                  document.getElementById("investigation-question")?.focus();
                }}
                className="group flex h-full items-start justify-between gap-3 rounded-md border border-outline-variant bg-surface-container p-4 text-left transition-colors duration-150 hover:border-primary hover:bg-surface-container-high disabled:opacity-50"
              >
                <span className="font-body text-body-md text-on-surface">{suggestion}</span>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            ))}
          </div>
          <p className="mt-1 flex items-start gap-2 font-body text-body-sm text-on-surface-variant/80">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
            If the records do not support a reliable explanation, WHYTRACE will abstain instead of guessing.
          </p>
        </section>

        {counts ? (
          <div className="grid grid-cols-2 gap-2 border-t border-outline-variant pt-5 sm:grid-cols-4">
            <Stat label="Commits" value={counts.commits} />
            <Stat label="Pull requests" value={counts.pulls} />
            <Stat label="Issues" value={counts.issues} />
            <Stat label="Decisions" value={counts.decisions} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-outline-variant/70 bg-surface-container-low/50 px-3 py-2">
      <p className="font-mono text-title-md text-primary">{value.toLocaleString()}</p>
      <p className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</p>
    </div>
  );
}
