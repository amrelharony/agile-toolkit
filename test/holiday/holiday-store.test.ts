import { describe, expect, it, beforeEach } from "vitest";
import { useHolidayStore, pruneStale } from "@/lib/stores/holiday-store";

function resetStore() {
  useHolidayStore.setState({
    enabled: true,
    dismissedWindows: {},
    previewThemeId: null,
  });
}

describe("useHolidayStore.dismiss — WINDOW_KEY_RE allowlist", () => {
  beforeEach(() => {
    resetStore();
  });

  it("accepts well-formed id::yyyy-mm-dd keys", () => {
    useHolidayStore.getState().dismiss("eid-fitr::2025-04-01");
    expect(useHolidayStore.getState().dismissedWindows["eid-fitr::2025-04-01"]).toBe(true);
  });

  it("accepts ids with hyphens and digits", () => {
    useHolidayStore.getState().dismiss("jan-25::2025-01-25");
    useHolidayStore.getState().dismiss("jun-30::2025-06-30");
    expect(useHolidayStore.getState().dismissedWindows["jan-25::2025-01-25"]).toBe(true);
    expect(useHolidayStore.getState().dismissedWindows["jun-30::2025-06-30"]).toBe(true);
  });

  it("rejects script-injection attempts", () => {
    useHolidayStore.getState().dismiss("<script>::2025-01-01");
    expect(useHolidayStore.getState().dismissedWindows["<script>::2025-01-01"]).toBeUndefined();
  });

  it("rejects keys without the ISO date suffix", () => {
    useHolidayStore.getState().dismiss("bad-key");
    useHolidayStore.getState().dismiss("eid-fitr::not-a-date");
    expect(Object.keys(useHolidayStore.getState().dismissedWindows)).toHaveLength(0);
  });

  it("rejects keys with whitespace or quotes", () => {
    useHolidayStore.getState().dismiss("eid fitr::2025-04-01");
    useHolidayStore.getState().dismiss('"eid"::2025-04-01');
    expect(Object.keys(useHolidayStore.getState().dismissedWindows)).toHaveLength(0);
  });

  it("rejects empty key", () => {
    useHolidayStore.getState().dismiss("");
    expect(Object.keys(useHolidayStore.getState().dismissedWindows)).toHaveLength(0);
  });

  it("rejects ids longer than 40 chars (regex bound)", () => {
    const longId = "a".repeat(41);
    useHolidayStore.getState().dismiss(`${longId}::2025-01-01`);
    expect(useHolidayStore.getState().dismissedWindows[`${longId}::2025-01-01`]).toBeUndefined();
  });
});

describe("useHolidayStore — state transitions", () => {
  beforeEach(() => {
    resetStore();
  });

  it("setEnabled toggles state", () => {
    useHolidayStore.getState().setEnabled(false);
    expect(useHolidayStore.getState().enabled).toBe(false);
    useHolidayStore.getState().setEnabled(true);
    expect(useHolidayStore.getState().enabled).toBe(true);
  });

  it("clearDismissed empties the record", () => {
    useHolidayStore.getState().dismiss("eid-fitr::2025-04-01");
    useHolidayStore.getState().dismiss("jan-25::2025-01-25");
    expect(Object.keys(useHolidayStore.getState().dismissedWindows)).toHaveLength(2);
    useHolidayStore.getState().clearDismissed();
    expect(Object.keys(useHolidayStore.getState().dismissedWindows)).toHaveLength(0);
  });

  it("setPreview sets and clears preview id", () => {
    useHolidayStore.getState().setPreview("ramadan");
    expect(useHolidayStore.getState().previewThemeId).toBe("ramadan");
    useHolidayStore.getState().setPreview(null);
    expect(useHolidayStore.getState().previewThemeId).toBeNull();
  });
});

describe("pruneStale — 18-month cutoff", () => {
  const SIX_MONTHS_AGO = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  })();

  const TWO_YEARS_AGO = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  })();

  it("keeps fresh entries (within 18 months)", () => {
    const input = { [`eid-fitr::${SIX_MONTHS_AGO}`]: true };
    expect(pruneStale(input)).toEqual(input);
  });

  it("drops entries older than 18 months", () => {
    const input = { [`eid-fitr::${TWO_YEARS_AGO}`]: true };
    expect(pruneStale(input)).toEqual({});
  });

  it("drops malformed date parts", () => {
    const input = {
      "eid-fitr::not-a-date": true,
      "missing-suffix": true,
    };
    expect(pruneStale(input)).toEqual({});
  });

  it("mixed fresh + stale: keeps fresh, drops stale", () => {
    const input = {
      [`eid-fitr::${SIX_MONTHS_AGO}`]: true,
      [`ramadan::${TWO_YEARS_AGO}`]: true,
    };
    const out = pruneStale(input);
    expect(out[`eid-fitr::${SIX_MONTHS_AGO}`]).toBe(true);
    expect(out[`ramadan::${TWO_YEARS_AGO}`]).toBeUndefined();
  });

  it("returns an empty record for an empty input", () => {
    expect(pruneStale({})).toEqual({});
  });
});
