"use client";

/**
 * The owner's usage in Amr's panel (design 1.2 "Usage"; audit rate-limit-bar):
 * owner-agent-panel renders it in its status row under the header, and it
 * waits while the panel is compact (a phone's keyboard up). The snapshot is
 * the one the client reads off the stream route's X-RateLimit-* headers, and
 * peek_chat_usage on every open (a read: it spends nothing). Three rolling
 * windows count Amr's requests: the last 24 hours, 7 days and 30 days
 * (migrations 0020, 0021); the one shown is the fullest, and once a cap is
 * hit, the one that is full, by name.
 *
 *   under 75%   quiet words in the muted colour: that window's count in
 *               words and the last reply's tokens. No bar, no box: the
 *               owner needs the numbers only near the cap
 *   75% or more a narration caption with a meter (role="meter", its values,
 *   or capped    and aria-valuetext in words), the same words in sight, an
 *               inked bar, and the last reply's tokens, in sight too (no
 *               tooltip). A capped window adds its name ("Weekly limit
 *               reached."), the danger line and when room comes back
 *
 * The bar: an inked track (the card's paper in a --border line) and an
 * accent fill, the danger colour from 90% or when capped; both read at 3:1
 * on the track (test/design/theme-contrast.test.ts). Forced colours keep it:
 * a Highlight fill on a Canvas track in a CanvasText line. It changes width
 * with the data motion tokens, and not at all under reduced motion.
 *
 * Owner only, inside the owner's chunk.
 */

import { useEffect } from "react";
import { Narration } from "@/components/agent/comic/comic-parts";
import { fetchChatUsage } from "@/lib/agent/persist";
import { useAgentStore, type RateLimitInfo } from "@/lib/agent/store";
import { cn } from "@/lib/utils";

/** From this share of the fullest window the usage is a meter, not quiet words. */
export const METER_FROM = 0.75;
/** From this share the fill takes the danger colour. */
const DANGER_FROM = 0.9;

export type UsageWindowKey = "daily" | "weekly" | "monthly";

/** One rolling window's count. */
export interface UsageWindow {
  key: UsageWindowKey;
  used: number;
  max: number;
}

/** Each window in words: the span it counts, its cap's name, how long a request counts. */
const WINDOW_WORDS: Record<UsageWindowKey, { span: string; cap: string; rolling: string }> = {
  daily: { span: "the last 24 hours", cap: "Daily", rolling: "24 hours" },
  weekly: { span: "the last 7 days", cap: "Weekly", rolling: "7 days" },
  monthly: { span: "the last 30 days", cap: "Monthly", rolling: "30 days" },
};

const count = (n: number) => n.toLocaleString("en-US");

/**
 * The window to show: once capped, the first that is full (the cause);
 * otherwise the fullest, the shorter one on a tie. Null when no window has a
 * cap to count against.
 */
export function usageWindow(rl: RateLimitInfo): UsageWindow | null {
  const windows: UsageWindow[] = [
    { key: "daily", used: rl.dailyUsed, max: rl.dailyMax },
    { key: "weekly", used: rl.weeklyUsed, max: rl.weeklyMax },
    { key: "monthly", used: rl.monthlyUsed, max: rl.monthlyMax },
  ].filter((w): w is UsageWindow => w.max > 0);
  if (rl.limited) {
    const full = windows.find((w) => w.used >= w.max);
    if (full) return full;
  }
  let fullest: UsageWindow | null = null;
  for (const w of windows) {
    if (!fullest || w.used / w.max > fullest.used / fullest.max) fullest = w;
  }
  return fullest;
}

/** A window's count in words: "160 of 200 requests used in the last 24 hours". */
export const usageWords = (w: UsageWindow) =>
  `${count(w.used)} of ${count(w.max)} request${w.max === 1 ? "" : "s"} used in ${WINDOW_WORDS[w.key].span}`;

/** A capped window, by name: "Weekly limit reached." */
export const limitReached = (key: UsageWindowKey) => `${WINDOW_WORDS[key].cap} limit reached.`;

/** When room comes back in a capped window. */
export const freesUp = (key: UsageWindowKey) =>
  `It frees up over a rolling ${WINDOW_WORDS[key].rolling}.`;

/** The last reply's spend: "Last reply: 1,234 tokens". */
export const lastReplyTokens = (n: number) => `Last reply: ${count(n)} token${n === 1 ? "" : "s"}`;

/** The meter's name. */
export const USAGE_LABEL = "Amr's usage";

export function RateLimitBar() {
  const rl = useAgentStore((s) => s.rateLimit);
  const lastTokens = useAgentStore((s) => s.lastTurnTokens);
  const setRateLimit = useAgentStore((s) => s.setRateLimit);

  // This only mounts while the panel is open, so refreshing on mount keeps the
  // count live: it shows on the first open (not only after a send) and
  // re-syncs on every reopen. Read-only: peek_chat_usage spends no turn.
  useEffect(() => {
    let alive = true;
    void fetchChatUsage().then((u) => {
      if (alive && u) setRateLimit(u);
    });
    return () => {
      alive = false;
    };
  }, [setRateLimit]);

  const w = rl && usageWindow(rl);
  if (!rl || !w) return null;

  const share = Math.min(1, w.used / w.max);
  const words = usageWords(w);
  const tokens = lastTokens != null ? lastReplyTokens(lastTokens) : null;
  const capped = rl.limited;

  if (!capped && share < METER_FROM) {
    return (
      <p data-testid="rate-limit-bar" data-usage="quiet" className="px-4 pt-1.5 text-xs text-sub">
        {words}
        {tokens && ` · ${tokens}`}
      </p>
    );
  }

  const danger = capped || share >= DANGER_FROM;
  return (
    <div data-testid="rate-limit-bar" data-usage="meter" className="px-3 pt-2">
      <Narration tone={capped ? "error" : "note"} label={capped ? limitReached(w.key) : undefined}>
        {/* A meter's insides are not read out: aria-valuetext says the same words. */}
        <span
          role="meter"
          aria-label={USAGE_LABEL}
          aria-valuemin={0}
          aria-valuemax={w.max}
          aria-valuenow={Math.min(w.used, w.max)}
          aria-valuetext={words}
          className="block"
        >
          <span className="block">{words}</span>
          <span
            data-usage-track=""
            className="mt-1.5 block h-2 overflow-hidden rounded-full border border-border bg-card forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Canvas] forced-colors:forced-color-adjust-none"
          >
            <span
              data-usage-fill=""
              className={cn(
                "block h-full rounded-full transition-[width] duration-data ease-calm motion-reduce:transition-none forced-colors:bg-[color:Highlight]",
                danger ? "bg-destructive" : "bg-accent"
              )}
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </span>
        </span>
        {capped && <span className="mt-1 block">{freesUp(w.key)}</span>}
        {tokens && <span className="mt-1 block text-xs text-sub">{tokens}</span>}
      </Narration>
    </div>
  );
}
