/**
 * A visitor's allowance in words (src/lib/visitor-ai/allowance.ts): the visitor
 * chat's one status line, the messages left now (none left lasting only as
 * long as the Cairo day the route counted it in), when the line stands out,
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
  dayOver,
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

describe("dayOver", () => {
  // Cairo is UTC+2 in November: 23:50 on Monday 16 November is 21:50 UTC.
  const LATE = Date.parse("2026-11-16T21:50:00Z");
  const none = quota({ remaining: 0, receivedAt: LATE });

  it("lets none left run out with its Cairo day: unknown again past midnight, so the next message asks", () => {
    const before = new Date("2026-11-16T21:55:00Z"); // 23:55 in Cairo
    const after = new Date("2026-11-16T22:05:00Z"); // 00:05 on the 17th
    expect(dayOver(none, before)).toBe(false);
    expect(messagesLeft(none, before)).toBe(0);
    expect(dayOver(none, after)).toBe(true);
    expect(messagesLeft(none, after)).toBeNull();
    // The line stops saying "0 of 100 left today" for a day that is over.
    expect(allowanceLine(none, before, true)).toBe("0 of 100 left today · Not saved");
    expect(allowanceLine(none, after, true)).toBe(
      `${VISITOR_AI_DAILY_MESSAGES} messages a day · Not saved`
    );
  });

  it("goes by Cairo's own calendar through daylight saving, not a fixed offset", () => {
    // Summer (UTC+3): 23:50 on 1 July, then 00:10 on the 2nd.
    const summer = quota({ remaining: 0, receivedAt: Date.parse("2026-07-01T20:50:00Z") });
    expect(dayOver(summer, new Date("2026-07-01T21:10:00Z"))).toBe(true);
    // Daylight saving ends at midnight on 29 October: 23:30 comes round twice,
    // an hour apart, and both are still the 29th.
    const fallBack = quota({ remaining: 0, receivedAt: Date.parse("2026-10-29T20:30:00Z") });
    expect(dayOver(fallBack, new Date("2026-10-29T21:30:00Z"))).toBe(false);
    expect(messagesLeft(fallBack, new Date("2026-10-29T21:30:00Z"))).toBe(0);
    expect(dayOver(fallBack, new Date("2026-10-29T22:30:00Z"))).toBe(true);
  });

  it("is never over with no allowance, or one with no time on it (it counts as just now)", () => {
    expect(dayOver(null, new Date())).toBe(false);
    expect(dayOver(quota({ remaining: 0 }), new Date("2030-01-01T00:00:00Z"))).toBe(false);
    expect(messagesLeft(quota({ remaining: 0 }), new Date("2030-01-01T00:00:00Z"))).toBe(0);
  });

  it("leaves the busy-hours note to today's clock once the day is over", () => {
    // Busy hours reported yesterday, over now: today's window by the clock names the route's limit.
    const yesterday = quota({
      remaining: 0,
      peak: true,
      peakRemaining: 0,
      peakLimit: 5,
      peakEndsAt: "2026-11-08T10:00:00Z",
      receivedAt: Date.parse("2026-11-08T08:00:00Z"),
    });
    const end = formatPeakTime(new Date("2026-11-09T10:00:00Z"));
    expect(dayOver(yesterday, IN_PEAK)).toBe(true);
    expect(messagesLeft(yesterday, IN_PEAK)).toBeNull();
    expect(peakNote(yesterday, IN_PEAK)).toBe(`Busy hours until ${end}: 5 messages in this window`);
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
