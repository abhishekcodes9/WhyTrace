import type { Metadata } from "next";
import { Suspense } from "react";
import { InvestigationWorkspace } from "@/components/investigation-workspace";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Investigation Workspace",
};

export default function InvestigatePage() {
  return (
    <Suspense fallback={<main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center"><LoadingState label="Opening the investigation desk…" /></main>}>
      <InvestigationWorkspace />
    </Suspense>
  );
}
