"use client";

import { AlertTriangle, FileSearch, Loader2, SearchX } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function LoadingState({ label = "Reading the record…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-16 text-center", className)} role="status" aria-live="polite">
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-surface-container">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        <span className="absolute inset-0 rounded-full border border-primary/20" />
      </span>
      <div>
        <p className="font-headline text-headline-sm text-on-surface">{label}</p>
        <p className="mt-1 font-mono text-mono-sm text-on-surface-variant">Retrieving repository evidence</p>
      </div>
    </div>
  );
}

export function ErrorState({
  title = "The trail went cold.",
  message,
  action,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-secondary/40 bg-secondary-container/20 p-6 md:p-8", className)} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc7c2]" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
          <p className="font-body text-body-md text-on-surface-variant">{message}</p>
          {onRetry || action ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {onRetry ? (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
  className,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-outline-variant bg-surface-container/40 px-6 py-16 text-center", className)}>
      <FileSearch className="h-7 w-7 text-primary/70" aria-hidden="true" />
      <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
      <p className="max-w-md font-body text-body-md text-on-surface-variant">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function NoEvidenceState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-outline-variant bg-surface-container/50 p-4">
      <SearchX className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
      <p className="font-body text-body-sm text-on-surface-variant">{message}</p>
    </div>
  );
}

export function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("shimmer h-3 rounded-sm", className)} aria-hidden="true" />;
}
