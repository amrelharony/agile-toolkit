/**
 * Per-category MCP rate-limit logic.
 *
 * `now` is injected so refill behaviour is deterministic (no fake timers).
 * __resetRateLimit() clears module state between cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  RATE_LIMITS,
  tryConsume,
  rateCategoryForAction,
  __resetRateLimit,
} from "@/lib/mcp/rate-limit";

beforeEach(() => __resetRateLimit());

const T0 = 1_000_000;

describe("RATE_LIMITS", () => {
  it("splits read / write / intent ceilings", () => {
    expect(RATE_LIMITS).toEqual({ read: 600, write: 120, intent: 30 });
  });
});

describe("rateCategoryForAction", () => {
  it("maps intent.* ids to the intent bucket", () => {
    expect(rateCategoryForAction({ id: "intent.run_retro", category: "write" })).toBe("intent");
    expect(rateCategoryForAction({ id: "x", toolId: "intent.plan", category: "read" })).toBe(
      "intent"
    );
  });
  it("maps write actions to write and everything else to read", () => {
    expect(rateCategoryForAction({ id: "tool.daci.set_status", category: "write" })).toBe("write");
    expect(rateCategoryForAction({ id: "tool.daci.list_state", category: "read" })).toBe("read");
    expect(rateCategoryForAction({ id: "x" })).toBe("read"); // no category → read
  });
});

describe("tryConsume — single category", () => {
  it("allows up to the category limit, then blocks", () => {
    const tok = "pat_a";
    // 120 writes allowed
    for (let i = 0; i < RATE_LIMITS.write; i++) {
      expect(tryConsume(tok, { write: 1 }, T0).ok).toBe(true);
    }
    const blocked = tryConsume(tok, { write: 1 }, T0);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.category).toBe("write");
      expect(blocked.limit).toBe(120);
    }
  });

  it("keeps categories independent (a maxed write bucket leaves reads intact)", () => {
    const tok = "pat_b";
    expect(tryConsume(tok, { write: RATE_LIMITS.write }, T0).ok).toBe(true);
    expect(tryConsume(tok, { write: 1 }, T0).ok).toBe(false);
    // reads untouched
    expect(tryConsume(tok, { read: 1 }, T0).ok).toBe(true);
  });

  it("keeps tokens independent (one PAT maxed doesn't affect another)", () => {
    expect(tryConsume("pat_x", { intent: RATE_LIMITS.intent }, T0).ok).toBe(true);
    expect(tryConsume("pat_x", { intent: 1 }, T0).ok).toBe(false);
    expect(tryConsume("pat_y", { intent: 1 }, T0).ok).toBe(true);
  });
});

describe("tryConsume — batch atomicity", () => {
  it("charges nothing when any one category is over its limit", () => {
    const tok = "pat_c";
    // A batch needing 1 read + 31 intents: intent (limit 30) is over.
    const res = tryConsume(tok, { read: 1, intent: 31 }, T0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.category).toBe("intent");
    // The read was NOT charged — full read budget remains.
    for (let i = 0; i < RATE_LIMITS.read; i++) {
      expect(tryConsume(tok, { read: 1 }, T0).ok).toBe(true);
    }
  });

  it("charges every category when the whole batch fits", () => {
    const tok = "pat_d";
    expect(tryConsume(tok, { read: 2, write: 2, intent: 2 }, T0).ok).toBe(true);
    // remaining: read 598, write 118, intent 28 → another 28 intents ok, 29th not
    for (let i = 0; i < 28; i++) expect(tryConsume(tok, { intent: 1 }, T0).ok).toBe(true);
    expect(tryConsume(tok, { intent: 1 }, T0).ok).toBe(false);
  });
});

describe("tryConsume — lazy refill", () => {
  it("fully refills after the window elapses", () => {
    const tok = "pat_e";
    expect(tryConsume(tok, { intent: RATE_LIMITS.intent }, T0).ok).toBe(true);
    expect(tryConsume(tok, { intent: 1 }, T0).ok).toBe(false);
    // 60s later → full refill
    expect(tryConsume(tok, { intent: RATE_LIMITS.intent }, T0 + 60_000).ok).toBe(true);
  });

  it("partially refills proportional to elapsed time", () => {
    const tok = "pat_f";
    // drain all 30 intents
    expect(tryConsume(tok, { intent: RATE_LIMITS.intent }, T0).ok).toBe(true);
    // half a window later → ~15 tokens back
    const half = T0 + 30_000;
    for (let i = 0; i < 15; i++) expect(tryConsume(tok, { intent: 1 }, half).ok).toBe(true);
    expect(tryConsume(tok, { intent: 1 }, half).ok).toBe(false);
  });

  it("banks fractional refill across consumes (no floor truncation)", () => {
    // Regression for the floored-refill starvation: every consume resets the
    // bucket's `updated` to `now`, so any sub-token refill earned between
    // consumes used to be truncated to 0 and lost forever. Two 150ms steps
    // each earn (150/60000)*600 = 1.5 read tokens; the 0.5 left after the
    // first consume MUST survive so the second step can serve a 2-read burst.
    const tok = "pat_burst";
    expect(tryConsume(tok, { read: RATE_LIMITS.read }, T0).ok).toBe(true); // drain → 0
    // Step 1 @ +150ms: refill 1.5, consume 1 → 0.5 banked.
    expect(tryConsume(tok, { read: 1 }, T0 + 150).ok).toBe(true);
    // Step 2 @ +300ms: refill 1.5 on top of the 0.5 bank = 2.0 available.
    // Under the old Math.floor logic only 1 token was available here, so a
    // 2-read burst failed; with fractional banking it now fits.
    expect(tryConsume(tok, { read: 2 }, T0 + 300).ok).toBe(true);
  });

  it("never lets a token exceed its per-category ceiling in a burst", () => {
    // Fractional refill must still cap at `max` — a long idle then a flood
    // cannot exceed the bucket size in one shot.
    const tok = "pat_cap";
    expect(tryConsume(tok, { intent: RATE_LIMITS.intent }, T0).ok).toBe(true);
    // Way past a full window: bucket is full (30), not more.
    expect(tryConsume(tok, { intent: RATE_LIMITS.intent }, T0 + 10 * 60_000).ok).toBe(true);
    expect(tryConsume(tok, { intent: 1 }, T0 + 10 * 60_000).ok).toBe(false);
  });
});
