import type { Metadata } from "next";
import { ConnectFlow } from "@/components/connect-flow";

export const metadata: Metadata = {
  title: "Choose Your Case",
  description: "Connect a GitHub repository and build its Neo4j engineering-history graph.",
};

export default function ConnectPage() {
  return <ConnectFlow />;
}
