import type { Metadata } from "next";
import { CaseFilesView } from "@/components/case-files-view";

export const metadata: Metadata = {
  title: "Case Files",
};

export default function CaseFilesPage() {
  return <CaseFilesView />;
}
