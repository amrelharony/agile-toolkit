import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { DEFAULT_SPRINT_DAYS } from "@/lib/sprints/series";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Velocity gap-filling: the view rules (finished, ordering, rows,
 * commitment accuracy, what typing completed points writes, next sprint's
 * dates, labels), the Markdown's and chart text's edges, and on the page the
 * four stat cards, a negative commitment, and the plan-next guard.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
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

import { VelocityClient } from "@/app/(tools)/velocity/velocity-client";
import {
  commitmentAccuracy,
  completedPointsPatch,
  finishedRows,
  isFinishedSprint,
  nextSprintDates,
  sprintDates,
  sprintsOldestFirst,
  statusLabel,
  toVelocityRows,
} from "@/app/(tools)/velocity/view";
import { toMarkdown } from "@/app/(tools)/velocity/markdown";
import { velocityChartText } from "@/app/(tools)/velocity/chart-text";

const sprint = (patch: Partial<Sprint> & { id: string }): Sprint => ({
  name: patch.id,
  startDate: "2026-01-05",
  endDate: "2026-01-19",
  pointsPlanned: 30,
  status: "completed",
  ...patch,
});

/* ── View rules ────────────────────────────────────────────────────────── */

describe("isFinishedSprint", () => {
  it("needs a done status and a finite completed number", () => {
    expect(isFinishedSprint({ status: "completed", pointsCompleted: 0 })).toBe(true);
    expect(isFinishedSprint({ status: "completed", pointsCompleted: undefined })).toBe(false);
    expect(isFinishedSprint({ status: "completed", pointsCompleted: Number.NaN })).toBe(false);
    expect(isFinishedSprint({ status: "active", pointsCompleted: 20 })).toBe(false);
    expect(isFinishedSprint({ status: "cancelled", pointsCompleted: 20 })).toBe(false);
  });
});

describe("sprintsOldestFirst", () => {
  it("puts undated sprints first and orders same-day sprints by number", () => {
    const list = [
      sprint({ id: "b", name: "Sprint 10", startDate: "2026-02-01" }),
      sprint({ id: "a", name: "Sprint 2", startDate: "2026-02-01" }),
      sprint({ id: "old", name: "Old", startDate: "2025-12-01" }),
      sprint({ id: "u", name: "Undated", startDate: "" }),
    ];
    expect(sprintsOldestFirst(list).map((s) => s.id)).toEqual(["u", "old", "a", "b"]);
    expect(list.map((s) => s.id)).toEqual(["b", "a", "old", "u"]);
  });
});

describe("toVelocityRows", () => {
  it("drops a blank goal and makes bad numbers safe", () => {
    const [row] = toVelocityRows([
      sprint({ id: "x", goal: "   ", pointsPlanned: Number.NaN, pointsCompleted: Infinity }),
    ]);
    expect(row).toEqual({
      id: "x",
      name: "x",
      description: undefined,
      committed: 0,
      completed: null,
      status: "completed",
      finished: false,
    });
  });
});

describe("commitmentAccuracy", () => {
  it("leaves out sprints that committed and did nothing, and unfinished ones", () => {
    const rows = toVelocityRows([
      sprint({ id: "met", pointsPlanned: 20, pointsCompleted: 20 }),
      sprint({ id: "missed", pointsPlanned: 20, pointsCompleted: 19 }),
      sprint({ id: "empty", pointsPlanned: 0, pointsCompleted: 0 }),
      sprint({ id: "bonus", pointsPlanned: 0, pointsCompleted: 3 }),
      sprint({ id: "running", pointsPlanned: 20, pointsCompleted: 25, status: "active" }),
    ]);
    // Same start date: name order.
    expect(finishedRows(rows).map((r) => r.id)).toEqual(["bonus", "empty", "met", "missed"]);
    expect(commitmentAccuracy(rows)).toEqual({ met: 2, considered: 3, pct: (2 / 3) * 100 });
    expect(commitmentAccuracy([])).toEqual({ met: 0, considered: 0, pct: 0 });
  });
});

