import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Sprint Comparison scores the shared sprints: the team's ratings (Team
 * Happiness, Quality) live on each sprint's series, the other scores are
 * computed, the compared sprints are a plain array of ids in this browser,
 * and the example is an in-memory preview that saves nothing.
 */

const logged = vi.hoisted(() => ({ events: [] as { action: string; payload: unknown }[] }));
const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: unknown) => logged.events.push({ action, payload }),
  }),
}));

beforeAll(() => {
  // Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
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
import { PINS_KEY, defaultPins, parsePins, resolvePins } from "@/app/(tools)/sprint-compare/pins";
import { buildRows, scoredValues, scoresBySprint } from "@/app/(tools)/sprint-compare/view";
import { toMarkdown } from "@/app/(tools)/sprint-compare/markdown";
import { generateSprintComparePrompts } from "@/lib/ai-prompts/sprint-compare";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { SELECTED_SPRINT_KEY, resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";
import { sprintsNewestFirst } from "@/lib/sprints/series";

const sprint = (n: number, startDate: string, status: Sprint["status"] = "completed"): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate,
  endDate: startDate.replace(/-(\d{2})$/, (_m, d) => `-${String(Number(d) + 13).padStart(2, "0")}`),
  pointsPlanned: 30,
  pointsCompleted: status === "completed" ? 20 + n : undefined,
  status,
});

const S1 = sprint(1, "2026-07-01");
const S2 = sprint(2, "2026-07-15");
const S3 = sprint(3, "2026-08-01");
const S4 = sprint(4, "2026-08-15");
const S5 = sprint(5, "2026-09-01");
const S6 = sprint(6, "2026-09-15");
const S7 = sprint(7, "2026-10-01", "active");
const ALL = [S1, S2, S3, S4, S5, S6, S7];

const rated = (id: string, ratings: Record<string, number>): SprintSeries => ({ id, ratings });

function seed(sprints: Sprint[], series: SprintSeries[] = []) {
  useWorkspaceStore.setState({ sprints, sprintSeries: series });
}

const storedPins = () => {
  const raw = window.localStorage.getItem(PINS_KEY);
  return raw === null ? null : (JSON.parse(raw) as unknown);
};
const seriesOf = (id: string) =>
  useWorkspaceStore.getState().sprintSeries?.find((s) => s.id === id);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint-compare");
  resetSelectedSprint();
  useSprintMigrationStore.setState({ status: "idle" });
  logged.events = [];
  undo.last = null;
});
afterEach(() => {
  seed([], []);
});

