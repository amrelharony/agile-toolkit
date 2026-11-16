/**
 * A visitor's allowance in words (src/lib/visitor-ai/allowance.ts): the visitor
 * chat's one status line, the messages left now, when the line stands out,
 * and what Try again says it spends. peakNote's own cases are in
 * test/agent/mascot-visitor.test.tsx, through the chat's re-export.
 */

import { describe, expect, it } from "vitest";
import type { VisitorQuota } from "@/lib/agent/store";
import { peakNote as reExported } from "@/components/agent/mascot/visitor-agent-panel";
import {
  LOW_LEFT,
  PEAK_MESSAGES,
  allowanceLine,
  lowOnMessages,
  messagesLeft,
  peakNote,
  peakOver,
  retryCost,
} from "@/lib/visitor-ai/allowance";
import { formatPeakTime } from "@/lib/visitor-ai/peak";
import { VISITOR_AI_DAILY_MESSAGES } from "@/lib/site/disclosures";

// Monday 9 November 2026, 15:00 in Singapore (07:00 UTC): inside 14:00-18:00.
const IN_PEAK = new Date("2026-11-09T07:00:00Z");
// Saturday: never busy hours.
const WEEKEND = new Date("2026-11-14T07:00:00Z");

const quota = (over: Partial<VisitorQuota> = {}): VisitorQuota => ({
  remaining: 62,
  limit: 100,
  peak: false,
  peakRemaining: null,
  peakLimit: null,
  peakEndsAt: null,
  ...over,
});

const FIRST_PERSON = /\b(I|me|my|mine|I'm|I've|I'll)\b/;

describe("allowanceLine", () => {
  it("says the day's allowance before the route has answered, and after", () => {
    expect(allowanceLine(null, WEEKEND, false)).toBe(
      `${VISITOR_AI_DAILY_MESSAGES} AI uses a day · Amr asks before changing anything · Not saved`
    );
    expect(allowanceLine(quota(), WEEKEND, false)).toBe(
      "62 of 100 left today · Amr asks before changing anything · Not saved"
    );
  });

  it("makes no promise about changes in a live room, where Amr has no tools", () => {
    expect(allowanceLine(quota(), WEEKEND, true)).toBe("62 of 100 left today · Not saved");
  });

  it("folds busy hours into the same line while they are on, by the clock or the route", () => {
    const end = formatPeakTime(new Date("2026-11-09T10:00:00Z"));
    expect(allowanceLine(null, IN_PEAK, false)).toBe(
      `${VISITOR_AI_DAILY_MESSAGES} AI uses a day · Busy hours until ${end}: ${PEAK_MESSAGES} messages in this window · Amr asks before changing anything · Not saved`
    );
    const ends = "2026-11-09T10:00:00Z";
    const busy = quota({ peak: true, peakRemaining: 18, peakLimit: 25, peakEndsAt: ends });
    expect(allowanceLine(busy, IN_PEAK, true)).toBe(
      `62 of 100 left today · Busy hours until ${end}: 18 of 25 messages left in this window · Not saved`
    );
    // Over: the day's allowance alone again.
    expect(allowanceLine(busy, new Date("2026-11-09T10:00:00Z"), true)).toBe(
      "62 of 100 left today · Not saved"
    );
  });

  it("is the same busy-hours note the chat has always exported", () => {
    expect(reExported).toBe(peakNote);
  });

  it("is narration: no first person and no dashes", () => {
    const ends = "2026-11-09T10:00:00Z";
    for (const line of [
      allowanceLine(null, IN_PEAK, false),
      allowanceLine(
        quota({ peak: true, peakRemaining: 1, peakLimit: 25, peakEndsAt: ends }),
        IN_PEAK,
        false
      ),
      allowanceLine(quota({ remaining: 1 }), WEEKEND, true),
      ...[null, 0, 1, 2, 40].map(retryCost),
    ]) {
      expect(line).not.toMatch(FIRST_PERSON);
      expect(line).not.toMatch(/[–—]/);
    }
  });
});

describe("messagesLeft", () => {
  it("is null before the route has said, and the day's count outside busy hours", () => {
    expect(messagesLeft(null)).toBeNull();
    expect(messagesLeft(quota({ remaining: 7 }))).toBe(7);
  });

  it("is the window's count in busy hours when it is the smaller, until the window ends", () => {
    const ends = "2026-11-09T10:00:00Z";
    const busy = quota({
      remaining: 40,
      peak: true,
      peakRemaining: 2,
      peakLimit: 25,
      peakEndsAt: ends,
    });
    expect(messagesLeft(busy, IN_PEAK)).toBe(2);
    expect(messagesLeft(quota({ remaining: 1, peak: true, peakRemaining: 9 }), IN_PEAK)).toBe(1);
    // The window the route reported is over: its smaller allowance no longer applies.
    const after = new Date("2026-11-09T10:00:00Z");
    expect(peakOver(busy, after)).toBe(true);
    expect(messagesLeft(busy, after)).toBe(40);
    // An end the route didn't give keeps the window's count.
    expect(peakOver(quota({ peak: true, peakRemaining: 0 }), after)).toBe(false);
    expect(messagesLeft(quota({ peak: true, peakRemaining: 0 }), after)).toBe(0);
  });
});

describe("lowOnMessages", () => {
  it(`stands out at ${LOW_LEFT} or fewer, but not at none (the read-only footer says that)`, () => {
    expect([null, 0, 1, LOW_LEFT, LOW_LEFT + 1, 50].map(lowOnMessages)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("retryCost", () => {
  it("says what Try again spends", () => {
    expect(retryCost(null)).toBe("uses 1 message");
    expect(retryCost(1)).toBe("uses your last message");
    expect(retryCost(12)).toBe("uses 1 of your 12 left");
  });
});
