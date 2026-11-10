/**
 * Z.AI's peak window: Monday to Friday, 14:00-18:00 Singapore time, which is
 * 08:00-12:00 in Cairo in winter and 09:00-13:00 in summer. Singapore has no
 * daylight saving (06:00-10:00 UTC all year), so the window never moves; only
 * Cairo's reading of it does.
 *
 * "Now" is pinned with a Date subclass, not fake timers (see
 * test/agent/system-prompt.test.ts), for the calls that rely on the default.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PEAK,
  formatPeakRange,
  formatPeakTime,
  isPeak,
  peakWindow,
} from "@/lib/visitor-ai/peak";

const CAIRO = "Africa/Cairo";
const at = (iso: string) => new Date(iso);
const cairo = (d: Date | null) => (d ? formatPeakTime(d, CAIRO, "en-GB") : null);

/** Pin "now" for code that calls `new Date()` with no arguments. */
function pinNow(iso: string) {
  const FIXED = Date.parse(iso);
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
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the edges, in Singapore time", () => {
  // Monday 5 January 2026 (winter in Cairo) and Monday 6 July 2026 (summer).
  it.each(["2026-01-05", "2026-07-06"])("%s: 13:59 off, 14:00 on, 17:59 on, 18:00 off", (day) => {
    expect(isPeak(at(`${day}T05:59:00Z`))).toBe(false); // 13:59 SGT
    expect(isPeak(at(`${day}T05:59:59Z`))).toBe(false);
    expect(isPeak(at(`${day}T06:00:00Z`))).toBe(true); // 14:00 SGT
    expect(isPeak(at(`${day}T09:59:00Z`))).toBe(true); // 17:59 SGT
    expect(isPeak(at(`${day}T09:59:59Z`))).toBe(true);
    expect(isPeak(at(`${day}T10:00:00Z`))).toBe(false); // 18:00 SGT
  });

  it("runs Monday to Friday and never at the weekend", () => {
    // 07:00 UTC is 15:00 in Singapore, mid-window on a weekday.
    const week = ["05", "06", "07", "08", "09", "10", "11"].map((d) =>
      isPeak(at(`2026-01-${d}T07:00:00Z`))
    );
    expect(week).toEqual([true, true, true, true, true, false, false]);
  });

  it("judges the weekday in Singapore, not UTC or Cairo", () => {
    // Friday 22:00 UTC is already Saturday 06:00 in Singapore: no window.
    expect(isPeak(at("2026-01-09T22:00:00Z"))).toBe(false);
    // Sunday 23:00 UTC is Monday 07:00 in Singapore: before the window.
    expect(isPeak(at("2026-01-11T23:00:00Z"))).toBe(false);
  });
});

describe("in Cairo", () => {
  it("is 08:00-12:00 in January", () => {
    const w = peakWindow(at("2026-01-05T03:00:00Z"));
    expect(w.on).toBe(false);
    expect(formatPeakRange(w.nextStart!, w.nextEnd!, CAIRO, "en-GB")).toBe("08:00–12:00");
  });

  it("is 09:00-13:00 in July", () => {
    const w = peakWindow(at("2026-07-06T03:00:00Z"));
    expect(formatPeakRange(w.nextStart!, w.nextEnd!, CAIRO, "en-GB")).toBe("09:00–13:00");
  });

  it("moves with Cairo's clocks in April, at the same instant", () => {
    // Cairo's summer time starts on the last Friday of April (24 April 2026).
    const before = peakWindow(at("2026-04-23T00:00:00Z"));
    const after = peakWindow(at("2026-04-27T00:00:00Z"));
    expect(formatPeakRange(before.nextStart!, before.nextEnd!, CAIRO, "en-GB")).toBe("08:00–12:00");
    expect(formatPeakRange(after.nextStart!, after.nextEnd!, CAIRO, "en-GB")).toBe("09:00–13:00");
    expect(before.nextStart!.toISOString()).toBe("2026-04-23T06:00:00.000Z");
    expect(after.nextStart!.toISOString()).toBe("2026-04-27T06:00:00.000Z");
  });

  it("ends at 12:00 in winter and 13:00 in summer while it's on", () => {
    expect(cairo(peakWindow(at("2026-01-05T07:30:00Z")).endsAt)).toBe("12:00");
    expect(cairo(peakWindow(at("2026-07-06T07:30:00Z")).endsAt)).toBe("13:00");
  });
});

