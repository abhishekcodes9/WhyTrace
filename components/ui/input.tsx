"use client";

import { cn } from "@/lib/utils";

export function Input({
  label,
  hint,
  error,
  icon,
  className,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex w-full flex-col gap-2" htmlFor={id}>
      {label ? <span className="font-label text-label-md uppercase text-on-surface-variant">{label}</span> : null}
      <span className="relative flex items-center">
        {icon ? <span className="pointer-events-none absolute left-3.5 flex text-primary">{icon}</span> : null}
        <input
          id={id}
          className={cn(
            "w-full rounded-md border border-outline-variant bg-surface-container-low px-3.5 py-3 font-mono text-mono-md text-on-surface",
            "placeholder:text-on-surface-variant/55 transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
            icon ? "pl-11" : "",
            error ? "border-secondary" : "",
            className,
          )}
          aria-invalid={Boolean(error)}
          {...props}
        />
      </span>
      {error ? <span className="font-mono text-mono-sm text-[#ffc7c2]">{error}</span> : null}
      {!error && hint ? <span className="font-body text-body-sm text-on-surface-variant/80">{hint}</span> : null}
    </label>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="flex w-full flex-col gap-2" htmlFor={id}>
      {label ? <span className="font-label text-label-md uppercase text-on-surface-variant">{label}</span> : null}
      <textarea
        id={id}
        className={cn(
          "w-full resize-none rounded-md border border-outline-variant bg-surface-container-low p-4 font-body text-body-lg text-on-surface",
          "placeholder:text-on-surface-variant/50 transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
          error ? "border-secondary" : "",
          className,
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error ? <span className="font-mono text-mono-sm text-[#ffc7c2]">{error}</span> : null}
      {!error && hint ? <span className="font-body text-body-sm text-on-surface-variant/80">{hint}</span> : null}
    </label>
  );
}

export function Select({
  label,
  className,
  id,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="flex w-full flex-col gap-2" htmlFor={id}>
      {label ? <span className="font-label text-label-md uppercase text-on-surface-variant">{label}</span> : null}
      <select
        id={id}
        className={cn(
          "w-full appearance-none rounded-md border border-outline-variant bg-surface-container-low px-3.5 py-3 font-mono text-mono-md text-on-surface",
          "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
