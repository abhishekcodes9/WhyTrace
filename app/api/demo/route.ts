import { NextResponse } from "next/server";
import { DEMO_REPORT } from "@/lib/demo-data";
import { noStoreHeaders } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      report: DEMO_REPORT,
      graph: DEMO_REPORT.graph,
      demo: true,
      notice: "DEMO DATA — synthetic records; no GitHub, Neo4j or Gemini request was made.",
    },
    { headers: noStoreHeaders() },
  );
}