describe("default pins", () => {
  it("are the five newest rated sprints, else the three newest", () => {
    const newest = sprintsNewestFirst(ALL);
    expect(defaultPins(newest, [])).toEqual(["s7", "s6", "s5"]);

    const series = [S1, S2, S3, S4, S5, S6].map((s) => rated(s.id, { Quality: 7 }));
    expect(defaultPins(newest, series)).toEqual(["s6", "s5", "s4", "s3", "s2"]);

    expect(defaultPins(newest, [rated("s2", { Velocity: 5 })])).toEqual(["s2"]);
    // An empty ratings object isn't "rated".
    expect(defaultPins(newest, [{ id: "s6", ratings: {} }])).toEqual(["s7", "s6", "s5"]);
  });

  it("apply on screen when nothing is stored, without writing the key", () => {
    // Every finished sprint has computed scores; the running one has none.
    seed(ALL, [rated("s2", { Velocity: 6 }), rated("s4", { Velocity: 8 })]);
    render(<SprintCompareClient />);
    expect(screen.getAllByRole("button", { name: "Unpin Sprint 2" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Unpin Sprint 6" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Pin Sprint 1" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Pin Sprint 7" }).length).toBeGreaterThan(0);
    expect(screen.getByText("5 of 5 compared")).toBeInTheDocument();
    expect(storedPins()).toBeNull();
  });
});

describe("pinning", () => {
  it("uses the key the migration seeds", () => {
    // Package M writes migrated rows' ids here, as a bare JSON array.
    expect(PINS_KEY).toBe("agile-toolkit:sprint-compare:pins");
  });

  it("pins and unpins, saved as a plain JSON array of sprint ids", () => {
    // No sprint closed yet: none has a score, so the default is the three newest.
    seed(ALL.map((s) => ({ ...s, status: "planned" as const, pointsCompleted: undefined })));
    render(<SprintCompareClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Pin Sprint 2" })[0]);
    expect(storedPins()).toEqual(["s7", "s6", "s5", "s2"]);
    expect(logged.events).toContainEqual({
      action: "sprint_pinned",
      payload: { sprintId: "s2", name: "Sprint 2" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Unpin Sprint 6" })[0]);
    expect(storedPins()).toEqual(["s7", "s5", "s2"]);
    expect(logged.events).toContainEqual({
      action: "sprint_unpinned",
      payload: { sprintId: "s6", name: "Sprint 6" },
    });
    expect(screen.getByText("3 of 5 compared")).toBeInTheDocument();
  });

  it("stops at five", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s1", "s2", "s3", "s4", "s5"]));
    seed(ALL);
    render(<SprintCompareClient />);
    for (const b of screen.getAllByRole("button", { name: "Pin Sprint 6" })) {
      expect(b).toBeDisabled();
    }
    expect(screen.getByText(/Unpin one to add another/)).toBeInTheDocument();
  });

  it("ignores stored ids whose sprint no longer exists", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["gone", "s3", "s3", 42, "s5"]));
    seed(ALL);
    expect(resolvePins(parsePins(window.localStorage.getItem(PINS_KEY)), ALL, [])).toEqual([
      "s3",
      "s5",
    ]);

    render(<SprintCompareClient />);
    expect(screen.getByText("2 of 5 compared")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Pin Sprint 1" })[0]);
    // The stale id is dropped on the next write.
    expect(storedPins()).toEqual(["s3", "s5", "s1"]);
  });

  it("treats a malformed value as nothing stored", () => {
    expect(parsePins("{oops")).toBeNull();
    expect(parsePins('{"state":{}}')).toBeNull();
    expect(parsePins(null)).toBeNull();
    expect(parsePins("[]")).toEqual([]);
  });

  it("reset goes back to the defaults and can be undone", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s1"]));
    seed(ALL);
    render(<SprintCompareClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset comparison" }));
    expect(storedPins()).toBeNull();
    // The five newest scored sprints.
    expect(screen.getByText("5 of 5 compared")).toBeInTheDocument();
    expect(logged.events.map((e) => e.action)).toContain("compare_reset");
    act(() => undo.last!.revert());
    expect(storedPins()).toEqual(["s1"]);
    expect(screen.getByText("1 of 5 compared")).toBeInTheDocument();
  });
});

describe("ratings", () => {
  it("are saved to the sprint's series, and an unscored dimension stays absent", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s3"]));
    seed(ALL, [{ id: "s3", days: [{ day: 1, remaining: 20 }] }]);
    render(<SprintCompareClient />);

    // Velocity is computed now: there's no box to type it into.
    expect(screen.queryByRole("spinbutton", { name: "Velocity for Sprint 3" })).toBeNull();
    const happiness = screen.getByRole("spinbutton", { name: "Team Happiness for Sprint 3" });
    expect(happiness).toHaveValue(null); // empty: not rated
    fireEvent.change(happiness, { target: { value: "8" } });
    fireEvent.blur(happiness);

    expect(seriesOf("s3")?.ratings).toEqual({ "Team Happiness": 8 });
    // The rest of the series is kept.
    expect(seriesOf("s3")?.days).toEqual([{ day: 1, remaining: 20 }]);
    // The dimensions with nothing to go on show as not scored, not as a default.
    expect(screen.getByRole("spinbutton", { name: "Quality for Sprint 3" })).toHaveValue(null);
    const table = screen.getByRole("table");
    // Quality, Scope Stability and Goal Achievement.
    expect(within(table).getAllByText("Not scored")).toHaveLength(3);
  });

  it("checks 1-10 instead of clamping, and clearing a box removes the rating", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s3"]));
    seed(ALL, [rated("s3", { Quality: 6, Velocity: 7 })]);
    render(<SprintCompareClient />);

    const quality = screen.getByRole("spinbutton", { name: "Quality for Sprint 3" });
    fireEvent.change(quality, { target: { value: "14" } });
    fireEvent.blur(quality);
    expect(screen.getByRole("alert")).toHaveTextContent("Rate 1 to 10.");
    expect(seriesOf("s3")?.ratings).toEqual({ Quality: 6, Velocity: 7 });

    fireEvent.change(quality, { target: { value: "" } });
    fireEvent.blur(quality);
    // A rating typed for a computed dimension before is kept, never deleted.
    expect(seriesOf("s3")?.ratings).toEqual({ Velocity: 7 });
  });

  it("'Rate' chooses the sprint for every sprint tool and opens it for rating", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s3"]));
    seed(ALL);
    render(<SprintCompareClient />);
    fireEvent.click(screen.getByRole("button", { name: "Rate Sprint 1" }));
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBe("s1");
    expect(screen.getByText("Not in the comparison")).toBeInTheDocument();
    // The first box the team rates.
    const box = screen.getByRole("spinbutton", { name: "Quality for Sprint 1" });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "5" } });
    fireEvent.blur(box);
    expect(seriesOf("s1")?.ratings).toEqual({ Quality: 5 });
    // Rating a sprint doesn't pin it.
    expect(storedPins()).toEqual(["s3"]);
  });

  it("shows the velocity from the shared sprint", () => {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s3"]));
    seed(ALL);
    render(<SprintCompareClient />);
    expect(screen.getAllByText("Velocity: 23 of 30 points").length).toBeGreaterThan(0);
  });
});

