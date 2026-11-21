"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, CircleDashed, ExternalLink, GitBranch, Link2,
  Loader2, LockKeyhole, RotateCw, ShieldAlert, Sparkles, Star,
} from "lucide-react";
import { GithubLogo as Github } from "@/components/icons";
import type { ConnectResponse, IngestionCounts, IngestionEvent, RepositorySummary } from "@/lib/types";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { useRepo } from "@/components/repo-provider";
import { cn } from "@/lib/utils";

const STAGES = [
  "Repository",
  "Commit history",
  "Pull requests",
  "Issues",
  "Discussions",
  "Documentation",
  "Decision extraction",
  "Neo4j graph",
  "Read-back verification",
];

type Phase = "idle" | "connecting" | "verified" | "ingesting" | "complete" | "error";

function countRows(counts: IngestionCounts): { label: string; value: number }[] {
  return [
    { label: "Commits", value: counts.commits },
    { label: "Pull requests", value: counts.pullRequests },
    { label: "Issues", value: counts.issues },
    { label: "Files", value: counts.files },
    { label: "Documents", value: counts.documents },
    { label: "Decisions", value: counts.decisions },
    { label: "Developers", value: counts.developers },
    { label: "Relationships", value: counts.relationships },
  ];
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; details?: string[] };
    return body.error || body.details?.join(" ") || `Request failed (HTTP ${response.status}).`;
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
}

