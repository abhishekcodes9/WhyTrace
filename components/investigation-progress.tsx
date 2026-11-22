"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2, CircleDashed, Clock3, FileCheck2, MinusCircle, ScanSearch, XCircle,
} from "lucide-react";
import type {
  InvestigationStageEvent, InvestigationStageId, InvestigationStageStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export const INVESTIGATION_STAGES: { id: InvestigationStageId; name: string; number: number }[] = [
  { id: "case", name: "Opening the Case", number: 1 },
  { id: "graph", name: "Accessing the Evidence Graph", number: 2 },
  { id: "connections", name: "Tracing Evidence Connections", number: 3 },
  { id: "evidence", name: "Examining Historical Evidence", number: 4 },
  { id: "synthesis", name: "Preparing the Explanation", number: 5 },
  { id: "persistence", name: "Finalising the Case File", number: 6 },
];

export interface InvestigationStageView {
  status: InvestigationStageStatus;
  message: string;
  detail?: string;
  counts?: InvestigationStageEvent["counts"];
}

export type InvestigationStageMap = Record<InvestigationStageId, InvestigationStageView>;

export function initialInvestigationStages(): InvestigationStageMap {
  return Object.fromEntries(
    INVESTIGATION_STAGES.map((stage) => [
      stage.id,
      { status: "pending", message: "Waiting for the previous operation to finish." },
    ]),
  ) as InvestigationStageMap;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function CountChips({ counts }: { counts?: InvestigationStageEvent["counts"] }) {
  if (!counts) return null;
  const entries = [
    ["seeds", counts.seeds],
    ["candidates", counts.candidates],
    ["records", counts.records],
    ["links", counts.relationships],
    ["citations", counts.citations],
  ].filter(([, value]) => typeof value === "number" && Number.isFinite(value)) as [string, number][];
  if (!entries.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([label, value]) => (
        <span key={label} className="rounded-sm border border-primary/25 bg-primary/8 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
          {value.toLocaleString()} {label}
        </span>
      ))}
    </div>
  );
}

