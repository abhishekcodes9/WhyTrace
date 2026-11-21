import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardPageView } from "@/components/board-page";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Evidence Board",
};

export default function BoardPage() {
  return (
    <Suspense fallback={<main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center"><LoadingState label="Pinning evidence…" /></main>}>
      <BoardPageView />
    </Suspense>
  );
}
