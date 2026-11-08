import { describe, expect, it } from "vitest";
import { OUTCOME_EVENTS, ZERO_XP_EVENTS, ZERO_XP_PREFIXES } from "@/lib/gamification/outcomes";
import { scanEmissions } from "./emit-scan";

/**
 * Every literal gamification event the app emits is either an outcome (it
 * pays through the ledger) or listed in ZERO_XP_EVENTS (it deliberately
 * pays nothing). A new `emit(tool, event)` fails here until someone decides.
 */

const emissions = scanEmissions();
const names = new Set(emissions.map((e) => e.name));

describe("XP rules coverage", () => {
  it("finds the app's emitters (the scan itself works)", () => {
    for (const known of [
      "tool:kanban:card-done",
      "tool:planning-poker:vote",
      "tool:ceremony-timer:finish",
      "tool:risk-register:risk-added",
      "tool:nps-csat:score-promoter",
      "tool:comics:completed",
      "rt:sync-remote",
    ]) {
      expect(names.has(known), known).toBe(true);
    }
    // Comparison literals in a ternary are conditions, not events.
    expect(names.has("tool:kanban:done")).toBe(false);
  });

  it("classifies every literal emit as an outcome or a zero-XP event", () => {
    const unclassified = emissions
      .filter(
        (e) =>
          !OUTCOME_EVENTS[e.name] &&
          !ZERO_XP_EVENTS.includes(e.name) &&
          !ZERO_XP_PREFIXES.some((p) => e.name.startsWith(p))
      )
      .map((e) => `${e.name} (${e.file})`);
    expect(unclassified).toEqual([]);
  });

  it("lists no event as both an outcome and zero-XP", () => {
    expect(ZERO_XP_EVENTS.filter((n) => OUTCOME_EVENTS[n])).toEqual([]);
  });

  it("lists no zero-XP event that nothing emits any more", () => {
    expect(ZERO_XP_EVENTS.filter((n) => !names.has(n))).toEqual([]);
  });
});
