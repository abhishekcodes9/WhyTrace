import { NextResponse } from "next/server";
import { errorResponse, noStoreHeaders } from "@/lib/server/http";
import { listInvestigations } from "@/lib/server/investigations";
import { getOrCreateSessionId } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessionId = await getOrCreateSessionId();
    const cases = await listInvestigations(sessionId);
    return NextResponse.json({ cases }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
