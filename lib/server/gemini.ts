import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { Citation, Claim, EvidenceItem, SynthesisState } from "@/lib/types";
import { serverEnv, isGeminiConfigured } from "./env";

export const ABSTENTION = "I could not establish a reliable historical explanation from the repository records currently available.";

const aiClaimSchema = z.object({
  text: z.string().trim().min(1).max(1_800),
  evidenceIds: z.array(z.string().trim().min(1)).default([]),
});

const aiResponseSchema = z.object({
  summary: z.string().trim().min(1).max(2_400),
  documentedRationale: z.array(aiClaimSchema).default([]),
  technicalObservations: z.array(aiClaimSchema).default([]),
  inferences: z.array(aiClaimSchema).default([]),
  uncertainties: z.array(z.string().trim().max(800)).default([]),
  supersessionStatus: z.enum(["superseded", "active", "unknown"]).catch("unknown"),
  supersessionNote: z.string().trim().max(1_000).default(""),
});

export interface SynthesisResult {
  summary: string;
  documentedRationale: Claim[];
  technicalObservations: Claim[];
  inferences: Claim[];
  uncertainties: string[];
  citations: Citation[];
  synthesis: SynthesisState;
  rejectedClaimCount: number;
}

function citationsFor(claims: Claim[], evidence: EvidenceItem[]): Citation[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const claim of claims) {
    for (const id of claim.evidenceIds) {
      if (seen.has(id)) continue;
      const item = byId.get(id);
      if (!item) continue;
      seen.add(id);
      citations.push({
        evidenceId: item.id,
        kind: item.kind,
        title: item.title,
        reference: item.reference,
        url: item.url,
      });
    }
  }
  return citations;
}

function validateClaims(claims: Claim[], validIds: Set<string>): { valid: Claim[]; rejected: number } {
  let rejected = 0;
  const valid: Claim[] = [];
  for (const claim of claims) {
    const ids = [...new Set(claim.evidenceIds.filter((id) => validIds.has(id)))];
    if (!ids.length) {
      rejected += 1;
      continue;
    }
    valid.push({ text: claim.text, evidenceIds: ids });
  }
  return { valid, rejected };
}

function evidencePackage(evidence: EvidenceItem[]): string {
  return JSON.stringify(
    evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      reference: item.reference,
      date: item.date,
      author: item.author,
      excerpt: item.excerpt,
      url: item.url,
      direct: item.direct,
      meta: item.meta,
    })),
    null,
    2,
  );
}

function buildPrompt(input: {
  question: string;
  repoFullName: string;
  branch: string;
  evidence: EvidenceItem[];
  relationships: { type: string; source: string; target: string }[];
  supersessionHint: string;
}): string {
  return `INVESTIGATION QUESTION:
${input.question}

REPOSITORY:
${input.repoFullName} (branch: ${input.branch})

RETRIEVED EVIDENCE (the only permitted factual basis):
${evidencePackage(input.evidence)}

RETRIEVED GRAPH RELATIONSHIPS (all source-confirmed):
${input.relationships.length ? input.relationships.map((rel) => `${rel.source} -[${rel.type}]-> ${rel.target}`).join("\n") : "No inter-evidence relationship beyond repository containment was retrieved."}

DETERMINISTIC SUPERSESSION SIGNAL:
${input.supersessionHint}

RULES:
1. Answer only from the evidence above. Do not use general knowledge, guesses, or plausible engineering conventions.
2. Every documentedRationale and technicalObservations claim MUST cite at least one exact evidence id from the list. Use the opaque id strings, never invent ids.
3. documentedRationale is only for explicitly documented reasoning found in PR bodies, issue text, ADRs, design documents, discussions, or commit messages. Quote or closely paraphrase; do not infer motive.
4. technicalObservations may describe what the evidence shows about code/diffs/architecture, but not why it was chosen unless documented.
5. inferences are explicitly labelled probable conclusions. Only include them when directly supported by cited evidence. Set evidenceIds.
6. Never invent commit SHAs, file paths, PR/issue numbers, developers, dates, decisions, or supersession links. Do not mention an entity absent from the evidence.
7. If the evidence does not support a reliable historical explanation, set summary to exactly: "${ABSTENTION}" and leave claim arrays empty. Do not manufacture confidence.
8. uncertainties should name the specific gaps (missing rationale, truncated patch, no linked issue, conflicting records).
9. Supersession status: "superseded" only if an explicit SUPERSEDES relationship or an explicit "Superseded" status appears in evidence. "active" only if a source explicitly states Active/Accepted and no supersession exists. Otherwise "unknown".
10. Return JSON only, exactly matching this shape:
{
  "summary": "2-4 sentence direct answer, or the exact abstention phrase",
  "documentedRationale": [{"text": "...", "evidenceIds": ["..."]}],
  "technicalObservations": [{"text": "...", "evidenceIds": ["..."]}],
  "inferences": [{"text": "...", "evidenceIds": ["..."]}],
  "uncertainties": ["..."],
  "supersessionStatus": "unknown",
  "supersessionNote": "short evidence-bound note"
}`;
}

