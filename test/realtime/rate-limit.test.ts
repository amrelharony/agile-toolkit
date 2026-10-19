import { describe, it, expect } from "vitest";
import { createInboundLimiter, type InboundLimitConfig } from "@/lib/realtime/rate-limit";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";

const config: InboundLimitConfig = {
  perSender: { capacity: 3, refillPerSec: 1 },
  perEvent: { capacity: 5, refillPerSec: 2 },
  maxSenders: 4,
};

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function count(fn: () => boolean, times: number): number {
  let n = 0;
  for (let i = 0; i < times; i++) if (fn()) n++;
  return n;
}

describe("createInboundLimiter", () => {
  it("lets a sender burst up to its bucket, then drops the rest", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    expect(count(() => limiter.allow("a", "e"), 10)).toBe(3);
  });

  it("refills a sender's bucket over time, never past capacity", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    count(() => limiter.allow("a", "e"), 3);
    c.advance(1000);
    expect(count(() => limiter.allow("a", "e"), 10)).toBe(1);
    c.advance(60_000);
    expect(count(() => limiter.allow("a", "e"), 10)).toBe(3);
  });

  it("shares one sender's bucket across events", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    expect(limiter.allow("a", "x")).toBe(true);
    expect(limiter.allow("a", "y")).toBe(true);
    expect(limiter.allow("a", "z")).toBe(true);
    expect(limiter.allow("a", "w")).toBe(false);
  });

  it("caps an event across senders, so rotating ids doesn't help", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    expect(count(() => limiter.allow(`id-${Math.random()}`, "e"), 50)).toBe(5);
    // Another event still has its own budget.
    expect(limiter.allow("fresh", "other")).toBe(true);
  });

  it("doesn't spend the shared budget on a sender that is over its own limit", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    count(() => limiter.allow("spammer", "e"), 100);
    // The spammer got 3; the other 2 event tokens are still there for others.
    expect(count(() => limiter.allow("b", "e"), 10)).toBe(2);
  });

  it("doesn't spend a sender's token when the event budget is empty", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    // p takes 3 of the event's 5 tokens and q the last 2, so "e" is empty.
    for (const s of ["p", "q"]) count(() => limiter.allow(s, "e"), 3);
    expect(limiter.allow("r", "e")).toBe(false);
    expect(limiter.allow("r", "other")).toBe(true);
    expect(limiter.allow("r", "other")).toBe(true);
    expect(limiter.allow("r", "other")).toBe(true);
    expect(limiter.allow("r", "other")).toBe(false);
  });

  it("bounds the senders it remembers", () => {
    const c = clock();
    const limiter = createInboundLimiter(
      { ...config, perEvent: { capacity: 1000, refillPerSec: 0 } },
      c.now
    );
    count(() => limiter.allow("a", "e"), 3);
    expect(limiter.allow("a", "e")).toBe(false);
    // Four other senders push "a" out of the 4-entry table...
    for (const s of ["b", "c", "d", "f"]) limiter.allow(s, "e");
    // ...so it starts over with a full bucket (the per-event budget still applies).
    expect(limiter.allow("a", "e")).toBe(true);
  });

  it("reset forgets every bucket", () => {
    const c = clock();
    const limiter = createInboundLimiter(config, c.now);
    count(() => limiter.allow("a", "e"), 10);
    limiter.reset();
    expect(limiter.allow("a", "e")).toBe(true);
  });

  it("ignores a clock that goes backwards", () => {
    const c = clock(10_000);
    const limiter = createInboundLimiter(config, c.now);
    count(() => limiter.allow("a", "e"), 3);
    c.advance(-5_000);
    expect(limiter.allow("a", "e")).toBe(false);
  });

  it("visitor defaults let a host's 2/s state stream through", () => {
    const c = clock();
    const limiter = createInboundLimiter(VISITOR_LIMITS.inbound, c.now);
    let ok = 0;
    for (let i = 0; i < 120; i++) {
      if (limiter.allow("host", "retro:state")) ok++;
      c.advance(500);
    }
    expect(ok).toBe(120);
  });
});