describe("completedPointsPatch", () => {
  const today = "2026-10-20";

  it("clears the points without touching the status", () => {
    expect(
      completedPointsPatch({ status: "completed", endDate: "2026-10-01" }, null, today)
    ).toEqual({ pointsCompleted: undefined });
  });

  it("closes an open sprint that has ended, but not on its last day or with 0 points", () => {
    expect(completedPointsPatch({ status: "active", endDate: "2026-10-19" }, 12, today)).toEqual({
      pointsCompleted: 12,
      status: "completed",
    });
    expect(completedPointsPatch({ status: "planned", endDate: "" }, 12, today)).toEqual({
      pointsCompleted: 12,
      status: "completed",
    });
    expect(completedPointsPatch({ status: "active", endDate: "2026-10-20" }, 12, today)).toEqual({
      pointsCompleted: 12,
    });
    expect(completedPointsPatch({ status: "active", endDate: "2026-10-01" }, 0, today)).toEqual({
      pointsCompleted: 0,
    });
  });

  it("never reopens or closes a cancelled sprint", () => {
    expect(completedPointsPatch({ status: "cancelled", endDate: "2026-10-01" }, 9, today)).toEqual({
      pointsCompleted: 9,
    });
  });
});

describe("nextSprintDates", () => {
  it("starts today with the default length when no sprint has real dates", () => {
    expect(nextSprintDates([], "2026-10-20")).toEqual({
      start: "2026-10-20",
      lengthDays: DEFAULT_SPRINT_DAYS,
    });
    expect(
      nextSprintDates(
        [sprint({ id: "legacy", startDate: "2020-01-02", endDate: "2020-01-03" })],
        "2026-10-20"
      )
    ).toEqual({ start: "2026-10-20", lengthDays: DEFAULT_SPRINT_DAYS });
  });

  it("follows the latest dated sprint that wasn't cancelled", () => {
    const list = [
      sprint({ id: "a", startDate: "2026-09-01", endDate: "2026-09-15" }),
      sprint({ id: "b", startDate: "2026-09-15", endDate: "2026-09-22", status: "completed" }),
      sprint({ id: "c", startDate: "2026-10-01", endDate: "2026-10-15", status: "cancelled" }),
    ];
    expect(nextSprintDates(list, "2026-10-20")).toEqual({ start: "2026-09-23", lengthDays: 7 });
  });
});

describe("labels", () => {
  it("names each status and dates only real dates", () => {
    expect(statusLabel("completed")).toBe("Done");
    expect(statusLabel("planned")).toBe("Planned");
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("cancelled")).toBe("Cancelled");
    expect(sprintDates({ startDate: "2026-10-05", endDate: "2026-10-19" })).toBe("5 Oct – 19 Oct");
    expect(sprintDates({ startDate: "2020-01-01", endDate: "2020-01-02" })).toBeNull();
    expect(sprintDates({ startDate: "2026-10-05", endDate: "" })).toBeNull();
  });
});

/* ── Markdown and chart text ───────────────────────────────────────────── */

describe("toMarkdown edges", () => {
  const NOW = new Date(2026, 9, 18);

  it("adds the last-three average only past three finished sprints", () => {
    const three = toVelocityRows(
      [20, 22, 24].map((c, i) =>
        sprint({
          id: `s${i}`,
          name: `Sprint ${i + 1}`,
          startDate: `2026-0${i + 1}-01`,
          pointsCompleted: c,
        })
      )
    );
    expect(toMarkdown(three, NOW)).toContain(
      "**Average velocity:** 22 points over 3 finished sprints\n"
    );
    const four = toVelocityRows(
      [20, 22, 24, 30].map((c, i) =>
        sprint({
          id: `s${i}`,
          name: `Sprint ${i + 1}`,
          startDate: `2026-0${i + 1}-01`,
          pointsCompleted: c,
        })
      )
    );
    expect(toMarkdown(four, NOW)).toContain(
      "**Average velocity:** 24 points over 4 finished sprints (last 3: 25.3)"
    );
  });

  it("says Yes without a percentage for nothing committed, and a dash for no name", () => {
    const md = toMarkdown(
      toVelocityRows([sprint({ id: "x", name: "  ", pointsPlanned: 0, pointsCompleted: 4 })]),
      NOW
    );
    expect(md).toContain("**Average velocity:** 4 points over 1 finished sprint\n");
    expect(md).toContain("| — | 0 | 4 | Yes |  |");
  });
});

