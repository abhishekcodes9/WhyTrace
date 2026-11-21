import { NextResponse } from "next/server";
import { investigateSchema, isValidBranch, isValidRepositoryFullName } from "@/lib/validation";
import { errorResponse, noStoreHeaders } from "@/lib/server/http";
import { runInvestigation } from "@/lib/server/investigation";
import { getOrCreateSessionId } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = investigateSchema.parse(body);
    if (!isValidRepositoryFullName(input.repoFullName)) {
      throw new Error("The repository identity is invalid.");
    }
    if (input.branch && !isValidBranch(input.branch)) {
      throw new Error("The branch name is invalid.");
    }
    const sessionId = await getOrCreateSessionId();
    const report = await runInvestigation({
      repoFullName: input.repoFullName,
      branch: input.branch,
      question: input.question,
      focus: input.focus,
      sessionId,
    });
    return NextResponse.json({ report }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
