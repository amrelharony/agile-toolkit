/**
 * System prompt — current-date injection. The agent was refusing relative-date
 * requests ("create a sprint starting today") because it had no date context;
 * the prompt now carries today's date and an instruction to compute from it.
 */

import { describe, it, expect } from "vitest";
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