describe("velocityChartText edges", () => {
  it("has a sentence for no sprints and lists rolling and trend columns when present", () => {
    expect(velocityChartText([]).summary).toBe("No sprints yet.");
    const t = velocityChartText([
      { name: "S1", committed: 20, completed: 18, rollingAvg: undefined, trend: 18 },
      { name: "S2", committed: 20, completed: 21, rollingAvg: 19.5, trend: 21 },
    ]);
    expect(t.summary).toBe(
      "Completed points averaged 19.5 over 2 finished sprints; S2 completed 21 of 20 committed."
    );
    expect(t.table.columns).toEqual(["Sprint", "Committed", "Completed", "Rolling avg", "Trend"]);
    expect(t.table.rows[0]).toEqual(["S1", 20, 18, "—", 18]);
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const renderVelocity = () =>
  render(
    <TooltipProvider>
      <VelocityClient />
    </TooltipProvider>
  );
const statCard = (label: string) =>
  screen.getByText(label, { selector: "span" }).parentElement!.parentElement!;
const stored = (id: string) => useWorkspaceStore.getState().sprints.find((s) => s.id === id);

beforeEach(() => {
  resetSelectedSprint();
  window.localStorage.clear();
  useSprintMigrationStore.setState({ status: "idle" });
});
afterEach(() => useWorkspaceStore.setState({ sprints: [], sprintSeries: [] }));

describe("stat cards", () => {
  it("average, predictability, spread and an upward trend from finished sprints only", () => {
    useWorkspaceStore.setState({
      sprints: [
        sprint({
          id: "s1",
          name: "Sprint 1",
          startDate: "2025-01-06",
          pointsPlanned: 30,
          pointsCompleted: 28,
        }),
        sprint({
          id: "s2",
          name: "Sprint 2",
          startDate: "2025-01-20",
          pointsPlanned: 32,
          pointsCompleted: 33,
        }),
        sprint({
          id: "s3",
          name: "Sprint 3",
          startDate: "2099-01-05",
          endDate: "2099-01-19",
          pointsPlanned: 35,
          status: "active",
        }),
      ],
      sprintSeries: [],
    });
    renderVelocity();
    expect(statCard("Average Velocity")).toHaveTextContent("30.5pts");
    expect(statCard("Predictability")).toHaveTextContent("50%");
    expect(statCard("Std Deviation")).toHaveTextContent("2.5pts");
    expect(statCard("Trend")).toHaveTextContent("Up");
  });

  it("call a flat run stable, and a falling one down", () => {
    useWorkspaceStore.setState({
      sprints: [20, 20.4, 20].map((c, i) =>
        sprint({
          id: `f${i}`,
          name: `Sprint ${i + 1}`,
          startDate: `2025-0${i + 1}-06`,
          pointsCompleted: c,
        })
      ),
      sprintSeries: [],
    });
    const { unmount } = renderVelocity();
    expect(statCard("Trend")).toHaveTextContent("Stable");
    unmount();

    useWorkspaceStore.setState({
      sprints: [30, 24, 18].map((c, i) =>
        sprint({
          id: `d${i}`,
          name: `Sprint ${i + 1}`,
          startDate: `2025-0${i + 1}-06`,
          pointsCompleted: c,
        })
      ),
      sprintSeries: [],
    });
    renderVelocity();
    expect(statCard("Trend")).toHaveTextContent("Down");
    expect(statCard("Predictability")).toHaveTextContent("33%");
  });
});

describe("editing", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      sprints: [sprint({ id: "s1", name: "Sprint 1", pointsPlanned: 30, pointsCompleted: 28 })],
      sprintSeries: [],
    });
  });

  it("turns a negative commitment into 0 and puts a blank back", () => {
    renderVelocity();
    const box = screen.getByRole("spinbutton", { name: "Committed points for Sprint 1" });
    fireEvent.change(box, { target: { value: "-5" } });
    fireEvent.blur(box);
    expect(stored("s1")?.pointsPlanned).toBe(0);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(stored("s1")?.pointsPlanned).toBe(0);
    expect(box).toHaveValue(0);
  });

  it("can't commit a next sprint without a number, and ignores a negative one", () => {
    renderVelocity();
    const commitButton = screen.getByRole("button", { name: "Commit" });
    expect(commitButton).toBeDisabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Planned commitment/ }), {
      target: { value: "-3" },
    });
    fireEvent.click(commitButton);
    expect(useWorkspaceStore.getState().sprints).toHaveLength(1);
  });

  it("rounds a fractional next-sprint commitment", () => {
    renderVelocity();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Planned commitment/ }), {
      target: { value: "31.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    const created = useWorkspaceStore.getState().sprints.find((s) => s.id !== "s1");
    expect(created).toMatchObject({ pointsPlanned: 32, status: "planned", name: "Sprint 2" });
  });
});
