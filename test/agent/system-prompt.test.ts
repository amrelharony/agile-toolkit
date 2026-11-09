/**
 * System prompt — current-date injection. The agent was refusing relative-date
 * requests ("create a sprint starting today") because it had no date context;
 * the prompt now carries today's date and an instruction to compute from it.
 */

import { describe, it, expect, vi } from "vitest";
import { formatToday, buildSystemPrompt } from "@/lib/agent/system-prompt";

describe("formatToday", () => {
  it("formats a date as ISO + pretty using local calendar fields", () => {
    // Local midnight June 3, 2026 (a Wednesday).
    const s = formatToday(new Date(2026, 5, 3));
    expect(s).toMatch(/^2026-06-03 \(/);
    expect(s).toContain("June 3, 2026");
    expect(s).toContain("Wednesday");
  });

  it("zero-pads single-digit months and days", () => {
    expect(formatToday(new Date(2026, 0, 9))).toMatch(/^2026-01-09 \(/);
  });

  it("defaults to now and yields a well-formed string", () => {
    expect(formatToday()).toMatch(/^\d{4}-\d{2}-\d{2} \(.+\)$/);
  });
});

describe("buildSystemPrompt date wiring", () => {
  it("includes today's date and the relative-date instruction", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("Today's date is");
    expect(p).toContain(String(new Date().getFullYear()));
    expect(p).toMatch(/Resolve relative dates/i);
    // The old absolute "never invent dates" rule must not reappear (it caused
    // the over-cautious refusal this change fixes).
    expect(p).not.toContain("Never invent ids, dates, or state");
  });
});

describe("buildSystemPrompt formatting guidance", () => {
  it("tells the model it can use bold, italic, and emojis", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/Formatting:/);
    expect(p).toMatch(/\bMarkdown\b/);
    expect(p).toContain("**bold**");
    expect(p).toContain("*italic*");
    expect(p).toMatch(/emoji/i);
  });
});

describe("buildSystemPrompt grounding", () => {
  const GROUNDING =
    "About the tool the user has open (use this to explain or coach):\nCurrent tool: Retrospective (/retro)";

  it("includes the grounding block in the current context", () => {
    const p = buildSystemPrompt({ toolId: "retro", grounding: GROUNDING });
    expect(p).toContain(GROUNDING);
    // After the context line, before the safety rules.
    expect(p.indexOf(GROUNDING)).toBeGreaterThan(p.indexOf("Current context:"));
    expect(p.indexOf(GROUNDING)).toBeLessThan(p.indexOf("Safety:"));
  });

  it("is unchanged without grounding", () => {
    // Pin "now" (a Date subclass, not fake timers) so the prompts built below
    // can't straddle midnight and differ only in today's date.
    const FIXED = new Date(2026, 5, 3, 12).getTime();
    const RealDate = Date;
    vi.stubGlobal(
      "Date",
      class extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          super(...((args.length ? args : [FIXED]) as [number]));
        }
        static now() {
          return FIXED;
        }
      }
    );
    try {
      const plain = buildSystemPrompt({ toolId: "retro" });
      expect(buildSystemPrompt({ toolId: "retro", grounding: "" })).toBe(plain);
      expect(buildSystemPrompt({ toolId: "retro", grounding: "   " })).toBe(plain);
      expect(buildSystemPrompt({ toolId: "retro", grounding: null })).toBe(plain);
      expect(plain).not.toContain("About the tool the user has open");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells the model to link toolkit pages and never make up a path", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("[Name](/path)");
    expect(p).toMatch(/never a made-up one/);
  });

  it("no longer claims every action is offered on every turn", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/Each turn offers the ones that fit/);
  });
});
