import { describe, expect, it } from "vitest";
import { formatDuration, mttrHours } from "@/app/(tools)/incident-commander/helpers";
import type { Incident } from "@/app/(tools)/incident-commander/types";

describe("incident-commander formatDuration", () => {
  it("formats sub-hour and multi-hour durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("returns the placeholder for negative durations", () => {
    expect(formatDuration(-1)).toBe("—");
  });

  it("returns the placeholder for NaN/Infinity (e.g. a malformed openedAt), not 'NaNh NaNm'", () => {
    // Regression: `NaN < 0` is false, so NaN previously fell through to
    // `${NaN}h ${NaN}m`.
    const malformed = new Date("not-a-date").getTime() - new Date("2026-01-01").getTime();
    expect(Number.isNaN(malformed)).toBe(true);
    expect(formatDuration(malformed)).toBe("—");
    expect(formatDuration(Infinity)).toBe("—");
  });
});

describe("incident-commander mttrHours", () => {
  const base = {
    id: "i1",
    title: "DB outage",
    severity: "sev1",
    openedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Incident;

  it("returns null when unresolved", () => {
    expect(mttrHours({ ...base, resolvedAt: undefined } as Incident)).toBeNull();
  });

  it("computes elapsed hours for a resolved incident", () => {
    const i = { ...base, resolvedAt: "2026-01-01T02:30:00.000Z" } as Incident;
    expect(mttrHours(i)).toBeCloseTo(2.5, 6);
  });

  it("returns null when resolvedAt precedes openedAt or dates are malformed", () => {
    expect(mttrHours({ ...base, resolvedAt: "2025-12-31T23:00:00.000Z" } as Incident)).toBeNull();
    expect(mttrHours({ ...base, resolvedAt: "garbage" } as Incident)).toBeNull();
  });
});