function StageIcon({ status }: { status: InvestigationStageStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-[#86b592]" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-[#d8938b]" />;
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-on-surface-variant" />;
  if (status === "active") return <ScanSearch className="h-4 w-4 text-primary" />;
  return <CircleDashed className="h-4 w-4 text-on-surface-variant/50" />;
}

export function InvestigationProgressPanel({
  stages,
  elapsed,
  indeterminate,
  completedCase,
  onOpenCase,
}: {
  stages: InvestigationStageMap;
  elapsed: number;
  indeterminate: boolean;
  completedCase: { id: string; caseNumber: string } | null;
  onOpenCase: () => void;
}) {
  const reduced = useReducedMotion();
  const active = INVESTIGATION_STAGES.find((stage) => stages[stage.id]?.status === "active");
  const failed = INVESTIGATION_STAGES.find((stage) => stages[stage.id]?.status === "failed");
  const completedCount = INVESTIGATION_STAGES.filter((stage) => ["completed", "skipped"].includes(stages[stage.id]?.status)).length;
  const current = failed
    ? stages[failed.id]
    : active
      ? stages[active.id]
      : completedCase
        ? stages.persistence
        : null;

  return (
    <section
      className="walnut-panel relative overflow-hidden rounded-md border border-primary/40 shadow-[0_24px_80px_rgba(0,0,0,0.36)]"
      aria-live="polite"
      aria-busy={!completedCase && !failed}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(520px circle at 18% 8%, rgba(196,154,88,0.15), transparent 68%)" }} />
      <div className={cn("pointer-events-none absolute inset-0 opacity-30", !reduced && !completedCase ? "scanline" : "")} />

      <div className="relative border-b border-primary/20 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(196,154,88,0.65)]" />
            <p className="font-label text-[10px] uppercase tracking-[0.2em] text-primary">Case processing desk</p>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3 w-3 text-primary/80" /> {formatElapsed(elapsed)}</span>
            <span>{completedCount}/{INVESTIGATION_STAGES.length} STAGES</span>
          </div>
        </div>
      </div>

      <div className="relative grid gap-5 p-4 md:grid-cols-[230px_1fr] md:gap-6 md:p-6">
        <div className="flex flex-col items-center justify-center gap-4 rounded border border-primary/15 bg-deep-charcoal/45 px-4 py-5 text-center">
          <div className="relative flex h-28 w-28 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            <div className="absolute inset-3 rounded-full border border-dashed border-primary/25" />
            {!reduced && !completedCase && !failed ? (
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
                style={{ background: "conic-gradient(from 90deg, transparent 0deg, rgba(196,154,88,0.35) 42deg, transparent 78deg)" }}
              />
            ) : null}
            <div className={cn(
              "relative flex h-16 w-16 items-center justify-center rounded-full border bg-surface-container",
              failed ? "border-secondary/70 text-[#d8938b]" : completedCase ? "border-[#86b592]/60 text-[#86b592]" : "border-primary/60 text-primary",
            )}>
              {completedCase ? <FileCheck2 className="h-7 w-7" /> : failed ? <XCircle className="h-7 w-7" /> : <ScanSearch className="h-7 w-7" />}
            </div>
            {!reduced && !completedCase && !failed ? (
              <motion.span
                className="absolute inset-6 rounded-full border border-secondary/50"
                animate={{ opacity: [0.25, 0.8, 0.25], scale: [1, 1.12, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
            ) : null}
          </div>
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.18em] text-primary">
              {completedCase ? "Dossier ready" : failed ? "Processing halted" : indeterminate ? "Case in progress" : "Investigation active"}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              {completedCase ? completedCase.caseNumber : `Stage ${active?.number ?? 1} of ${INVESTIGATION_STAGES.length}`}
            </p>
          </div>
          <div className="w-full">
            <div className="h-1 overflow-hidden rounded-full bg-surface-container-highest">
              <motion.div
                className={cn("h-full rounded-full", failed ? "bg-secondary" : "bg-primary")}
                animate={{ width: `${completedCase ? 100 : Math.max(4, (completedCount / INVESTIGATION_STAGES.length) * 100)}%` }}
                transition={{ duration: reduced ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            {indeterminate ? <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Live stage detail unavailable</p> : null}
          </div>
        </div>

        <div>
          <div className="mb-4 rounded border border-primary/20 bg-surface-container/55 px-3 py-2.5">
            <p className="font-label text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">Current operation</p>
            <motion.p
              key={current?.message ?? "waiting"}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="mt-1 font-body text-body-md text-on-surface"
            >
              {current?.message ?? "Awaiting the case-processing signal."}
            </motion.p>
            {current?.detail ? <p className="mt-1 font-mono text-[10px] leading-relaxed text-on-surface-variant">{current.detail}</p> : null}
            <CountChips counts={current?.counts} />
          </div>

          <ol className="relative flex flex-col">
            <span className="absolute bottom-3 left-[11px] top-3 w-px bg-outline-variant" aria-hidden="true" />
            {INVESTIGATION_STAGES.map((definition) => {
              const view = stages[definition.id];
              const status = view?.status ?? "pending";
              return (
                <li key={definition.id} className="relative flex gap-3 pb-3 last:pb-0">
                  <span className={cn(
                    "relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border bg-surface-container",
                    status === "active" ? "border-primary shadow-[0_0_14px_rgba(196,154,88,0.3)]" : status === "completed" ? "border-[#86b592]/55" : status === "failed" ? "border-secondary/75" : "border-outline-variant",
                  )}>
                    <StageIcon status={status} />
                  </span>
                  {status === "completed" ? (
                    <span className="absolute left-[11px] top-[22px] h-[calc(100%-18px)] w-px bg-secondary/70" aria-hidden="true" />
                  ) : null}
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={cn(
                        "font-label text-[10px] uppercase tracking-[0.13em]",
                        status === "active" ? "text-primary" : status === "completed" ? "text-on-surface" : status === "failed" ? "text-[#d8938b]" : "text-on-surface-variant/70",
                      )}>
                        {definition.number}. {definition.name}
                      </p>
                      <span className={cn(
                        "font-mono text-[8px] uppercase tracking-[0.14em]",
                        status === "active" ? "text-primary" : status === "completed" ? "text-[#86b592]" : status === "failed" ? "text-[#d8938b]" : status === "skipped" ? "text-primary/70" : "text-on-surface-variant/50",
                      )}>
                        {status}
                      </span>
                    </div>
                    <p className="mt-0.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
                      {view?.message}
                    </p>
                    {view?.detail && status !== "active" ? <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-on-surface-variant/70">{view.detail}</p> : null}
                    <CountChips counts={view?.counts} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {completedCase ? (
        <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-primary/25 bg-primary/8 px-4 py-3 md:px-6">
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
            Case file persisted and read back from Neo4j
          </p>
          <button
            type="button"
            onClick={onOpenCase}
            className="inline-flex items-center gap-2 rounded border border-primary bg-primary px-3 py-1.5 font-label text-[10px] uppercase tracking-wider text-on-primary hover:bg-[#d2a963]"
          >
            Open dossier
          </button>
        </div>
      ) : null}
    </section>
  );
}
