/**
 * A story's page sends its question to the retro, counts the story as read
 * once its end has been reached, and suggests a tool for its theme.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  dispatched: [] as { name: string; meta?: Record<string, unknown> }[],
  hydrated: true,
}));

vi.mock("@/lib/gamification/engine", () => ({
  dispatch: (event: { name: string; meta?: Record<string, unknown> }) => h.dispatched.push(event),
}));
vi.mock("@/lib/team/use-team-roster", () => ({ useWorkspaceHydrated: () => h.hydrated }));

import {
  DiscussInRetro,
  READ_DWELL_MS,
  ReadTracker,
} from "@/app/(tools)/comics/components/story-actions";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { hasRead, sentLinks } from "@/lib/comics/reading";
import { THEME_TOOLS, toolForThemes } from "@/lib/comics/try-tool";
import { getToolById } from "@/lib/constants/tools";
import { sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import { RETRO_BOARD_ID } from "@/lib/handoffs/targets/retro-board";
import { THEME_LABELS } from "@/lib/comics/themes";
import { isShelved } from "@/lib/tools/catalog";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const QUESTION = "What can wait so the first job can finish?";

const board = () =>
  (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === RETRO_BOARD_ID);

/** IntersectionObserver as jsdom lacks it: `show(true)` puts the end on screen. */
let show: (visible: boolean) => void = () => {};
class FakeObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {
    show = (visible) =>
      this.cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as never);
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  localStorage.clear();
  h.dispatched = [];
  h.hydrated = true;
  useWorkspaceStore.setState({ retroBoards: [] });
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useMascotStore.setState({ ready: false, reactionQueue: [] });
});

describe("Discuss in your retro", () => {
  it("puts the story's question on the current retro, linked back to the story", () => {
    render(<DiscussInRetro ep={1} question={QUESTION} />);
    fireEvent.click(screen.getByRole("button", { name: "Discuss in your retro" }));
    const [card] = board()!.cards;
    expect(card).toMatchObject({ text: QUESTION, columnKey: "start", isActionItem: false });
    expect(sourceLabel(card.sourceRef)).toBe("From Agile at Work");
    expect(sourceHref(card.sourceRef)).toBe("/comics?ep=1");
    expect(sentLinks(1)).toHaveLength(1);
    expect(h.dispatched).toEqual([{ name: "tool:comics:retro-question", meta: { ep: 1 } }]);
  });

  it("then says it's there and opens the retro, instead of sending it twice", () => {
    render(<DiscussInRetro ep={1} question={QUESTION} />);
    fireEvent.click(screen.getByRole("button", { name: "Discuss in your retro" }));
    expect(screen.getByRole("link", { name: "In your retro: open it" })).toHaveAttribute(
      "href",
      "/retro"
    );
    cleanup();
    render(<DiscussInRetro ep={1} question={QUESTION} />);
    expect(screen.queryByRole("button", { name: "Discuss in your retro" })).toBeNull();
    expect(board()!.cards).toHaveLength(1);
  });

  it("can be sent again once the card is gone from the board", () => {
    render(<DiscussInRetro ep={1} question={QUESTION} />);
    fireEvent.click(screen.getByRole("button", { name: "Discuss in your retro" }));
    act(() => useWorkspaceStore.setState({ retroBoards: [] }));
    cleanup();
    render(<DiscussInRetro ep={1} question={QUESTION} />);
    expect(screen.getByRole("button", { name: "Discuss in your retro" })).toBeEnabled();
  });

  it("waits for the workspace to load, so it can't miss a card already sent", () => {
    h.hydrated = false;
    render(<DiscussInRetro ep={1} question={QUESTION} />);
    expect(screen.getByRole("button", { name: "Discuss in your retro" })).toBeDisabled();
  });
});

describe("reading a story", () => {
  it("counts it once its end has been on screen with the page open for a while", () => {
    vi.useFakeTimers();
    useMascotStore.setState({ ready: true, reactionQueue: [] });
    render(<ReadTracker ep={30} />);
    act(() => show(true));
    act(() => vi.advanceTimersByTime(READ_DWELL_MS - 1));
    expect(hasRead(30)).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(hasRead(30)).toBe(true);
    expect(h.dispatched).toEqual([
      { name: "tool:comics:completed", meta: { ep: 30, total: 1, weekStreak: 1 } },
    ]);
    expect(useMascotStore.getState().reactionQueue).toEqual(["excited"]);
  });

  it("doesn't count an end that scrolled away before the wait was over", () => {
    vi.useFakeTimers();
    render(<ReadTracker ep={30} />);
    act(() => show(true));
    act(() => vi.advanceTimersByTime(1000));
    act(() => show(false));
    act(() => vi.advanceTimersByTime(READ_DWELL_MS));
    expect(hasRead(30)).toBe(false);
  });

  it("counts a story read before only once", () => {
    vi.useFakeTimers();
    render(<ReadTracker ep={30} />);
    act(() => show(true));
    act(() => vi.advanceTimersByTime(READ_DWELL_MS));
    cleanup();
    render(<ReadTracker ep={30} />);
    act(() => show(true));
    act(() => vi.advanceTimersByTime(READ_DWELL_MS));
    expect(h.dispatched.filter((e) => e.name === "tool:comics:completed")).toHaveLength(1);
  });

  it("leaves Amr alone while he isn't on screen", () => {
    vi.useFakeTimers();
    render(<ReadTracker ep={30} />);
    act(() => show(true));
    act(() => vi.advanceTimersByTime(READ_DWELL_MS));
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });
});

describe("a tool for the story's theme", () => {
  it("has one for each of the twelve themes, never shelved or for VIPs only", () => {
    expect(Object.keys(THEME_TOOLS).sort()).toEqual(Object.keys(THEME_LABELS).sort());
    for (const id of Object.values(THEME_TOOLS)) {
      const tool = getToolById(id);
      expect(tool, id).toBeDefined();
      expect(isShelved(tool!), id).toBe(false);
      expect(tool!.access, id).toBeUndefined();
      expect(tool!.kind ?? "tool", id).toBe("tool");
    }
  });

  it("takes the first theme that has a tool", () => {
    expect(toolForThemes(["T99", "T10", "T02"])?.id).toBe("decision-log");
    expect(toolForThemes(["T99"])).toBeNull();
    expect(toolForThemes([])).toBeNull();
  });
});
