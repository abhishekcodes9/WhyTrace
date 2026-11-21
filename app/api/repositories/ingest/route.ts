import type { IngestionEvent } from "@/lib/types";
import { ingestSchema, isValidBranch, isValidRepositoryFullName, parseGitHubRepoUrl } from "@/lib/validation";
import { ingestRepository } from "@/lib/server/ingest";
import { GitHubClient } from "@/lib/server/github";
import { markIngestionFailed, markIngestionRunning } from "@/lib/server/repository";
import { userMessage } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-Sent Events stream of real ingestion work. Each event is emitted only
 * after the corresponding GitHub fetch or Neo4j write has completed.
 */
export async function POST(request: Request) {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: IngestionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let repoId: string | null = null;
      try {
        const body = await request.json().catch(() => ({}));
        const input = ingestSchema.parse(body);
        let owner: string;
        let name: string;
        let fullName: string;
        if (input.url) {
          const parsed = parseGitHubRepoUrl(input.url);
          owner = parsed.owner;
          name = parsed.name;
          fullName = parsed.fullName;
        } else if (input.fullName && isValidRepositoryFullName(input.fullName)) {
          const [parsedOwner, parsedName] = input.fullName.split("/");
          owner = parsedOwner;
          name = parsedName;
          fullName = input.fullName;
        } else {
          throw new Error("Provide a valid GitHub repository URL or owner/repository name.");
        }
        if (input.branch && !isValidBranch(input.branch)) {
          throw new Error("The branch name is not valid.");
        }

        repoId = fullName.toLowerCase();
        const repo = await new GitHubClient().getRepo(owner, name);
        repoId = repo.fullName.toLowerCase();
        send({ type: "stage", stage: 1, stageName: "Repository", message: `Opened ${repo.fullName}` });
        await markIngestionRunning(repoId, repo.fullName);

        const result = await ingestRepository({
          owner,
          name,
          branch: input.branch,
          knownRepo: repo,
          onProgress: send,
        });
        send({ type: "complete", repository: result.repository, counts: result.counts, warnings: result.warnings, durationMs: result.durationMs });
      } catch (error) {
        const message = userMessage(error);
        if (repoId) {
          await markIngestionFailed(repoId, message).catch(() => undefined);
        }
        send({ type: "error", message });
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
    },
  });
}
