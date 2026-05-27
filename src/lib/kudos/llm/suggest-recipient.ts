"use client";

/**
 * LLM recipient suggester for the kudos form.
 *
 * Input is a redacted view of the last 7 days of history events —
 * `{toolId, action, payload-summary, occurredAt, squadProfileId?}` —
 * so the model can see "Alice resolved 3 impediments and shipped 2
 * stories this week" without us shipping any raw kudos message bodies
 * (the fairness module already enforces that boundary; we preserve it
 * here for consistency).
 *
 * Output is a list of suggested recipients with reasoning. The TOP
 * suggestion drives the form's smart-default via `usePredictedDefault`.
 *
 * Predictor-registry shape: `usePredictedDefault` calls a SYNCHRONOUS
 * function. We register a sync predictor that reads from this module's
 * local cache. The actual LLM call is async and kicked off by the form
 * imperatively (`primeRecipientSuggestion`) — once it lands, the cache
 * holds the result and the next predictor read returns it. The form
 * re-renders when the predictor closure changes, so the smart default
 * lights up as soon as the suggestion lands.
 *
 * Send-on-failure: every error path returns null/empty. The form's
 * `usePredictedDefault` then yields `confidence: "none"` and falls back
 * to the existing first-recipient auto-pick.
 */

import { getActiveConfig, useLlmStore } from "@/lib/stores/llm-store";
import { getAdapter } from "@/lib/llm/registry";
import { registerPredictor, type PredictResult } from "@/lib/predictions/registry";

const MAX_OUTPUT_TOKENS = 500;
const HISTORY_EVENT_CAP = 80;
const PAYLOAD_SUMMARY_CHAR_CAP = 120;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface RecipientSuggestion {
  profileId: string;
  reason: string;
  sourceEventIds: string[];
}

export interface RecipientSuggestionResult {
  suggestions: RecipientSuggestion[];
}

/** Redacted view of a history event. The form's caller builds this from
 *  the full HistoryEvent to keep payload bodies out of the LLM prompt. */
export interface RedactedHistoryEvent {
  id: string;
  toolId: string;
  action: string;
  /** Free-text summary of the payload — ≤ 120 chars. Caller's responsibility
   *  to redact PII / secrets before passing in. */
  payloadSummary: string;
  occurredAt: string;
  squadProfileId?: string | null;
}

export interface SuggestRecipientInput {
  recentHistoryEvents: RedactedHistoryEvent[];
  squadProfiles: { id: string; displayName: string }[];
}