function fallbackSynthesis(
  evidence: EvidenceItem[],
  message: string,
  status: "unavailable" | "not_configured",
): SynthesisResult {
  const quoteCandidates = evidence.filter((item) =>
    ["pullRequest", "issue", "designDocument", "decision", "commit", "discussion"].includes(item.kind),
  ).slice(0, 3);
  const documentedRationale: Claim[] = quoteCandidates
    .filter((item) => item.excerpt.trim().length > 0)
    .map((item) => ({
      text: `Retrieved from ${item.reference}: “${item.excerpt.slice(0, 420)}”`,
      evidenceIds: [item.id],
    }));
  const citations = citationsFor(documentedRationale, evidence);
  const summary = evidence.length
    ? `AI synthesis is ${status === "not_configured" ? "not configured" : "currently unavailable"}. WHYTRACE retrieved ${evidence.length} repository record${evidence.length === 1 ? "" : "s"} related to this question. The quoted records below are shown without AI interpretation.`
    : ABSTENTION;
  return {
    summary,
    documentedRationale,
    technicalObservations: [],
    inferences: [],
    uncertainties: [
      status === "not_configured"
        ? "GEMINI_API_KEY is not configured, so no AI synthesis was attempted."
        : `Gemini synthesis was unavailable: ${message}`,
      "No interpretive conclusion should be drawn beyond the retrieved quotes.",
    ],
    citations,
    synthesis: {
      provider: "gemini",
      status,
      model: status === "not_configured" ? null : serverEnv.geminiModel,
      message:
        status === "not_configured"
          ? "Gemini is not configured. A deterministic quote-only report was produced."
          : `Gemini could not complete synthesis. A deterministic quote-only report was produced. ${message}`,
    },
    rejectedClaimCount: 0,
  };
}

export async function synthesizeInvestigation(input: {
  question: string;
  repoFullName: string;
  branch: string;
  evidence: EvidenceItem[];
  relationships: { type: string; source: string; target: string }[];
  supersessionHint: string;
}): Promise<SynthesisResult> {
  if (!input.evidence.length) {
    return {
      summary: ABSTENTION,
      documentedRationale: [],
      technicalObservations: [],
      inferences: [],
      uncertainties: ["No repository evidence matched the investigation question."],
      citations: [],
      synthesis: {
        provider: "gemini",
        status: "unavailable",
        model: null,
        message: "Synthesis skipped because graph retrieval returned no evidence.",
      },
      rejectedClaimCount: 0,
    };
  }
  if (!isGeminiConfigured()) {
    return fallbackSynthesis(input.evidence, "GEMINI_API_KEY is not configured.", "not_configured");
  }

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ai = new GoogleGenAI({ apiKey: serverEnv.geminiApiKey });
      const response = await Promise.race([
        ai.models.generateContent({
          model: serverEnv.geminiModel,
          contents: buildPrompt(input),
          config: {
            temperature: 0.1,
            topP: 0.85,
            maxOutputTokens: 3_500,
            responseMimeType: "application/json",
            systemInstruction:
              "You are WHYTRACE, a forensic software historian. Evidence before explanation; uncertainty before assumption. You never answer beyond the supplied repository evidence package.",
          },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini request timed out after 70 seconds.")), 70_000)),
      ]);
      const rawText = response.text;
      if (!rawText) throw new Error("Gemini returned an empty response.");
      const jsonText = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = aiResponseSchema.safeParse(JSON.parse(jsonText));
      if (!parsed.success) {
        throw new Error(`Gemini response failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown issue"}`);
      }
      const output = parsed.data;
      const validIds = new Set(input.evidence.map((item) => item.id));
      const documented = validateClaims(output.documentedRationale, validIds);
      const technical = validateClaims(output.technicalObservations, validIds);
      const inferences = validateClaims(output.inferences, validIds);
      const rejected = documented.rejected + technical.rejected + inferences.rejected;

      const claims = [...documented.valid, ...technical.valid, ...inferences.valid];
      const citations = citationsFor(claims, input.evidence);
      const summary = output.summary.trim() || ABSTENTION;

      return {
        summary,
        documentedRationale: documented.valid,
        technicalObservations: technical.valid,
        inferences: inferences.valid,
        uncertainties: output.uncertainties.slice(0, 10),
        citations,
        synthesis: {
          provider: "gemini",
          status: "completed",
          model: serverEnv.geminiModel,
          message: `Structured synthesis completed with ${serverEnv.geminiModel}; ${citations.length} citation${citations.length === 1 ? "" : "s"} validated against retrieved evidence.`,
        },
        rejectedClaimCount: rejected,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown Gemini error";
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  return fallbackSynthesis(input.evidence, lastError, "unavailable");
}

export { citationsFor };
