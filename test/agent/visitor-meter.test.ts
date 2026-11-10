// @vitest-environment node
/**
 * meterVisitor: one call to visitor_ai_meter. Any error, timeout or answer of
 * the wrong shape is null, so the route refuses (fails closed).
 */

import { describe, expect, it, vi } from "vitest";
import { meterVisitor, parseMeterReply } from "@/lib/visitor-ai/meter";

const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

function reply(over: Record<string, unknown> = {}) {
  return {
    allowed: true,
    reason: null,
    turns_used: 3,
    turns_max: 100,
    peak: false,
    peak_turns_used: 0,
    peak_turns_max: 25,
    peak_ends_at: null,
    reasoning_effort: "high",
    ...over,
  };
}

describe("meterVisitor", () => {
  it("calls the RPC with the code and whether this is a new turn", async () => {
    const rpc = vi.fn(async () => ({ data: reply(), error: null }));
    const result = await meterVisitor({ rpc }, KEY, false);
    expect(rpc).toHaveBeenCalledWith("visitor_ai_meter", { p_visitor: KEY, p_new_turn: false });
    expect(result).toEqual({
      allowed: true,
      reason: null,
      turnsUsed: 3,
      turnsMax: 100,
      peak: false,
      peakTurnsUsed: 0,
      peakTurnsMax: 25,
      peakEndsAt: null,
      reasoningEffort: "high",
    });
  });

  it("hands supabase-js an abort signal when the builder takes one", async () => {
    const abortSignal = vi.fn(async () => ({ data: reply(), error: null }));
    const builder = Object.assign(Promise.resolve({ data: null, error: "unused" }), {
      abortSignal,
    });
    const result = await meterVisitor({ rpc: () => builder }, KEY, true);
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result?.allowed).toBe(true);
  });

  it("is null on an error, a throw, a rejected promise or no answer", async () => {
    expect(
      await meterVisitor({ rpc: async () => ({ data: null, error: { message: "x" } }) }, KEY, true)
    ).toBeNull();
    expect(
      await meterVisitor(
        {
          rpc: () => {
            throw new Error("boom");
          },
        },
        KEY,
        true
      )
    ).toBeNull();
    expect(
      await meterVisitor({ rpc: () => Promise.reject(new Error("down")) }, KEY, true)
    ).toBeNull();
    expect(await meterVisitor({ rpc: () => undefined }, KEY, true)).toBeNull();
    expect(await meterVisitor({ rpc: async () => null }, KEY, true)).toBeNull();
  });

  it("gives up after the timeout", async () => {
    const started = Date.now();
    const result = await meterVisitor({ rpc: () => new Promise(() => {}) }, KEY, true, 30);
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("parseMeterReply", () => {
  it("reads a refusal and normalises the peak end", () => {
    expect(
      parseMeterReply(
        reply({
          allowed: false,
          reason: "visitor_peak_limit",
          peak: true,
          peak_turns_used: 25,
          peak_ends_at: "2026-01-05T10:00:00+00:00",
        })
      )
    ).toMatchObject({
      allowed: false,
      reason: "visitor_peak_limit",
      peak: true,
      peakEndsAt: "2026-01-05T10:00:00.000Z",
    });
  });

  it.each([
    ["null", null],
    ["an array", [reply()]],
    ["allowed with a reason", reply({ reason: "site_busy" })],
    ["refused without a reason", reply({ allowed: false })],
    ["an unknown reason", reply({ allowed: false, reason: "nope" })],
    ["a string count", reply({ turns_used: "3" })],
    ["a negative count", reply({ turns_max: -1 })],
    ["a missing count", reply({ peak_turns_max: undefined })],
    ["an unknown effort", reply({ reasoning_effort: "medium" })],
    ["a bad peak end", reply({ peak: true, peak_ends_at: "soon" })],
    ["a string peak flag", reply({ peak: "false" })],
  ])("refuses %s", (_label, data) => {
    expect(parseMeterReply(data)).toBeNull();
  });
});
