import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Sprint Comparison gap-filling: the view helpers (ratings, averages,
 * clamping, ordering, radar rows, points), the pin storage helpers, the
 * Markdown's and the radar text's edges, then the page's footer hints, the
 * sprint list line, the comparison table's gaps and Enter-to-commit.
 */

const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { SprintCompareClient } from "@/app/(tools)/sprint-compare/sprint-compare-client";
import {
  CHART_COLORS,
  DIMENSIONS,
  averageOf,
  buildRows,
  clampRating,
  pointsDone,
  radarData,
  ratingsOf,
} from "@/app/(tools)/sprint-compare/view";
import {
  MAX_PINS,
  PINS_KEY,
  clearPins,
  hasRatings,
  parsePins,
  readPinsRaw,
  resolvePins,
  writePins,
} from "@/app/(tools)/sprint-compare/pins";
import { toMarkdown } from "@/app/(tools)/sprint-compare/markdown";
import { sprintRadarText } from "@/app/(tools)/sprint-compare/chart-text";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

const sprint = (id: string, startDate: string, patch: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${id}`,
  startDate,
  endDate: startDate,
  pointsPlanned: 30,
  status: "completed",
  ...patch,
});
const rated = (id: string, ratings: Record<string, number>): SprintSeries => ({ id, ratings });

/* ── View helpers ──────────────────────────────────────────────────────── */

describe("ratingsOf and averageOf", () => {
  it("keeps only finite ratings on the tool's own dimensions", () => {
    expect(
      ratingsOf({
        id: "a",
        ratings: { Velocity: 7, Quality: Number.NaN, Morale: 9, Predictability: Infinity },
      })
    ).toEqual({ Velocity: 7 });
    expect(ratingsOf(undefined)).toEqual({});
    expect(ratingsOf({ id: "a" })).toEqual({});
  });

  it("averages to one decimal, null when nothing is rated", () => {
    expect(averageOf({})).toBeNull();
    expect(averageOf({ Velocity: 7, Quality: 8, "Team Happiness": 8 })).toBe(7.7);
    expect(averageOf({ Velocity: 10 })).toBe(10);
  });
});

describe("clampRating", () => {
  it("keeps a rating within 1-10 at one decimal", () => {
    expect(clampRating(0)).toBe(1);
    expect(clampRating(-4)).toBe(1);
    expect(clampRating(11)).toBe(10);
    expect(clampRating(7.25)).toBe(7.3);
    expect(clampRating(6)).toBe(6);
  });
});

describe("buildRows", () => {
  it("puts undated sprints first in pin order, then oldest first, ties in pin order", () => {
    const sprints = [
      sprint("late", "2026-09-01"),
      sprint("early", "2026-07-01"),
      sprint("tieB", "2026-08-01"),
      sprint("tieA", "2026-08-01"),
      sprint("undated2", ""),
      sprint("undated1", "n/a"),
    ];
    const rows = buildRows(
      ["late", "tieB", "undated2", "missing", "early", "tieA", "undated1"],
      sprints,
      undefined
    );
    expect(rows.map((r) => r.id)).toEqual([
      "undated2",
      "undated1",
      "early",
      "tieB",
      "tieA",
      "late",
    ]);
  });

  it("colours by position, cycling after five", () => {
    const sprints = Array.from({ length: 6 }, (_, i) => sprint(`s${i}`, `2026-0${i + 1}-01`));
    const rows = buildRows(
      sprints.map((s) => s.id),
      sprints,
      [rated("s0", { Velocity: 5 })]
    );
    expect(rows.map((r) => r.color)).toEqual([...CHART_COLORS, CHART_COLORS[0]]);
    expect(rows[0].ratings).toEqual({ Velocity: 5 });
    expect(rows[1].ratings).toEqual({});
  });
});

describe("radarData and pointsDone", () => {
  it("has one row per dimension with null for an unrated sprint", () => {
    const rows = buildRows(
      ["a", "b"],
      [sprint("a", "2026-01-01"), sprint("b", "2026-02-01")],
      [rated("a", { Velocity: 6 })]
    );
    const data = radarData(rows);
    expect(data).toHaveLength(DIMENSIONS.length);
    expect(data[0]).toEqual({ dimension: "Velocity", a: 6, b: null });
    expect(data[1]).toEqual({ dimension: "Quality", a: null, b: null });
  });

  it("describes points done, or nothing without a finite number", () => {
    expect(pointsDone({ pointsCompleted: 29, pointsPlanned: 34 })).toBe("29 of 34 points");
    expect(pointsDone({ pointsCompleted: 0, pointsPlanned: 34 })).toBe("0 of 34 points");
    expect(pointsDone({ pointsCompleted: 12, pointsPlanned: 0 })).toBe("12 points");
    expect(pointsDone({ pointsCompleted: undefined, pointsPlanned: 34 })).toBeNull();
    expect(pointsDone({ pointsCompleted: Number.NaN, pointsPlanned: 34 })).toBeNull();
  });
});

/* ── Pins ──────────────────────────────────────────────────────────────── */

describe("pin storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("parses only non-empty string ids", () => {
    expect(parsePins(JSON.stringify(["a", "", 3, null, "b"]))).toEqual(["a", "b"]);
    expect(parsePins('"a"')).toBeNull();
  });

  it("resolves stored pins: no repeats, at most five, an empty list stays empty", () => {
    const sprints = ["a", "b", "c", "d", "e", "f"].map((id) => sprint(id, "2026-01-01"));
    expect(resolvePins(["a", "a", "b", "c", "d", "e", "f"], sprints, [])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(resolvePins([], sprints, [rated("a", { Quality: 5 })])).toEqual([]);
    expect(MAX_PINS).toBe(5);
  });

  it("writes a bare array and clears it", () => {
    writePins(["s1", "s2"]);
    expect(readPinsRaw()).toBe('["s1","s2"]');
    clearPins();
    expect(readPinsRaw()).toBeNull();
  });

  it("reads nothing when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(readPinsRaw()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("counts a sprint as rated only with a finite rating", () => {
    expect(hasRatings(undefined)).toBe(false);
    expect(hasRatings({ id: "a", ratings: { Velocity: Number.NaN } })).toBe(false);
    expect(hasRatings({ id: "a", ratings: { Velocity: 3 } })).toBe(true);
  });
});

/* ── Markdown and radar text ───────────────────────────────────────────── */

describe("toMarkdown edges", () => {
  const NOW = new Date(2026, 9, 19);

  it("says when nothing is pinned", () => {
    expect(toMarkdown([], NOW)).toBe(
      "# Sprint comparison — 19 Oct 2026\n\nNo sprints pinned yet.\n"
    );
  });

  it("escapes pipes in names and notes when nothing is rated", () => {
    const md = toMarkdown(
      [{ name: "Sprint | 9\nnew", ratings: {}, sprint: sprint("x", "2026-01-01") }],
      NOW
    );
    expect(md).toContain("No ratings yet. A dash means not rated.");
    expect(md).toContain("| Dimension | Sprint \\| 9 new |");
    expect(md).toContain("| **Average** | – |");
    expect(md).toContain("| Points done | – |");
  });
});

describe("sprintRadarText edges", () => {
  it("says there's nothing rated, and notices identical averages", () => {
    expect(
      sprintRadarText([{ dimension: "Velocity", a: null }], [{ id: "a", name: "A" }]).summary
    ).toBe("No rated sprints yet.");
    const rows = [
      { dimension: "Velocity", a: 6, b: 8 },
      { dimension: "Quality", a: 8, b: 6 },
    ];
    expect(
      sprintRadarText(rows, [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]).summary
    ).toBe("2 sprints compared; all average 7 out of 10.");
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const S1 = sprint("s1", "2026-07-01", { name: "Sprint 1", pointsCompleted: 28 });
const S2 = sprint("s2", "2026-07-15", { name: "Sprint 2", pointsCompleted: 25 });
const S3 = sprint("s3", "2026-08-01", { name: "Sprint 3", status: "active" });

function seed(sprints: Sprint[], series: SprintSeries[] = []) {
  useWorkspaceStore.setState({ sprints, sprintSeries: series });
}
const seriesOf = (id: string) =>
  useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === id);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint-compare");
  resetSelectedSprint();
  useSprintMigrationStore.setState({ status: "idle" });
  exported.markdown = "";
});
afterEach(() => seed([], []));

describe("the page", () => {
  it("asks to pin sprints when none are pinned", () => {
    window.localStorage.setItem(PINS_KEY, "[]");
    seed([S1, S2, S3]);
    render(<SprintCompareClient />);
    expect(screen.getByText("Pin up to five sprints below to compare them.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("0 of 5 compared")).toBeInTheDocument();
  });

  it("asks to rate when pinned sprints have no ratings, and can't reset the defaults", () => {
    seed([S1, S2, S3]);
    render(<SprintCompareClient />);
    expect(screen.getByText("Rate a pinned sprint to see it here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset comparison" })).toBeDisabled();
    const table = screen.getByRole("table");
    // No average for an unrated sprint; its points done, or a dash.
    const avgRow = within(table).getByText("Average").closest("tr")!;
    expect(avgRow).toHaveTextContent("Average———");
    const pointsRow = within(table).getByText("Points done").closest("tr")!;
    expect(pointsRow).toHaveTextContent("Points done2825—");
  });

  it("lists each sprint's average rating and velocity", () => {
    seed([S1, S2, S3], [rated("s1", { Velocity: 7, Quality: 8 })]);
    render(<SprintCompareClient />);
    expect(screen.getAllByText("Average rating 7.5 · Velocity: 28 of 30 points")).toHaveLength(1);
    expect(screen.getByText("Not rated · Velocity: 25 of 30 points")).toBeInTheDocument();
    expect(exported.markdown).toContain("| **Average** | **7.5** |");
  });

  it("commits a rating on Enter, and puts a non-number back", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s2"]));
    seed([S1, S2, S3]);
    render(<SprintCompareClient />);
    const box = screen.getByRole("spinbutton", { name: "Quality for Sprint 2" });
    box.focus();
    fireEvent.change(box, { target: { value: "7.25" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(seriesOf("s2")?.ratings).toEqual({ Quality: 7.3 });
    expect(box).toHaveValue(7.3);
  });

  it("offers the sprint chosen in another tool for rating, outside the comparison", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s2"]));
    window.history.replaceState(null, "", "/sprint-compare?sprint=s1");
    seed([S1, S2, S3]);
    render(<SprintCompareClient />);
    expect(screen.getByText("Not in the comparison")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Velocity for Sprint 1" })).toBeInTheDocument();
    // It isn't in the table or the export.
    expect(within(screen.getByRole("table")).queryByText("Sprint 1")).toBeNull();
    expect(exported.markdown).not.toContain("Sprint 1");
  });
});