interface CacheEntry {
  /** Stable hash of the input shape, computed by `hashInput`. */
  key: string;
  result: RecipientSuggestionResult;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

function hashInput(input: SuggestRecipientInput): string {
  // Cheap deterministic hash over the input. Same inputs → same hash, so a
  // second `primeRecipientSuggestion` with unchanged context reuses the
  // cached result without re-billing the BYOK key.
  const json = JSON.stringify({
    p: input.squadProfiles.map((p) => [p.id, p.displayName]),
    h: input.recentHistoryEvents.map((e) => [
      e.id,
      e.toolId,
      e.action,
      e.payloadSummary,
      e.occurredAt,
      e.squadProfileId ?? null,
    ]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export async function suggestRecipients(
  input: SuggestRecipientInput,
  signal?: AbortSignal
): Promise<RecipientSuggestionResult | null> {
  const cfg = getActiveConfig();
  if (!cfg) return null;
  if (input.squadProfiles.length === 0) {
    return { suggestions: [] };
  }

  const key = hashInput(input);
  if (cache && cache.key === key && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  const prompt = buildSuggestPrompt(input);

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
          "You are an analyst. Reply with ONLY the requested JSON object — no prose, no markdown fences.",
        signal: controller.signal,
        onChunk: (chunk) => {
          accumulated += chunk;
        },
      },
      { apiKey: cfg.apiKey, model: cfg.model },
      MAX_OUTPUT_TOKENS
    );
    const result = parseSuggestResponse(accumulated, input);
    if (result) {
      cache = { key, result, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return result;
  } catch {
    return null;
  }
}

function buildSuggestPrompt(input: SuggestRecipientInput): string {
  const events = input.recentHistoryEvents.slice(-HISTORY_EVENT_CAP);
  const profilesTable = input.squadProfiles
    .map((p) => {
      const name = p.displayName.replace(/[|\n\r]/g, " ").slice(0, 48);
      return `| ${p.id} | ${name} |`;
    })
    .join("\n");
  const eventsTable = events
    .map((e) => {
      const summary = e.payloadSummary.replace(/[|\n\r]/g, " ").slice(0, PAYLOAD_SUMMARY_CHAR_CAP);
      const prof = e.squadProfileId ?? "—";
      return `| ${e.id} | ${e.toolId} | ${e.action} | ${prof} | ${e.occurredAt} | ${summary} |`;
    })
    .join("\n");
  return [
    "Suggest up to 3 teammates the sender should consider sending a kudos to,",
    "based on the last 7 days of activity. Pick recipients whose actions stood",
    "out — shipped work, resolved blockers, made a decision the team relies on.",
    "",
    "## Squad profiles",
    "| profileId | name |",
    "| --- | --- |",
    profilesTable,
    "",
    "## Recent history events (most recent last)",
    "| id | toolId | action | squadProfileId | occurredAt | payloadSummary |",
    "| --- | --- | --- | --- | --- | --- |",
    eventsTable,
    "",
    "Return ONLY a JSON object with this exact shape:",
    "  {",
    '    "suggestions": [',
    '      { "profileId": "...", "reason": "one short sentence", "sourceEventIds": ["..."] }',
    "    ]",
    "  }",
    "",
    "If no event clearly merits recognition, return an empty array.",
    "JSON:",
  ].join("\n");
}

function parseSuggestResponse(
  raw: string,
  input: SuggestRecipientInput
): RecipientSuggestionResult | null {
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
    const rows = Array.isArray(p.suggestions) ? p.suggestions : [];
    const validProfileIds = new Set(input.squadProfiles.map((x) => x.id));
    const validEventIds = new Set(input.recentHistoryEvents.map((x) => x.id));
    const suggestions: RecipientSuggestion[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const profileId = typeof r.profileId === "string" ? r.profileId : null;
      // Drop hallucinated profile ids.
      if (!profileId || !validProfileIds.has(profileId)) continue;
      const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 240) : "";
      const sourceEventIds = Array.isArray(r.sourceEventIds)
        ? r.sourceEventIds
            .filter((x): x is string => typeof x === "string")
            // Drop hallucinated event ids so the UI can hyperlink with confidence.
            .filter((id) => validEventIds.has(id))
            .slice(0, 8)
        : [];
      suggestions.push({ profileId, reason, sourceEventIds });
      if (suggestions.length >= 3) break;
    }
    return { suggestions };
  } catch {
    return null;
  }
}

/**
 * Kick off the async suggestion. Form callers do this on mount; the
 * promise's settle populates the local cache so the registered predictor
 * starts returning the top suggestion. Subsequent `usePredictedDefault`
 * reads pick it up automatically because the hook subscribes to history
 * events (predictor re-runs on history change).
 */
export async function primeRecipientSuggestion(
  input: SuggestRecipientInput,
  signal?: AbortSignal
): Promise<RecipientSuggestionResult | null> {
  return suggestRecipients(input, signal);
}

/** Read the cached top suggestion. Synchronous — safe to call from a
 *  predictor. Returns null when the cache is empty or expired. */
export function getCachedTopSuggestion(): RecipientSuggestion | null {
  if (!cache || cache.expiresAt <= Date.now()) return null;
  return cache.result.suggestions[0] ?? null;
}

let predictorRegistered = false;

/**
 * Register the kudos recipient predictor. Idempotent. Called from
 * `src/lib/predictions/bootstrap.ts` at app boot.
 *
 * The predictor is synchronous (the contract `Predictor<T>` requires it),
 * so it reads the local cache instead of issuing its own LLM call. Form
 * callers prime the cache by invoking `primeRecipientSuggestion` on
 * mount; when the result lands the predictor's next invocation returns
 * the top suggestion's profile id.
 */
export function registerRecipientPredictor(): void {
  if (predictorRegistered) return;
  predictorRegistered = true;
  registerPredictor<string>("kudos", "recipient", (): PredictResult<string> => {
    const top = getCachedTopSuggestion();
    if (!top) return { value: "", confidence: "none" };
    return {
      value: top.profileId,
      confidence: "medium",
      source: top.reason || "LLM activity-based suggestion",
    };
  });
}

/** Test-only — clear the cache + reset the registration latch. */
export function __resetRecipientSuggestionCache(): void {
  cache = null;
  predictorRegistered = false;
}

void useLlmStore;
