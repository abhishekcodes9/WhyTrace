"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "paper";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  const base =
    "inline-flex items-center justify-center gap-2 rounded font-label font-semibold uppercase tracking-wider " +
    "transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] disabled:cursor-not-allowed disabled:opacity-45 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  const sizes: Record<ButtonSize, string> = {
    sm: "px-3.5 py-2 text-[11px] leading-4",
    md: "px-5 py-2.5 text-label-lg",
    lg: "px-7 py-3.5 text-label-lg",
  };
  const variants: Record<ButtonVariant, string> = {
    primary:
      "border border-primary bg-primary text-on-primary hover:bg-on-primary-container hover:text-on-primary-container",
    secondary:
      "border border-primary/50 bg-surface-container-high/90 text-on-surface hover:border-primary hover:bg-surface-container-highest",
    ghost:
      "border border-outline-variant bg-transparent text-on-surface-variant hover:border-primary/60 hover:text-on-surface",
    danger:
      "border border-secondary bg-secondary text-on-secondary hover:bg-secondary-container",
    paper:
      "border border-paper-muted/40 bg-deep-charcoal text-warm-cream hover:bg-leather-brown",
  };
  return cn(base, sizes[size], variants[variant], className);
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={buttonClasses(variant, size, className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  icon,
  children,
  ...props
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: ReactNode;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
