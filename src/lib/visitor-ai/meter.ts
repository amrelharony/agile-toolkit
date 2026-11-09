/**
 * One call to the visitor AI meter, visitor_ai_meter (migration 0037), which
 * checks the limits in visitor_ai_config and counts the request.
 *
 * Fails closed: an error, a timeout or an answer of the wrong shape all come
 * back as null, and the route refuses the request rather than run it
 * unmetered. Nothing about the visitor is logged here.
 */

import "server-only";
import type { VisitorErrorCode } from "./contract";

/** How long the meter may take before the route gives up and refuses. */
export const METER_TIMEOUT_MS = 2_500;

/** The refusals the meter itself gives. */
export type MeterRefusal = Extract<
  VisitorErrorCode,
  | "disabled"
  | "visitor_limit"
  | "visitor_peak_limit"
  | "site_limit"
  | "site_peak_limit"
  | "site_busy"
>;

const REFUSALS: ReadonlySet<string> = new Set<MeterRefusal>([
  "disabled",
  "visitor_limit",
  "visitor_peak_limit",
  "site_limit",
  "site_peak_limit",
  "site_busy",
]);

export type ReasoningEffort = "low" | "high" | "max";
const EFFORTS: ReadonlySet<string> = new Set<ReasoningEffort>(["low", "high", "max"]);

export interface MeterResult {
  allowed: boolean;
  /** Why it was refused; null when allowed. */
  reason: MeterRefusal | null;
  /** This visitor's messages today, this one included when it was counted. */
  turnsUsed: number;
  turnsMax: number;
  /** Z.AI's peak window is on. */
  peak: boolean;
  /** This visitor's messages in the peak window today. */
  peakTurnsUsed: number;
  peakTurnsMax: number;
  /** When the current peak window ends (ISO 8601), or null outside it. */
  peakEndsAt: string | null;
  /** The reasoning effort to ask the model for. */
  reasoningEffort: ReasoningEffort;
}

/** The slice of a Supabase client this needs, so tests can hand in a one-line fake. */
export interface MeterClient {
  rpc(fn: string, args: Record<string, unknown>): unknown;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The RPC's jsonb answer as a MeterResult, or null when anything is off. */
export function parseMeterReply(data: unknown): MeterResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.allowed !== "boolean" || typeof d.peak !== "boolean") return null;
  const reason = d.reason ?? null;
  if (d.allowed ? reason !== null : typeof reason !== "string" || !REFUSALS.has(reason)) {
    return null;
  }
  if (
    !count(d.turns_used) ||
    !count(d.turns_max) ||
    !count(d.peak_turns_used) ||
    !count(d.peak_turns_max)
  ) {
    return null;
  }
  if (typeof d.reasoning_effort !== "string" || !EFFORTS.has(d.reasoning_effort)) return null;
  let peakEndsAt: string | null = null;
  if (d.peak_ends_at !== null && d.peak_ends_at !== undefined) {
    if (typeof d.peak_ends_at !== "string") return null;
    const ms = Date.parse(d.peak_ends_at);
    if (!Number.isFinite(ms)) return null;
    peakEndsAt = new Date(ms).toISOString();
  }
  return {
    allowed: d.allowed,
    reason: reason as MeterRefusal | null,
    turnsUsed: d.turns_used,
    turnsMax: d.turns_max,
    peak: d.peak,
    peakTurnsUsed: d.peak_turns_used,
    peakTurnsMax: d.peak_turns_max,
    peakEndsAt: d.peak ? peakEndsAt : null,
    reasoningEffort: d.reasoning_effort as ReasoningEffort,
  };
}

/**
 * Check and count one request for the visitor `key` (from visitorKey).
 * `newTurn` is true when the request starts with a new visitor message; every
 * request counts as a call. null on any failure, within `timeoutMs`.
 */
export async function meterVisitor(
  admin: MeterClient,
  key: string,
  newTurn: boolean,
  timeoutMs = METER_TIMEOUT_MS
): Promise<MeterResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const call = async (): Promise<MeterResult | null> => {
      const query = admin.rpc("visitor_ai_meter", { p_visitor: key, p_new_turn: newTurn }) as
        | (PromiseLike<{ data: unknown; error: unknown }> & {
            abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
          })
        | null
        | undefined;
      if (!query || typeof query.then !== "function") return null;
      // supabase-js can cancel the HTTP request itself; the race below is the
      // guarantee either way.
      const pending =
        typeof query.abortSignal === "function"
          ? query.abortSignal(AbortSignal.timeout(timeoutMs))
          : query;
      const reply = (await pending) as { data?: unknown; error?: unknown } | null | undefined;
      if (!reply || reply.error) return null;
      return parseMeterReply(reply.data);
    };
    return await Promise.race([call().catch(() => null), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
