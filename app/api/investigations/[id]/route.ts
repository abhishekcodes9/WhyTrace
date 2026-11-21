import { NextResponse } from "next/server";
import { errorResponse, noStoreHeaders } from "@/lib/server/http";
import { deleteInvestigation, readInvestigation } from "@/lib/server/investigations";
import { getOrCreateSessionId } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const sessionId = await getOrCreateSessionId();
    const { id } = await context.params;
    if (!/^inv_[a-zA-Z0-9-]{8,80}$/.test(id)) {
      return NextResponse.json({ error: "Case id is invalid." }, { status: 400 });
    }
    const report = await readInvestigation(id, sessionId);
    if (!report) return NextResponse.json({ error: "Case not found in this browser session." }, { status: 404 });
    return NextResponse.json({ report }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const sessionId = await getOrCreateSessionId();
    const { id } = await context.params;
    if (!/^inv_[a-zA-Z0-9-]{8,80}$/.test(id)) {
      return NextResponse.json({ error: "Case id is invalid." }, { status: 400 });
    }
    const deleted = await deleteInvestigation(id, sessionId);
    if (!deleted) return NextResponse.json({ error: "Case not found in this browser session." }, { status: 404 });
    return NextResponse.json({ deleted: true }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
