/**
 * The owner's tool AI limiter: check_tool_ai_rate_limit (migration 0040),
 * called through the owner's own Supabase client, so auth.uid() is the owner.
 * Kept apart from Amr's chat limit (check_chat_rate_limit).
 *
 * Fails closed: an error, a timeout or an answer of the wrong shape all come
 * back as null, and the route refuses (503 meter_unavailable) rather than
 * run unmetered.
 */

import "server-only";

export const OWNER_METER_TIMEOUT_MS = 2_500;

export interface OwnerMeterResult {
  allowed: boolean;
  daily: number;
  dailyMax: number;
  weekly: number;
  weeklyMax: number;
  monthly: number;
  monthlyMax: number;
  /** The usage row this call added (null when refused). */
  id: string | null;
}

/** The slice of a Supabase client this needs. */
export interface OwnerMeterClient {
  rpc(fn: string, args?: Record<string, unknown>): unknown;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The RPC's jsonb answer, or null when anything is off. */
export function parseOwnerMeterReply(data: unknown): OwnerMeterResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.allowed !== "boolean") return null;
  for (const key of ["daily", "daily_max", "weekly", "weekly_max", "monthly", "monthly_max"]) {
    if (!count(d[key])) return null;
  }
  return {
    allowed: d.allowed,
    daily: d.daily as number,
    dailyMax: d.daily_max as number,
    weekly: d.weekly as number,
    weeklyMax: d.weekly_max as number,
    monthly: d.monthly as number,
    monthlyMax: d.monthly_max as number,
    id: typeof d.id === "string" ? d.id : null,
  };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Check and count one tool AI use for the signed-in owner. null on any failure. */
export async function meterOwner(
  supabase: OwnerMeterClient,
  task: string,
  model: string,
  timeoutMs = OWNER_METER_TIMEOUT_MS
): Promise<OwnerMeterResult | null> {
  return withTimeout(
    (async () => {
      const reply = (await (supabase.rpc("check_tool_ai_rate_limit", {
        p_task: task.slice(0, 80),
        p_model: model.slice(0, 80),
      }) as PromiseLike<{ data?: unknown; error?: unknown } | null>)) as
        | { data?: unknown; error?: unknown }
        | null
        | undefined;
      if (!reply || reply.error) return null;
      return parseOwnerMeterReply(reply.data);
    })(),
    timeoutMs
  );
}

/**
 * Attach the token counts to the usage row (best effort; a failure changes
 * nothing for the person).
 */
export async function recordOwnerTokens(
  supabase: OwnerMeterClient,
  id: string,
  tokensIn: number,
  tokensOut: number,
  timeoutMs = OWNER_METER_TIMEOUT_MS
): Promise<void> {
  await withTimeout(
    (async () => {
      await (supabase.rpc("record_tool_ai_tokens", {
        p_id: id,
        p_tokens_in: Math.max(0, Math.round(tokensIn)),
        p_tokens_out: Math.max(0, Math.round(tokensOut)),
      }) as PromiseLike<unknown>);
      return null;
    })(),
    timeoutMs
  );
}
