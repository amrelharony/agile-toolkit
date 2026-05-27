"use client";

/**
 * LLM sentiment + tone classifier for an outbound kudos message.
 *
 * Called from `kudos-form.tsx` debounced 600 ms after the last keystroke.
 * The intent is purely advisory: a "backhanded" label surfaces a soft
 * inline warning the sender can ignore. The send button never blocks on
 * this — kudos is a social trust feature, and gating recognition behind
 * an LLM call would feel punitive.
 *
 * Necessarily reads the message body: classifying sarcasm without the
 * text is impossible. (Compare with `fairness.ts`, which deliberately
 * keeps message bodies out of its prompt.)
 *
 * Send-on-failure semantics: every failure path — no BYOK key, adapter
 * unavailable, JSON parse error, network — returns `null` so the caller
 * proceeds without stamping `sentiment` on the Kudos.
 */

import { getActiveConfig, useLlmStore } from "@/lib/stores/llm-store";
import { getAdapter } from "@/lib/llm/registry";
import type { KudosSentiment, KudosTheme } from "@/lib/stores/workspace-types";

/** Hard cap before the message is sent to the LLM — cost guard. */
const MESSAGE_CHAR_CAP = 1000;

/** Maximum tokens the model is allowed to return. The structured response
 *  is tiny (≤ 80 chars in practice) so 200 leaves slack for verbose
 *  models without burning tokens. */
const MAX_OUTPUT_TOKENS = 200;

interface AnalyseInput {
  message: string;
  theme: KudosTheme;
}

/**
 * Run sentiment classification. Returns the structured sentiment or
 * `null` when the call fails for any reason (no key, bad parse, network).
 *
 * Single-shot. No retry — sentiment is advisory and the form re-issues
 * on the next debounce window if the user keeps typing.
 */
export async function analyseSentiment(
  input: AnalyseInput,
  signal?: AbortSignal
): Promise<KudosSentiment | null> {
  const cfg = getActiveConfig();
  if (!cfg) return null;

  // Cost guard. Long messages get truncated at the head — sarcasm usually
  // lands early ("Thanks I guess for the half-baked review…") and the
  // tail is rarely informative for a 50-word-capped kudos anyway.
  const message = input.message.slice(0, MESSAGE_CHAR_CAP);
  const themeId = typeof input.theme === "string" ? input.theme : input.theme.id;

  const prompt = buildSentimentPrompt(message, themeId);

  try {
    const adapter = await getAdapter(cfg.provider);
    let accumulated = "";
    const controller = new AbortController();
    if (signal) {
      // Forward the outer signal so a re-typed keystroke cancels the
      // in-flight call. We own the controller so the adapter sees an
      // AbortSignal it can attach to fetch().
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
    return parseSentimentResponse(accumulated);
  } catch {
    // Send-on-failure: any error here is a no-op. The send still works.
    return null;
  }
}

function buildSentimentPrompt(message: string, themeId: string): string {
  // Wrap user content so a hostile message can't reframe the task.
  return [
    "Classify the sentiment of the kudos message below.",
    "",
    "Return ONLY a JSON object with these exact fields:",
    '  - label: one of "positive", "neutral", "backhanded"',
    "  - confidence: number between 0 and 1",
    '  - tone: array of 1-3 short lowercase tags (e.g. ["grateful", "warm"])',
    "",
    `Theme: ${themeId}`,
    "",
    "<message>",
    message,
    "</message>",
    "",
    "JSON:",
  ].join("\n");
}

/**
 * Tolerant JSON parser — strips markdown fences, trims, accepts trailing
 * whitespace. Returns `null` on any shape mismatch so the caller falls
 * through to the no-sentiment path.
 */
function parseSentimentResponse(raw: string): KudosSentiment | null {
  if (!raw) return null;
  // Strip ```json … ``` fences if a chatty model added them.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  // Find the first '{' so leading prose is tolerated.
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  // Find the LAST '}' so trailing prose is tolerated.
  const end = cleaned.lastIndexOf("}");
  if (end < start) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    const label = p.label;
    if (label !== "positive" && label !== "neutral" && label !== "backhanded") {
      return null;
    }
    const confidence =
      typeof p.confidence === "number" && Number.isFinite(p.confidence)
        ? Math.max(0, Math.min(1, p.confidence))
        : 0.5;
    const tone = Array.isArray(p.tone)
      ? p.tone
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.toLowerCase().trim())
          .filter((t) => t.length > 0 && t.length <= 24)
          .slice(0, 6)
      : [];
    return { label, confidence, tone };
  } catch {
    return null;
  }
}

// Touch the store import so a future tree-shake of `useLlmStore` (only
// `getActiveConfig` is reachable in this file) doesn't strip the module
// from the bundle entirely. The hook is used at app boot by the status
// chip; keeping it alive here is paranoid but cheap.
void useLlmStore;
