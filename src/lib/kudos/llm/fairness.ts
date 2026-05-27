"use client";

/**
 * LLM fairness scorer — surfaces under-recognised teammates.
 *
 * Inputs are REDACTED by design:
 *   - `squadProfiles` carries only id + displayName
 *   - `recentKudos` carries who-sent-to-whom + theme + length + sentAt;
 *     the message body is INTENTIONALLY omitted. Fairness is about
 *     volume distribution, not content critique — including bodies
 *     would leak private recognition wording into the BYOK prompt
 *     stream for no gain.
 *   - `recentSignals` is the last 14 days of impediment.resolved /
 *     story.statusChanged-to-done / decision.recorded — coarse activity
 *     signal so the model can flag people who shipped work without
 *     getting cards in return.
 *
 * Cached for 1 h via `deriveCached` keyed on a stable hash of the inputs.
 * The cache is owner-side only; guests never call this (they don't have
 * the history context anyway). `installFairnessInvalidator()` wires
 * `kudos.sent` to flush the cache so a fresh send re-runs the analysis
 * on the next consumer read.
 *
 * Send-on-failure: every failure path returns `null`. The UI degrades to
 * "no fairness suggestions right now".
 */

import { getActiveConfig, useLlmStore } from "@/lib/stores/llm-store";
import { getAdapter } from "@/lib/llm/registry";
import { deriveCached, invalidateDerivedCache } from "@/lib/signals/derived-cache";
import { subscribeSignals } from "@/lib/signals/signal-bus";

const FAIRNESS_CACHE_PREFIX = "fairness:kudos";
const FAIRNESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_OUTPUT_TOKENS = 600;

export interface FairnessProfile {
  id: string;
  displayName: string;
}

/** Redacted kudos record — explicitly NO message body. */
export interface FairnessKudosRecord {
  toProfileId: string;
  fromProfileId?: string;
  /** Theme id (string) or custom theme id string — never the object. */
  theme: string;
  sentAt: string;
  messageLength: number;
}

export interface FairnessSignalRecord {
  /** "impediment.resolved" | "story.statusChanged" | "decision.recorded" */
  kind: string;
  /** Squad profile id of the actor when known. */
  profileId?: string;
  at: string;
}

export interface UnderRecognised {
  profileId: string;
  /** 0..1 — higher means more under-recognised relative to peers. */
  score: number;
  /** One-sentence rationale. Shown verbatim in the inline form hint. */
  reason: string;
}

export interface FairnessResult {
  underRecognised: UnderRecognised[];
}

interface FairnessInput {
  squadProfiles: FairnessProfile[];
  recentKudos: FairnessKudosRecord[];
  recentSignals: FairnessSignalRecord[];
}

/**
 * Pending result registry — `deriveCached` is synchronous, so the cache
 * stores the Promise from the in-flight LLM call. Subsequent readers
 * within the TTL window get the SAME promise, so we never fire two
 * parallel calls for the same input shape (a common race when the form
 * mounts and the beacon mounts at near-identical times).
 */
function cachedCall(input: FairnessInput): Promise<FairnessResult | null> {
  // Cache key MUST be JSON-stable. The fields are all primitives, so a
  // straight JSON.stringify by `deriveCached` produces a stable hash.
  const deps: unknown[] = [input];
  return deriveCached(FAIRNESS_CACHE_PREFIX, deps, () => runFairnessCall(input), FAIRNESS_TTL_MS);
}

/**
 * Compute under-recognised teammates. The actual LLM call is wrapped in
 * a 1 h cache; repeated calls with identical inputs within that window
 * return the same Promise without re-billing the BYOK key.
 */
export async function computeFairness(
  input: FairnessInput,
  signal?: AbortSignal
): Promise<FairnessResult | null> {
  // No squad → nothing to compare.
  if (input.squadProfiles.length === 0) return { underRecognised: [] };
  // Forward the abort to the running call only via a wrapper Promise.
  // The cached Promise itself can't be aborted (multiple readers share
  // it), so the wrapper just bails early if THIS caller's signal trips.
  const pending = cachedCall(input);
  if (!signal) return pending;
  return new Promise<FairnessResult | null>((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pending
      .then((value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      });
  });
}

async function runFairnessCall(input: FairnessInput): Promise<FairnessResult | null> {
  const cfg = getActiveConfig();
  if (!cfg) return null;

  const prompt = buildFairnessPrompt(input);

  try {
    const adapter = await getAdapter(cfg.provider);
    let accumulated = "";
    const controller = new AbortController();
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
    const result = parseFairnessResponse(accumulated, input.squadProfiles);
    // Stash the snapshot so the AI-prompt template + emit handlers can
    // read it without awaiting another call. Cleared on invalidation.
    if (result) lastResultSnapshot = result;
    return result;
  } catch {
    return null;
  }
}

