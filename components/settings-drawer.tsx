"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Database, Sparkles, X, RefreshCw, ShieldCheck } from "lucide-react";
import { GithubLogo as Github } from "@/components/icons";
import type { Diagnostics } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonLine } from "@/components/ui/states";

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reduced = useReducedMotion();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const body = (await response.json()) as Diagnostics | { error?: string };
      if (!response.ok) throw new Error(("error" in body && body.error) || "Diagnostics request failed.");
      setDiagnostics(body as Diagnostics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read diagnostics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="absolute inset-0 bg-deep-charcoal/75 backdrop-blur-[1px]" onClick={onClose} aria-label="Close settings" />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Diagnostics and settings"
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col justify-between overflow-y-auto border-l border-outline-variant bg-surface-container p-6"
            initial={reduced ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: "100%" }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex flex-col gap-6">
              <div className="flex items-start justify-between gap-4 border-b border-outline-variant pb-4">
                <div>
                  <h2 className="font-headline text-headline-sm text-on-surface">Diagnostics &amp; Settings</h2>
                  <p className="font-mono text-mono-sm text-on-surface-variant">Server-side verification</p>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                  aria-label="Close settings"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="rounded border border-outline-variant bg-surface-container-low p-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                  <p className="font-label text-label-sm uppercase text-on-surface-variant">Credential safety</p>
                </div>
                <p className="mt-2 font-body text-body-sm text-on-surface-variant">
                  Secrets remain server-side. This panel reports configuration and live connection state only; token values are never sent to the browser.
                </p>
              </div>

              {loading && !diagnostics ? (
                <div className="flex flex-col gap-3" aria-label="Loading diagnostics">
                  <SkeletonLine className="w-2/3" />
                  <SkeletonLine className="w-full" />
                  <SkeletonLine className="w-5/6" />
                </div>
              ) : null}

              {error ? (
                <div className="rounded border border-secondary/50 bg-secondary-container/30 p-3">
                  <p className="font-body text-body-sm text-[#ffc7c2]">{error}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                    Retry
                  </Button>
                </div>
              ) : null}

              {diagnostics ? (
                <div className="flex flex-col gap-3">
                  <IntegrationRow
                    icon={<Database className="h-4 w-4" />}
                    title="Neo4j graph engine"
                    configured={diagnostics.neo4j.configured}
                    connected={diagnostics.neo4j.connected}
                    primary={diagnostics.neo4j.connected ? `Connected · ${diagnostics.neo4j.latencyMs ?? 0}ms` : diagnostics.neo4j.message}
                    secondary={diagnostics.neo4j.database ? `Database: ${diagnostics.neo4j.database}` : "Set NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD"}
                  />
                  <IntegrationRow
                    icon={<Github className="h-4 w-4" />}
                    title="GitHub API"
                    configured={diagnostics.github.configured}
                    connected={diagnostics.github.configured}
                    primary={diagnostics.github.message}
                    secondary="Public repositories work without a token; authenticated limits are recommended."
                  />
                  <IntegrationRow
                    icon={<Sparkles className="h-4 w-4" />}
                    title="Gemini synthesis"
                    configured={diagnostics.gemini.configured}
                    connected={diagnostics.gemini.configured}
                    primary={diagnostics.gemini.message}
                    secondary={`Model: ${diagnostics.gemini.model}`}
                  />
                  <div className="mt-2 border-t border-outline-variant pt-4">
                    <p className="font-label text-label-sm uppercase text-on-surface-variant">Runtime</p>
                    <p className="mt-1 font-mono text-mono-sm text-on-surface">{diagnostics.environment}</p>
                    <p className="mt-1 font-mono text-mono-sm text-on-surface-variant">WHYTRACE v1.0.0 · Node runtime</p>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-8 border-t border-outline-variant pt-4">
              <p className="font-body text-body-sm text-on-surface-variant">
                Missing credentials? Copy <span className="inline-code">.env.example</span> to <span className="inline-code">.env.local</span> and restart the server. Live integrations are never mocked in this panel.
              </p>
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function IntegrationRow({
  icon,
  title,
  configured,
  connected,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  title: string;
  configured: boolean;
  connected: boolean;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="rounded border border-outline-variant bg-surface-container-low p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-on-surface">
          <span className="text-primary">{icon}</span>
          <span className="font-label text-label-sm uppercase tracking-wider text-on-surface">{title}</span>
        </div>
        <Badge variant={connected ? "success" : configured ? "danger" : "neutral"} dot={connected ? "success" : configured ? "danger" : "neutral"}>
          {connected ? "Live" : configured ? "Error" : "Not configured"}
        </Badge>
      </div>
      <p className="mt-2 font-mono text-mono-sm text-on-surface">{primary}</p>
      <p className="mt-1 font-body text-body-sm text-on-surface-variant">{secondary}</p>
    </div>
  );
}