describe("peakWindow", () => {
  it("while on: when it ends, and tomorrow's start as the next", () => {
    const w = peakWindow(at("2026-01-05T06:00:00Z"));
    expect(w.on).toBe(true);
    expect(w.endsAt?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
    expect(w.nextStart?.toISOString()).toBe("2026-01-06T06:00:00.000Z");
    expect(w.nextEnd?.toISOString()).toBe("2026-01-06T10:00:00.000Z");
  });

  it("before the window: today's start is next", () => {
    const w = peakWindow(at("2026-01-05T05:59:00Z"));
    expect(w).toMatchObject({ on: false, endsAt: null });
    expect(w.nextStart?.toISOString()).toBe("2026-01-05T06:00:00.000Z");
  });

  it("after Friday's window: Monday's start is next", () => {
    const w = peakWindow(at("2026-01-09T10:00:00Z"));
    expect(w).toMatchObject({ on: false, endsAt: null });
    expect(w.nextStart?.toISOString()).toBe("2026-01-12T06:00:00.000Z");
  });

  it("across a month's end", () => {
    // Friday 30 January after the window → Monday 2 February.
    expect(peakWindow(at("2026-01-30T12:00:00Z")).nextStart?.toISOString()).toBe(
      "2026-02-02T06:00:00.000Z"
    );
  });

  it("a config with no days or no hours is never on and has no next window", () => {
    for (const cfg of [
      { ...DEFAULT_PEAK, days: [] },
      { ...DEFAULT_PEAK, start: 18, end: 18 },
    ]) {
      expect(isPeak(at("2026-01-05T07:00:00Z"), cfg)).toBe(false);
      expect(peakWindow(at("2026-01-05T07:00:00Z"), cfg)).toEqual({
        on: false,
        endsAt: null,
        nextStart: null,
        nextEnd: null,
      });
    }
  });

  it("follows another zone and window when configured (the config row can change)", () => {
    const cfg = { tz: CAIRO, days: [6, 7], start: 0, end: 24 };
    expect(isPeak(at("2026-01-10T12:00:00Z"), cfg)).toBe(true);
    expect(isPeak(at("2026-01-09T21:59:00Z"), cfg)).toBe(false); // Friday 23:59 Cairo
    expect(isPeak(at("2026-01-09T22:00:00Z"), cfg)).toBe(true); // Saturday 00:00 Cairo
    expect(peakWindow(at("2026-01-10T12:00:00Z"), cfg).endsAt?.toISOString()).toBe(
      "2026-01-10T22:00:00.000Z"
    );
  });
});

describe("with the default 'now'", () => {
  it("reads the clock when no date is given", () => {
    pinNow("2026-07-06T06:30:00Z");
    expect(isPeak()).toBe(true);
    expect(cairo(peakWindow().endsAt)).toBe("13:00");
    vi.unstubAllGlobals();
    pinNow("2026-07-11T06:30:00Z"); // Saturday
    expect(isPeak()).toBe(false);
    expect(peakWindow().nextStart?.toISOString()).toBe("2026-07-13T06:00:00.000Z");
  });
});

describe("formatting", () => {
  it("renders 24-hour times in the zone it's given", () => {
    const t = at("2026-01-05T06:00:00Z");
    expect(formatPeakTime(t, "Asia/Singapore", "en-GB")).toBe("14:00");
    expect(formatPeakTime(t, CAIRO, "en-GB")).toBe("08:00");
    expect(formatPeakTime(t, "UTC", "en-GB")).toBe("06:00");
    expect(formatPeakRange(t, at("2026-01-05T10:00:00Z"), "America/New_York", "en-GB")).toBe(
      "01:00–05:00"
    );
  });
});
