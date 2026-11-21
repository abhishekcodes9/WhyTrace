import { NextResponse } from "next/server";
import { graphQuerySchema, isValidRepositoryFullName } from "@/lib/validation";
import { errorResponse, noStoreHeaders } from "@/lib/server/http";
import { loadRepositoryGraph } from "@/lib/server/graph-retrieval";
import { readInvestigation } from "@/lib/server/investigations";
import { getSessionId } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = graphQuerySchema.parse({
      repoFullName: url.searchParams.get("repoFullName") ?? undefined,
      investigationId: url.searchParams.get("investigationId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      kinds: url.searchParams.get("kinds") ?? undefined,
    });
    if (!isValidRepositoryFullName(query.repoFullName)) {
      return NextResponse.json({ error: "Repository identity is invalid." }, { status: 400 });
    }
    if (query.investigationId) {
      const sessionId = await getSessionId();
      if (!sessionId) return NextResponse.json({ error: "No investigation session." }, { status: 401 });
      const report = await readInvestigation(query.investigationId, sessionId);
      if (!report) return NextResponse.json({ error: "Case not found in this browser session." }, { status: 404 });
      return NextResponse.json(
        { graph: report.graph, investigationId: report.id, persisted: true, question: report.question },
        { headers: noStoreHeaders() },
      );
    }
    const kinds = query.kinds ? query.kinds.split(",").map((kind) => kind.trim()).filter(Boolean) : undefined;
    const graph = await loadRepositoryGraph(query.repoFullName.toLowerCase(), query.limit ?? 180, kinds);
    return NextResponse.json({ graph, persisted: true }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
