"use client";

import { cn } from "@/lib/utils";

const variants = {
  brass: "border-primary/45 bg-primary/10 text-primary",
  success: "border-success/50 bg-success/15 text-[#a9cbb3]",
  danger: "border-secondary/60 bg-secondary-container/45 text-[#ffc7c2]",
  neutral: "border-outline-variant bg-surface-container-high text-on-surface-variant",
  paper: "border-paper-muted/35 bg-warm-cream/55 text-on-paper",
  outline: "border-outline bg-transparent text-on-surface-variant",
} as const;

export type BadgeVariant = keyof typeof variants;

export function Badge({
  children,
  variant = "neutral",
  className,
  dot,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: "primary" | "success" | "danger" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-label text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap",
        variants[variant],
        className,
      )}
    >
      {dot ? <StatusDot status={dot} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ status = "neutral", pulse = false }: { status?: "primary" | "success" | "danger" | "neutral"; pulse?: boolean }) {
  const colors = {
    primary: "bg-primary",
    success: "bg-success",
    danger: "bg-secondary",
    neutral: "bg-outline",
  };
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse ? <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", colors[status])} /> : null}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", colors[status])} />
    </span>
  );
}

export function Stamp({ children, tone = "brass", className }: { children: React.ReactNode; tone?: "brass" | "oxblood" | "ink"; className?: string }) {
  const tones = {
    brass: "text-primary border-primary/60",
    oxblood: "text-secondary border-secondary/60",
    ink: "text-paper-muted border-paper-muted/50",
  };
  return (
    <span className={cn("stamp inline-block px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]", tones[tone], className)}>
      {children}
    </span>
  );
}
