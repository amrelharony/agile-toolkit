"use client";

/**
 * LLM-driven near-duplicate detector for outgoing kudos.
 *
 * Use case: a sender frequently sends two cards to the same teammate
 * within hours that say essentially the same thing ("thanks for the
 * deploy" + "appreciate the deploy help") — the wall ends up cluttered
 * with semantic duplicates. This module asks the LLM whether the new
 * candidate is functionally a repeat of a recent one to the same
 * recipient by the same sender. The caller stamps `llmDedupGroup` so
 * the wall renders the dup-group as a stack.
 *
 * Necessarily reads the message body (compare with `fairness.ts` which
 * deliberately avoids it). The prompt budget is bounded by trimming
 * `recent` to the last 20 candidates — the typical sender→recipient
 * pair has fewer than that in any reasonable window, and reading more
 * than 20 stops adding signal.
 *
 * Send-on-failure: any error returns `null` — the caller proceeds
 * without stamping the dedup group, so the wall shows the new kudos
 * as a standalone card.
 */

import { getActiveConfig, useLlmStore } from "@/lib/stores/llm-store";
import { getAdapter } from "@/lib/llm/registry";
import type { Kudos } from "@/lib/stores/workspace-types";

const MESSAGE_CHAR_CAP = 600;
const RECENT_CAP = 20;
const MAX_OUTPUT_TOKENS = 200;

export interface DedupResult {
  isDup: boolean;
  /** Existing kudos id this candidate duplicates. Only meaningful when
   *  `isDup` is true. The caller stamps `llmDedupGroup` on the new row
   *  using either this id or a fresh uuid (its choice). */
  dupId?: string;
  /** Model's similarity score, 0..1. Used for ranking when the wall
   *  surfaces "this looks like a repeat" UI later. */
  similarity: number;
}

interface DedupInput {
  candidate: Kudos;
  recent: Kudos[];
}

export async function detectDuplicate(
  input: DedupInput,
  signal?: AbortSignal
): Promise<DedupResult | null> {
  const cfg = getActiveConfig();
  if (!cfg) return null;

  // Cheap pre-filter: no recents means nothing to dedup against.
  const pool = input.recent.slice(-RECENT_CAP);
  if (pool.length === 0) return { isDup: false, similarity: 0 };

  const candidateBody = input.candidate.message.slice(0, MESSAGE_CHAR_CAP);
  const prompt = buildDedupPrompt(candidateBody, pool);

  try {
    const adapter = await getAdapter(cfg.provider);
    let accumulated = "";
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    await adapter.call(
      {
        prompt,
        system:
          "You are a precise classifier. Reply with ONLY the requested JSON object — no prose, no markdown fences.",
        signal: controller.signal,
        onChunk: (chunk) => {
          accumulated += chunk;
        },
      },
      { apiKey: cfg.apiKey, model: cfg.model },
      MAX_OUTPUT_TOKENS
    );
    return parseDedupResponse(accumulated, pool);
  } catch {
    return null;
  }
}

function buildDedupPrompt(candidateBody: string, pool: Kudos[]): string {
  // Number the pool so the model can reply with a numeric index.
  // Reverse map back to ids in `parseDedupResponse`.
  const numbered = pool
    .map((k, i) => {
      const body = k.message.slice(0, MESSAGE_CHAR_CAP).replace(/\n+/g, " ");
      return `${i + 1}. [id=${k.id}] ${body}`;
    })
    .join("\n");
  return [
    "Determine whether the candidate kudos below is a near-duplicate of any prior kudos.",
    "Near-duplicate = same core appreciation, even if wording differs.",
    "",
    "Return ONLY a JSON object with these exact fields:",
    "  - isDup: boolean",
    "  - dupId: the id string of the matched prior kudos, or null",
    "  - similarity: number between 0 and 1",
    "",
    "Prior kudos (most recent last):",
    numbered,
    "",
    "<candidate>",
    candidateBody,
    "</candidate>",
    "",
    "JSON:",
  ].join("\n");
}

function parseDedupResponse(raw: string, pool: Kudos[]): DedupResult | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  const end = cleaned.lastIndexOf("}");
  if (end < start) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    const isDup = p.isDup === true;
    const similarity =
      typeof p.similarity === "number" && Number.isFinite(p.similarity)
        ? Math.max(0, Math.min(1, p.similarity))
        : 0;
    let dupId: string | undefined;
    if (isDup) {
      const rawId = typeof p.dupId === "string" ? p.dupId : null;
      // Validate that the model's dupId actually appears in the pool.
      // Without this check a hallucinated id could land on the wall as
      // a dedup-group key and a future row pointing to the same id
      // would join a phantom group.
      if (rawId && pool.some((k) => k.id === rawId)) {
        dupId = rawId;
      }
    }
    return { isDup: isDup && !!dupId, dupId, similarity };
  } catch {
    return null;
  }
}

void useLlmStore;
