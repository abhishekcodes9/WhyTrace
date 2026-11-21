"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accessible, lightweight tooltip. Avoids portals and heavy positioning. */
export function Tooltip({ label, children, className }: { label: string; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("group relative inline-flex items-center", className)} tabIndex={0} aria-label={label}>
      {children ?? <Info className="h-3.5 w-3.5 text-on-surface-variant/70" aria-hidden="true" />}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-64 -translate-x-1/2 rounded border border-outline-variant bg-surface-container-high px-2.5 py-1.5 font-body text-body-sm text-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