describe("example", () => {
  it("is a read-only preview that writes nothing", () => {
    seed([], []);
    render(<SprintCompareClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start your own" })).toBeInTheDocument();
    const boxes = screen.getAllByRole("spinbutton");
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) expect(b).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Pin / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rate / })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();

    expect(useWorkspaceStore.getState().sprints).toEqual([]);
    expect(useWorkspaceStore.getState().sprintSeries).toEqual([]);
    expect(storedPins()).toBeNull();
    expect(window.localStorage.getItem(SELECTED_SPRINT_KEY)).toBeNull();
    expect(logged.events).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No sprints yet/)).toBeInTheDocument();
  });

  it("'Start your own' creates a real sprint and pins it", () => {
    seed([], []);
    render(<SprintCompareClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Start your own" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "Sprint 1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    const [created] = useWorkspaceStore.getState().sprints;
    expect(created?.name).toBe("Sprint 1");
    expect(storedPins()).toEqual([created.id]);
    expect(screen.queryByText("Example data.")).not.toBeInTheDocument();
  });
});

describe("while old data is being moved", () => {
  it("shows Loading sprints… instead of the empty state", () => {
    seed([], []);
    useSprintMigrationStore.setState({ status: "pending" });
    render(<SprintCompareClient />);
    expect(screen.getByText("Loading sprints…")).toBeInTheDocument();
    expect(screen.queryByText(/No sprints yet/)).not.toBeInTheDocument();
  });

  it("picks up the pins the migration wrote once it finishes", () => {
    seed(ALL);
    useSprintMigrationStore.setState({ status: "pending" });
    render(<SprintCompareClient />);
    window.localStorage.setItem(PINS_KEY, JSON.stringify(["s1", "s2"]));
    act(() => useSprintMigrationStore.setState({ status: "done" }));
    expect(screen.getByText("2 of 5 compared")).toBeInTheDocument();
  });
});

describe("exports", () => {
  // Sprint 1 rated its Quality; Sprint 2 is still running.
  const sprints = [S1, { ...S2, status: "active" as const, pointsCompleted: undefined }, S3, S4];
  const scores = scoresBySprint(sprints, {
    stories: [],
    series: [rated("s1", { Velocity: 6, Quality: 8 })],
  });
  const rows = buildRows(["s2", "s1"], sprints, scores);

  it("orders the comparison oldest first", () => {
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("Markdown shows the scores, a dash for unscored ones, and where each came from", () => {
    const md = toMarkdown(rows, new Date(2026, 9, 19));
    expect(md).toContain("| Dimension | Sprint 1 | Sprint 2 |");
    // 21 of the team's best 24 points: computed, so the old typed 6 isn't used.
    expect(md).toContain("| Velocity | 8.9 | – |");
    expect(md).toContain("| Quality | 8 | – |");
    expect(md).toContain("| Scope Stability | – | – |");
    expect(md).toContain("| Points done | 21 of 30 points | – |");
    expect(md).toContain("- **Quality:** Rated by the team");
    expect(md).toContain("- **Velocity:** From Velocity · 21 points against the team's best");
  });

  it("AI prompts don't count unscored dimensions as zero", () => {
    const prompts = generateSprintComparePrompts({
      sprints: rows.map((r) => ({ name: r.name, scores: scoredValues(r.scores) })),
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0].prompt).toContain("not rated");
    expect(prompts[0].prompt).toContain("Strongest average dimension: Velocity (8.9)");
    expect(generateSprintComparePrompts({ sprints: [{ name: "A", scores: {} }] })).toEqual([]);
  });
});
