import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useDockTimer } from "@/lib/timer/dock-timer";

/**
 * Standup speaker Shuffle (G03): the day's order shuffled with a seed made
 * from the date, so a reload and every screen show the same order; "Back to
 * roster order" undoes it; the next day starts in roster order; the board
 * walk follows the order shown and keeps its own controls.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn(() => "toast-1"),
    { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }
  )
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: vi.fn() }),
}));

import { SHUFFLE_KEY, StandupClient } from "@/app/(tools)/standup/standup-client";
import {
  NOT_SHUFFLED,
  shuffledOn,
  shuffledOrder,
  speakingOrder,
} from "@/app/(tools)/standup/model";
import { resetStandupWalk } from "@/app/(tools)/standup/walk";

vi.setConfig({ testTimeout: 20_000 });

const TODAY = todayLocalISO();
const TEAM = ["Alice", "Bo", "Cy", "Dee", "Eve", "Finn"];

function renderStandup() {
  return render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <StandupClient mode="live" />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
}

const shown = () =>
  within(screen.getByRole("list", { name: "Speaking order" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".truncate")?.textContent ?? "");
const announced = () => screen.getByTestId("live-polite").textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSelectedSprint();
  resetStandupWalk();
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({
    teamMembers: TEAM.map((name, i) => ({ id: `m${i}`, name })),
    standupEntries: [],
    asyncUpdates: [],
    sprints: [],
    stories: [],
    impediments: [],
  });
});

describe("shuffledOrder", () => {
  it("gives the same order for the same day, whatever order it starts in", () => {
    const a = shuffledOrder(TEAM, "2026-11-12");
    expect(shuffledOrder([...TEAM].reverse(), "2026-11-12")).toEqual(a);
    expect([...a].sort()).toEqual([...TEAM].sort());
    expect(a).not.toEqual(TEAM);
  });

  it("gives another order on another day", () => {
    const days = ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    const orders = new Set(days.map((d) => shuffledOrder(TEAM, d).join(",")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("moves nobody else when someone is out, and ignores case and spaces", () => {
    const all = shuffledOrder(TEAM, "2026-11-12");
    const without = shuffledOrder(
      TEAM.filter((n) => n !== "Cy"),
      "2026-11-12"
    );
    expect(without).toEqual(all.filter((n) => n !== "Cy"));
    expect(
      shuffledOrder([" alice", "BO", "cy "], "2026-11-12").map((n) => n.trim().toLowerCase())
    ).toEqual(shuffledOrder(["Alice", "Bo", "Cy"], "2026-11-12").map((n) => n.toLowerCase()));
  });

  it("never hands back the order it was given", () => {
    for (const d of ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]) {
      expect(shuffledOrder(["Alice", "Bo"], d)).not.toEqual(["Alice", "Bo"]);
    }
    expect(shuffledOrder(["Alice"], "2026-11-12")).toEqual(["Alice"]);
    expect(shuffledOrder([], "2026-11-12")).toEqual([]);
  });

  it("counts a shuffle for its own day only", () => {
    expect(shuffledOn({ date: TODAY, on: true }, TODAY)).toBe(true);
    expect(shuffledOn({ date: addDays(TODAY, -1), on: true }, TODAY)).toBe(false);
    expect(shuffledOn(NOT_SHUFFLED, TODAY)).toBe(false);
    expect(shuffledOn(null, TODAY)).toBe(false);
  });
});

describe("Shuffle on the standup page", () => {
  it("shuffles the speaking order for today, and goes back to roster order", async () => {
    renderStandup();
    expect(shown()).toEqual(TEAM);
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    const expected = shuffledOrder(speakingOrder(TEAM, [], TODAY, []), TODAY);
    expect(shown()).toEqual(expected);
    expect(
      screen.getByText(/Shuffled for today: the same order on every reload/)
    ).toBeInTheDocument();
    await waitFor(() => expect(announced()).toBe("Speaking order shuffled for today"));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SHUFFLE_KEY) ?? "null")).toEqual({
        date: TODAY,
        on: true,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Back to roster order" })).toHaveFocus()
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to roster order" }));
    expect(shown()).toEqual(TEAM);
    await waitFor(() => expect(announced()).toBe("Speaking order back in roster order"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Shuffle" })).toHaveFocus());
  });

  it("shows the same shuffled order after a reload", async () => {
    localStorage.setItem(SHUFFLE_KEY, JSON.stringify({ date: TODAY, on: true }));
    renderStandup();
    await waitFor(() => expect(shown()).toEqual(shuffledOrder(TEAM, TODAY)));
    expect(screen.getByRole("button", { name: "Back to roster order" })).toBeInTheDocument();
  });

  it("starts the next day in roster order", async () => {
    localStorage.setItem(SHUFFLE_KEY, JSON.stringify({ date: addDays(TODAY, -1), on: true }));
    renderStandup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Shuffle" })).toBeInTheDocument()
    );
    expect(shown()).toEqual(TEAM);
  });

  it("walks the board in the shuffled order, with the shuffle held while it runs", () => {
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    const order = shuffledOrder(TEAM, TODAY);
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    expect(screen.getByText(/Speaking now · turn 1 of 6/).nextSibling).toHaveTextContent(order[0]);
    // Mid-walk the order stays put: no Shuffle, no going back.
    expect(screen.queryByRole("button", { name: "Shuffle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to roster order" })).toBeNull();
    expect(screen.getByText(/Shuffled for today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next speaker" }));
    expect(screen.getByText(/Speaking now · turn 2 of 6/).nextSibling).toHaveTextContent(order[1]);
    fireEvent.click(screen.getByRole("button", { name: "End standup" }));
    expect(screen.getByRole("button", { name: "Back to roster order" })).toBeInTheDocument();
  });

  it("offers no Shuffle with one person to call on", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Alice" }] });
    renderStandup();
    expect(screen.queryByRole("button", { name: "Shuffle" })).toBeNull();
  });
});
