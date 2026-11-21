"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { RepositorySummary } from "@/lib/types";

const STORAGE_KEY = "whytrace:repository:v1";

interface RepoContextValue {
  repository: RepositorySummary | null;
  hydrated: boolean;
  setRepository: (repository: RepositorySummary | null) => void;
  clearRepository: () => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

function isValidRepository(value: unknown): value is RepositorySummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RepositorySummary>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.fullName === "string" &&
    typeof candidate.owner === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.branch === "string" &&
    typeof candidate.url === "string"
  );
}

export function RepoProvider({ children }: { children: React.ReactNode }) {
  const [repository, setRepositoryState] = useState<RepositorySummary | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValidRepository(parsed)) setRepositoryState(parsed);
      }
    } catch {
      // Corrupt local state is discarded rather than trusted.
    } finally {
      setHydrated(true);
    }
  }, []);

  const setRepository = useCallback((repository: RepositorySummary | null) => {
    setRepositoryState(repository);
    try {
      if (repository) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(repository));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be disabled; the in-memory connection still works for this view.
    }
  }, []);

  const clearRepository = useCallback(() => setRepository(null), [setRepository]);

  const value = useMemo(
    () => ({ repository, hydrated, setRepository, clearRepository }),
    [repository, hydrated, setRepository, clearRepository],
  );

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextValue {
  const context = useContext(RepoContext);
  if (!context) throw new Error("useRepo must be used within RepoProvider");
  return context;
}