function buildFairnessPrompt(input: FairnessInput): string {
  // Aggregate to keep the prompt small. The model doesn't need the raw
  // rows — it needs the counts per recipient + recent activity per
  // person. Counts are tabular so the model latches onto the structure.
  const receivedByProfile = new Map<string, number>();
  const sentByProfile = new Map<string, number>();
  for (const k of input.recentKudos) {
    receivedByProfile.set(k.toProfileId, (receivedByProfile.get(k.toProfileId) ?? 0) + 1);
    if (k.fromProfileId) {
      sentByProfile.set(k.fromProfileId, (sentByProfile.get(k.fromProfileId) ?? 0) + 1);
    }
  }
  const activityByProfile = new Map<string, number>();
  for (const s of input.recentSignals) {
    if (!s.profileId) continue;
    activityByProfile.set(s.profileId, (activityByProfile.get(s.profileId) ?? 0) + 1);
  }

  const table = input.squadProfiles
    .map((p) => {
      const recv = receivedByProfile.get(p.id) ?? 0;
      const sent = sentByProfile.get(p.id) ?? 0;
      const act = activityByProfile.get(p.id) ?? 0;
      // Sanitize displayName to a safe inline token. The model never
      // sees free-form names so a hostile display name can't reframe.
      const name = p.displayName.replace(/[|\n\r]/g, " ").slice(0, 48);
      return `| ${p.id} | ${name} | ${recv} | ${sent} | ${act} |`;
    })
    .join("\n");

  return [
    "You are looking at a 30-day recognition snapshot for one squad.",
    "Identify up to 3 teammates who are under-recognised — meaning they",
    "have visible recent activity but few or no kudos received relative",
    "to peers.",
    "",
    "Each row of the table is a teammate:",
    "  - profileId: stable identifier",
    "  - name: display label",
    "  - received: kudos cards received in the last 30 days",
    "  - sent: kudos cards sent by this teammate in the last 30 days",
    "  - activity: count of impediment.resolved / story-done / decision-recorded signals in the last 14 days",
    "",
    "| profileId | name | received | sent | activity |",
    "| --- | --- | --- | --- | --- |",
    table,
    "",
    "Return ONLY a JSON object with this exact shape:",
    "  {",
    '    "underRecognised": [',
    '      { "profileId": "...", "score": 0.0-1.0, "reason": "one short sentence" }',
    "    ]",
    "  }",
    "",
    "Empty array is a valid answer if nobody stands out.",
    "JSON:",
  ].join("\n");
}

function parseFairnessResponse(raw: string, profiles: FairnessProfile[]): FairnessResult | null {
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
    const rows = Array.isArray(p.underRecognised) ? p.underRecognised : [];
    const validIds = new Set(profiles.map((x) => x.id));
    const underRecognised: UnderRecognised[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const profileId = typeof r.profileId === "string" ? r.profileId : null;
      // Reject hallucinated ids — the model occasionally invents profile
      // ids that don't exist in the table.
      if (!profileId || !validIds.has(profileId)) continue;
      const scoreRaw = typeof r.score === "number" ? r.score : 0;
      const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, scoreRaw)) : 0;
      const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 240) : "";
      underRecognised.push({ profileId, score, reason });
      if (underRecognised.length >= 3) break;
    }
    return { underRecognised };
  } catch {
    return null;
  }
}

/**
 * Manual cache flush. Called from `installFairnessInvalidator()` on
 * `kudos.sent` so the next consumer recomputes — a fresh send shifts
 * the recognition distribution and the cached result becomes stale.
 */
export function invalidateFairnessCache(): void {
  invalidateDerivedCache(FAIRNESS_CACHE_PREFIX);
  lastResultSnapshot = null;
}

/**
 * Snapshot of the most-recent successful fairness result. Populated
 * whenever `computeFairness` lands; cleared by `invalidateFairnessCache`.
 * Synchronous so AI-prompt template authors can reference it without
 * awaiting a Promise (templates are pure-string today and we don't want
 * to make them async).
 *
 * Returns `null` when no result has landed in the current cache window.
 */
let lastResultSnapshot: FairnessResult | null = null;

export function getLastFairnessResult(): FairnessResult | null {
  return lastResultSnapshot;
}

export function __setLastFairnessResultForTests(value: FairnessResult | null): void {
  lastResultSnapshot = value;
}

let invalidatorInstalled = false;
let invalidatorUnsub: (() => void) | null = null;

/**
 * Subscribe `kudos.sent` to the cache invalidator. Idempotent — calling
 * twice is a no-op so the kudos-client can install on mount without
 * worrying about double-install on fast remount.
 */
export function installFairnessInvalidator(): () => void {
  if (invalidatorInstalled) {
    return () => {
      /* already installed — return a no-op so the caller doesn't have
         to special-case the second call's return value. */
    };
  }
  invalidatorInstalled = true;
  invalidatorUnsub = subscribeSignals(["kudos.sent"], () => {
    invalidateFairnessCache();
  });
  return () => {
    invalidatorInstalled = false;
    invalidatorUnsub?.();
    invalidatorUnsub = null;
  };
}

/** Test-only — reset the install latch so tests can re-install. */
export function __resetFairnessInvalidator(): void {
  invalidatorInstalled = false;
  invalidatorUnsub?.();
  invalidatorUnsub = null;
  invalidateFairnessCache();
  lastResultSnapshot = null;
}

void useLlmStore;
