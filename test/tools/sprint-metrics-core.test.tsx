import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStore } from "@/lib/sprints/migration-status";

/**
 * Sprint Metrics gap-filling: the data-quality nudges on their own (overflow
 * of other sprints, which button calls what), the remembered "Looks right"
 * checks (pre-stored, unreadable, capped), the export file name and the
 * New sprint button. The hub's main paths are in sprint-metrics-hub.test.
 */

const exported = vi.hoisted(() => ({ filename: "" }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ filename }: { filename: string }) => {
    exported.filename = filename;
    return null;
  },
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import {
  CHECKED_SPRINTS_KEY,
  SprintMetricsClient,
} from "@/app/(tools)/sprint-metrics/sprint-metrics-client";
import { Nudges } from "@/app/(tools)/sprint-metrics/components/nudges";
import { SPRINT_TOOLS, SprintToolCards } from "@/app/(tools)/sprint-metrics/components/tool-cards";

const sprint = (n: number, patch: Partial<Sprint> = {}): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: "2026-10-15",
  endDate: "2026-10-25",
  pointsPlanned: 30,
  status: "active",
  ...patch,
});

/* ── Nudges ────────────────────────────────────────────────────────────── */

describe("Nudges", () => {
  const handlers = () => ({
    onAddPoints: vi.fn(),
    onSetDates: vi.fn(),
    onCheckDetails: vi.fn(),
    onLooksRight: vi.fn(),
    onSelect: vi.fn(),
  });

  it("renders nothing with nothing to check", () => {
    const { container } = render(
      <Nudges sprint={sprint(1)} series={undefined} nudges={[]} others={[]} {...handlers()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names five other sprints and counts the rest", () => {
    const h = handlers();
    const others = Array.from({ length: 7 }, (_, i) => sprint(i + 2));
    render(<Nudges sprint={sprint(1)} series={undefined} nudges={[]} others={others} {...h} />);
    expect(screen.getByText("Sprints to check:")).toBeInTheDocument();
    for (const n of [2, 3, 4, 5, 6]) {
      expect(screen.getByRole("button", { name: `Sprint ${n}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Sprint 7" })).toBeNull();
    expect(screen.getByText("and 2 more")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sprint 4" }));
    expect(h.onSelect).toHaveBeenCalledWith("s4");
  });

  it("wires each fix to its own button, and calls the others 'other' sprints", () => {
    const h = handlers();
    render(
      <Nudges
        sprint={sprint(1, { name: "Old one" })}
        series={{ id: "s1", migratedFrom: ["sprint-compare"] }}
        nudges={["no-points", "synthetic-dates", "migrated"]}
        others={[sprint(2)]}
        {...h}
      />
    );
    expect(screen.getByRole("heading", { name: "Worth checking" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Other sprints to check:")).toBeInTheDocument();
    expect(screen.getByText(/Old one was made from your earlier/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add completed points" }));
    fireEvent.click(screen.getByRole("button", { name: "Set real dates" }));
    fireEvent.click(screen.getByRole("button", { name: "Check this sprint's details" }));
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(h.onAddPoints).toHaveBeenCalledTimes(1);
    expect(h.onSetDates).toHaveBeenCalledTimes(1);
    expect(h.onCheckDetails).toHaveBeenCalledTimes(1);
    expect(h.onLooksRight).toHaveBeenCalledTimes(1);
    expect(h.onSelect).not.toHaveBeenCalled();
  });
});

describe("SprintToolCards", () => {
  it("lists the five sprint tools in order, plain links without a sprint", () => {
    const status = {
      burndown: "a",
      burnup: "b",
      velocity: "c",
      "sprint-compare": "d",
      "release-planner": "e",
    };
    render(<SprintToolCards sprintId={undefined} status={status} />);
    const links = within(screen.getByRole("region", { name: "Sprint tools" })).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/burndown",
      "/burnup",
      "/velocity",
      "/sprint-compare",
      "/release-planner",
    ]);
    expect(links[0]).toHaveTextContent(
      `${SPRINT_TOOLS.burndown.name}${SPRINT_TOOLS.burndown.blurb}a`
    );
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const MIGRATED: SprintSeries = { id: "s2", migratedFrom: ["burndown"] };

function seed(sprints: Sprint[], series: SprintSeries[] = []) {
  useWorkspaceStore.setState({ sprints, sprintSeries: series });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 12, 0, 0));
  exported.filename = "";
  resetSelectedSprint();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/sprint-metrics");
  useSprintMigrationStore.setState({ status: "idle" });
  seed([sprint(2)], [MIGRATED]);
});
afterEach(() => {
  vi.useRealTimers();
  seed([], []);
});

describe("remembered checks", () => {
  it("hides the migration nudge for a sprint checked on an earlier visit", () => {
    window.localStorage.setItem(CHECKED_SPRINTS_KEY, JSON.stringify(["s2"]));
    render(<SprintMetricsClient />);
    expect(screen.queryByText(/made from your earlier/)).toBeNull();
  });

  it("shows the nudge again when the stored checks can't be read", () => {
    window.localStorage.setItem(CHECKED_SPRINTS_KEY, "{not json");
    const { unmount } = render(<SprintMetricsClient />);
    expect(screen.getByText(/made from your earlier Burndown data/)).toBeInTheDocument();
    unmount();

    window.localStorage.setItem(CHECKED_SPRINTS_KEY, JSON.stringify({ s2: true }));
    render(<SprintMetricsClient />);
    expect(screen.getByText(/made from your earlier Burndown data/)).toBeInTheDocument();
  });

  it("ignores stored entries that aren't ids", () => {
    window.localStorage.setItem(CHECKED_SPRINTS_KEY, JSON.stringify([2, null, "s2"]));
    render(<SprintMetricsClient />);
    expect(screen.queryByText(/made from your earlier/)).toBeNull();
  });

  it("keeps the newest 200 checks", () => {
    const old = Array.from({ length: 200 }, (_, i) => `old-${i}`);
    window.localStorage.setItem(CHECKED_SPRINTS_KEY, JSON.stringify(old));
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    const stored = JSON.parse(window.localStorage.getItem(CHECKED_SPRINTS_KEY) ?? "[]");
    expect(stored).toHaveLength(200);
    expect(stored[199]).toBe("s2");
    expect(stored).not.toContain("old-0");
    expect(screen.queryByText(/made from your earlier/)).toBeNull();
  });
});

describe("the toolbar", () => {
  it("names the export after the sprint", () => {
    seed([sprint(2, { name: "Sprint #2: Checkout!" })]);
    const { unmount } = render(<SprintMetricsClient />);
    expect(exported.filename).toBe("sprint-sprint-2-checkout");
    unmount();
    seed([sprint(2, { name: "!!!" })]);
    render(<SprintMetricsClient />);
    expect(exported.filename).toBe("sprint-sprint");
  });

  it("opens the new-sprint dialog with the next name", () => {
    render(<SprintMetricsClient />);
    fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Sprint 3");
  });
});
