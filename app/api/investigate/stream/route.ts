import type { InvestigationEvent, InvestigationStageId } from "@/lib/types";
import { investigateSchema, isValidBranch, isValidRepositoryFullName } from "@/lib/validation";
import { errorResponse, noStoreHeaders, userMessage } from "@/lib/server/http";
import { runInvestigation } from "@/lib/server/investigation";
import { getOrCreateSessionId } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Streaming investigation endpoint. Every stage event is emitted by
 * runInvestigation after the corresponding Neo4j, retrieval, synthesis or
 * persistence operation actually starts or finishes. No timer advances stages.
 */
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
    const started = Date.now();
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastStage: InvestigationStageId = "case";
        const send = (event: InvestigationEvent) => {
          if (closed) return;
          if (event.type === "stage") lastStage = event.stage;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        };

        try {
          const report = await runInvestigation({
            repoFullName: input.repoFullName,
            branch: input.branch,
            question: input.question,
            focus: input.focus,
            sessionId,
            onProgress: send,
          });
          send({ type: "complete", report, durationMs: Date.now() - started });
        } catch (error) {
          send({
            type: "error",
            message: userMessage(error),
            code: typeof error === "object" && error && "code" in error
              ? String((error as { code?: unknown }).code ?? "")
              : undefined,
            stage: lastStage,
          });
        } finally {
          if (!closed) {
            try {
              controller.close();
            } catch {
              // Stream was already closed by the client.
            }
          }
        }
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...noStoreHeaders(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