async function consumeEventStream(response: Response, onEvent: (event: IngestionEvent) => void): Promise<void> {
  if (!response.body) throw new Error("The ingestion stream was empty.");
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
          onEvent(JSON.parse(payload) as IngestionEvent);
        } catch {
          // Ignore malformed SSE fragments; real errors arrive as typed error events.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function ConnectFlow() {
  const router = useRouter();
  const { setRepository } = useRepo();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<RepositorySummary | null>(null);
  const [connection, setConnection] = useState<ConnectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const [stageMessage, setStageMessage] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [counts, setCounts] = useState<IngestionCounts | null>(null);
  const [completedRepo, setCompletedRepo] = useState<RepositorySummary | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const busy = phase === "connecting" || phase === "ingesting";

  const startIngestion = async (fullName: string) => {
    setPhase("ingesting");
    setError(null);
    setCurrentStage(0);
    setStageMessage("Opening the ingestion stream");
    setWarnings([]);
    setCounts(null);
    try {
      const response = await fetch("/api/repositories/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      if (!response.ok) throw new Error(await readError(response));
      let failed: string | null = null;
      await consumeEventStream(response, (event) => {
        if (event.type === "stage") {
          setCurrentStage(event.stage);
          setStageMessage(event.message);
          setProgress(null);
        } else if (event.type === "progress") {
          setStageMessage(event.message);
          if (event.current !== undefined && event.total !== undefined) setProgress({ current: event.current, total: event.total });
        } else if (event.type === "warning") {
          setWarnings((current) => [...current, event.message]);
        } else if (event.type === "complete") {
          setCompletedRepo(event.repository);
          setCounts(event.counts);
          setWarnings(event.warnings);
          setDurationMs(event.durationMs);
          setCurrentStage(STAGES.length);
          setStageMessage("Graph persisted and read back from Neo4j");
          setRepository(event.repository);
          setPhase("complete");
        } else if (event.type === "error") {
          failed = event.message;
        }
      });
      if (failed) {
        setError(failed);
        setPhase("error");
      } else if (!completedRepo) {
        // The closure value is stale here; completion is signalled by phase above.
        setPhase((current) => (current === "complete" ? current : "error"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingestion failed.");
      setPhase("error");
    }
  };

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setPreview(null);
    setConnection(null);
    setCounts(null);
    setWarnings([]);
    setCompletedRepo(null);
    setPhase("connecting");
    try {
      if (!/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/?$/i.test(url.trim().replace(/\.git\/?$/i, ""))) {
        throw new Error("Enter a repository root URL such as https://github.com/owner/repository.");
      }
      const response = await fetch("/api/repositories/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as ConnectResponse;
      setConnection(body);
      setPreview(body.repository);
      setPhase("verified");
      if (!body.neo4jVerified) {
        setError(
          `GitHub identity verified, but ${body.neo4jMessage} Ingestion needs a working Neo4j AuraDB connection.`,
        );
        setPhase("error");
        return;
      }
      if (body.alreadyIndexed) {
        setRepository({ ...body.repository, ingestedAt: new Date().toISOString() });
        setPhase("verified");
        return;
      }
      await startIngestion(body.repository.fullName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
      setPhase("error");
    }
  };

  const reindex = async () => {
    if (!preview) return;
    await startIngestion(preview.fullName);
  };

  const openWorkspace = () => {
    if (completedRepo) setRepository(completedRepo);
    else if (preview) setRepository(preview);
    router.push("/investigate");
  };

  return (
    <main className="lamp-wash relative min-h-[calc(100dvh-4rem)]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.22]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(232,220,197,0.10) 1px, transparent 0)", backgroundSize: "26px 26px" }} />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 md:px-page-margin md:py-20">
        <div className="flex flex-col gap-3 text-center">
          <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Case intake</p>
          <h1 className="font-display text-[38px] font-semibold leading-[42px] text-on-surface sm:text-display-md sm:leading-[54px]">
            Choose Your Case.
          </h1>
          <p className="mx-auto max-w-xl font-body text-body-md text-on-surface-variant">
            Enter a GitHub repository URL to index its commit history, pull requests, issues and engineering decisions into Neo4j.
          </p>
        </div>

        <section className="walnut-panel relative overflow-hidden rounded-md p-6 md:p-8">
          <form onSubmit={connect} className="flex flex-col gap-4">
            <Input
              id="repo-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              label="GitHub repository URL"
              placeholder="https://github.com/owner/repository"
              icon={<Link2 className="h-4 w-4" />}
              autoComplete="url"
              spellCheck={false}
              disabled={busy}
              hint="Any accessible public repository. Private repositories require GITHUB_TOKEN on the server."
            />
            <Button
              type="submit"
              size="lg"
              loading={phase === "connecting"}
              disabled={busy || !url.trim()}
              icon={<Github className="h-4 w-4" />}
              className="w-full"
            >
              {phase === "ingesting" ? "Indexing repository…" : "Connect Repository"}
            </Button>
          </form>

          {preview ? (
            <div className="mt-5 border-t border-outline-variant pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-sm border border-primary/40 bg-surface-container-high text-primary">
                    <Github className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-mono-md text-on-surface">{preview.fullName}</p>
                      {preview.private ? (
                        <Badge variant="neutral"><LockKeyhole className="h-3 w-3" /> Private</Badge>
                      ) : (
                        <Badge variant="success" dot="success">Public</Badge>
                      )}
                    </div>
                    <p className="mt-1 max-w-md font-body text-body-sm text-on-surface-variant">
                      {preview.description || "No repository description provided."}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-mono-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5 text-primary" /> {preview.branch}</span>
                  <span className="inline-flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-primary" /> {preview.stars.toLocaleString()}</span>
                  {preview.language ? <span>{preview.language}</span> : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {connection?.alreadyIndexed ? (
                  <Badge variant="brass" dot="primary">Already indexed in Neo4j</Badge>
                ) : null}
                {connection?.rateLimit.remaining !== null && connection?.rateLimit.remaining !== undefined ? (
                  <Badge variant="outline">GitHub quota {connection.rateLimit.remaining}/{connection.rateLimit.limit}</Badge>
                ) : null}
                {connection?.neo4jVerified ? <Badge variant="success" dot="success">Neo4j verified</Badge> : null}
                {preview.url ? (
                  <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-label text-label-sm uppercase text-primary hover:underline">
                    GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {(phase === "ingesting" || phase === "complete") && currentStage > 0 ? (
            <div className="mt-5 border-t border-outline-variant pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {phase === "ingesting" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Check className="h-4 w-4 text-success" />}
                  <span className="font-label text-label-md uppercase tracking-wider text-on-surface">
                    {phase === "ingesting" ? "Ingestion in progress" : "Ingestion complete"}
                  </span>
                </div>
                <span className="font-mono text-mono-sm text-on-surface-variant">
                  {phase === "ingesting" ? `STAGE ${Math.min(currentStage, STAGES.length)}/${STAGES.length}` : `${counts ? counts.relationships : 0} RELATIONSHIPS`}
                </span>
              </div>
              <div className="mb-4 h-1 overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className="h-full bg-primary transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(100, (currentStage / STAGES.length) * 100)}%` }}
                />
              </div>
              <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {STAGES.map((stage, index) => {
                  const stageNumber = index + 1;
                  const complete = currentStage > stageNumber || phase === "complete";
                  const active = currentStage === stageNumber && phase === "ingesting";
                  return (
                    <li key={stage} className={cn("flex items-center gap-2 font-mono text-mono-sm", complete ? "text-on-surface" : active ? "text-primary" : "text-on-surface-variant/55")}>
                      {complete ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : active ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <CircleDashed className="h-3.5 w-3.5 shrink-0" />}
                      {stage}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 font-mono text-mono-sm text-on-surface-variant" aria-live="polite">
                {stageMessage}
                {progress ? ` (${progress.current}/${progress.total})` : ""}
              </p>

              {phase === "complete" && counts ? (
                <div className="mt-5 border-t border-outline-variant pt-4">
                  <p className="mb-3 font-label text-label-sm uppercase tracking-wider text-on-surface-variant">Records persisted and read back</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {countRows(counts).map((row) => (
                      <div key={row.label} className="rounded border border-outline-variant bg-surface-container-low px-3 py-2">
                        <p className="font-mono text-title-md text-primary">{row.value.toLocaleString()}</p>
                        <p className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">{row.label}</p>
                      </div>
                    ))}
                  </div>
                  {durationMs !== null ? <p className="mt-2 font-mono text-mono-sm text-on-surface-variant">Completed in {(durationMs / 1000).toFixed(1)}s</p> : null}
                  {warnings.length ? (
                    <div className="mt-3 rounded border border-primary/25 bg-primary/5 p-3">
                      <p className="font-label text-label-sm uppercase text-primary">Partial ingestion notes</p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 font-body text-body-sm text-on-surface-variant">
                        {warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={openWorkspace} icon={<ArrowRight className="h-4 w-4" />}>
                      Open Investigation Workspace
                    </Button>
                    <Button variant="ghost" onClick={() => void reindex()} icon={<RotateCw className="h-4 w-4" />}>
                      Re-index graph
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === "verified" && connection?.alreadyIndexed && preview ? (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-outline-variant pt-5">
              <Button onClick={openWorkspace} icon={<ArrowRight className="h-4 w-4" />}>Open Investigation Workspace</Button>
              <Button variant="ghost" onClick={() => void reindex()} icon={<RotateCw className="h-4 w-4" />}>Re-index graph</Button>
            </div>
          ) : null}
        </section>

        {error ? (
          <ErrorState
            title="Case could not be opened."
            message={error}
            onRetry={() => {
              setError(null);
              setPhase(preview ? "verified" : "idle");
            }}
            action={
              preview?.url ? (
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className={buttonClasses("ghost", "sm")}>
                  <ExternalLink className="h-3.5 w-3.5" /> View repository
                </a>
              ) : null
            }
          />
        ) : null}

        <div className="flex flex-col gap-4 rounded-md border border-outline-variant bg-surface-container/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" aria-hidden="true" />
            <div>
              <p className="font-body text-body-sm text-on-surface">
                No repository handy? Explore the <span className="font-semibold">DEMO DATA</span> case.
              </p>
              <p className="font-mono text-mono-sm text-on-surface-variant">Synthetic records · no GitHub or Neo4j request</p>
            </div>
          </div>
          <Link href="/report/demo" className="shrink-0 font-label text-label-md uppercase text-primary hover:underline">
            Open demo dossier
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Hint icon={<Github className="h-4 w-4" />} title="Public by default">
            Any accessible public repository can be investigated without owning it.
          </Hint>
          <Hint icon={<ShieldAlert className="h-4 w-4" />} title="Private access">
            Private repositories require a server-side token with repository read permissions.
          </Hint>
          <Hint icon={<AlertTriangle className="h-4 w-4" />} title="Bounded ingestion">
            History is capped by configurable limits. Partial pages are reported, never silently dropped.
          </Hint>
        </div>
      </div>
    </main>
  );
}

function Hint({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-outline-variant/70 bg-surface-container-low/60 p-3.5">
      <div className="flex items-center gap-2 text-primary/80">
        {icon}
        <p className="font-label text-[10px] uppercase tracking-wider text-on-surface-variant">{title}</p>
      </div>
      <p className="mt-2 font-body text-body-sm text-on-surface-variant">{children}</p>
    </div>
  );
}
