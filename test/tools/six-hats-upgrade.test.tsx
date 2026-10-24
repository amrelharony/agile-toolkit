import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision, SixHatsSession, SixHatsThought } from "@/lib/stores/workspace-types";
import { countdown, useDockTimer } from "@/lib/timer/dock-timer";
import { DECISION_LOG_KEY } from "@/lib/handoffs/targets/decision";
import { DEFAULT_HAT_ORDER } from "@/lib/actions/tools/six-hats";

/**
 * Six Thinking Hats' upgrade to the tool UX contract: sessions with a
 * topic and an editable hat order, timed hat-by-hat rounds on the docked
 * timer (never replacing another page's clock), thoughts that follow the
 * hat being worn, edit in place, delete with Undo (a session takes its
 * thoughts with it), the earlier thoughts from before sessions, the
 * Blue-hat summary sent to a decision record, the verdict, the Markdown
 * record, the example and theme colours only.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() })
);
const spies = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, filename }: { markdown?: string; filename: string }) => (
    <pre data-testid={`export-${filename}`}>{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log, toolRunId: "test" }),
}));

import { SixHatsClient } from "@/app/(tools)/six-hats/six-hats-client";
import { buildExample, EXAMPLE_SESSION_ID } from "@/app/(tools)/six-hats/example";
import { toMarkdown } from "@/app/(tools)/six-hats/markdown";
import { balanceSentence, sixHatsVerdict } from "@/app/(tools)/six-hats/verdict";
import { HATS, hatInfo, isHat } from "@/app/(tools)/six-hats/hats";
import {
  DEFAULT_ORDER,
  ORDER_MAX,
  adoptedSession,
  byHat,
  closed,
  currentHat,
  earlierThoughts,
  editedRound,
  editedSession,
  emptySessionDraft,
  halfTimeHint,
  hatColumns,
  isAdoptedSession,
  isRoundClock,
  moveHat,
  nextRound,
  pickSession,
  prevRound,
  removeHatAt,
  reopened,
  roundDock,
  roundsLeft,
  sameRoundIn,
  sessionRun,
  sessionStatus,
  sessionThoughts,
  validateSession,
  validateSummary,
  validateThought,
  wornAfterMove,
  wornAfterRemove,
} from "@/app/(tools)/six-hats/session";

const ws = () => useWorkspaceStore.getState();
const sessions = () => ws().sixHatsSessions ?? [];
const thoughts = () => ws().sixHatsThoughts ?? [];
const sessionById = (id: string) => sessions().find((x) => x.id === id)!;
const dock = () => useDockTimer.getState().timer;
const lastToast = () =>
  toastSpy.mock.calls.at(-1) as unknown as [string, { action: { onClick: () => void } }];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const live = () => screen.getByTestId("live-polite");
const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
const decisionBlob = (): Decision[] => JSON.parse(localStorage.getItem(DECISION_LOG_KEY) ?? "[]");

const session = (over: Partial<SixHatsSession> = {}): SixHatsSession => ({
  id: "s1",
  topic: "Adopt trunk-based development?",
  order: [...DEFAULT_ORDER],
  roundMinutes: 5,
  startedAt: "2026-10-20T09:00:00.000Z",
  ...over,
});

let clock = 0;
const thought = (
  id: string,
  hat: SixHatsThought["hat"],
  text: string,
  over: Partial<SixHatsThought> = {}
): SixHatsThought => {
  clock += 1;
  return {
    id,
    hat,
    text,
    loggedAt: new Date(Date.UTC(2026, 9, 20, 9, clock)).toISOString(),
    sessionId: "s1",
    ...over,
  };
};

function seed(s: SixHatsSession[], t: SixHatsThought[] = []) {
  useWorkspaceStore.setState({ sixHatsSessions: s, sixHatsThoughts: t });
}

const renderHats = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <SixHatsClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

const thoughtBox = () => screen.getByRole("textbox", { name: "Thought" });
const hatRadio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name} hat`) });

beforeEach(() => {
  toastSpy.mockReset();
  spies.log.mockReset();
  localStorage.clear();
  clock = 0;
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({ sixHatsSessions: [], sixHatsThoughts: [], decisions: [] });
});

/* ── Starting a session ── */

describe("starting a session", () => {
  it("saves nothing until the topic and minutes are filled in, and says what's missing", () => {
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(sessions()).toEqual([]);
    expect(screen.getByText("Enter the question the team will think about.")).toBeInTheDocument();
    expect(screen.getByText("Enter the minutes for each round.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Topic/)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(/^Topic/), {
      target: { value: "  Weekly   releases? " },
    });
    fireEvent.change(screen.getByLabelText(/Minutes per round/), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    expect(sessions()).toEqual([]);
    expect(screen.getByText("A round runs from 1 to 30 minutes.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Minutes per round/), { target: { value: "4" } });
    fireEvent.submit(screen.getByLabelText(/^Topic/).closest("form")!);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]).toMatchObject({
      topic: "Weekly releases?",
      order: DEFAULT_ORDER,
      roundMinutes: 4,
    });
    expect(sessions()[0].currentRound).toBeUndefined();
    // Nothing starts by itself: the rounds wait for a click.
    expect(dock()).toBeNull();
    expect(screen.getByRole("button", { name: "Start round 1" })).toBeInTheDocument();
    expect(spies.log).toHaveBeenCalledWith(
      "session_started",
      expect.objectContaining({ rounds: 7 })
    );
  });

  it("starts from the common order the agents use, and the order can be edited hat by hat", async () => {
    expect([...DEFAULT_ORDER]).toEqual([...DEFAULT_HAT_ORDER]);
    renderHats();
    const order = () =>
      within(screen.getByRole("list", { name: "Order of the hats" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace(/\s+/g, " ").match(/[A-Z][a-z]+/)?.[0]);
    expect(order()).toEqual(["Blue", "White", "Green", "Yellow", "Black", "Red", "Blue"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Black hat, round 5 earlier" }));
    expect(order()).toEqual(["Blue", "White", "Green", "Black", "Yellow", "Red", "Blue"]);
    // Focus follows the hat to its new place.
    await act(() => Promise.resolve());
    expect(screen.getByRole("button", { name: "Move Black hat, round 4 earlier" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Remove Red hat, round 6" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Green hat" }));
    expect(order()).toEqual(["Blue", "White", "Green", "Black", "Yellow", "Blue", "Green"]);
    fireEvent.click(screen.getByRole("button", { name: "Use the common order" }));
    expect(order()).toEqual(["Blue", "White", "Green", "Yellow", "Black", "Red", "Blue"]);
  });

  it("keeps at least one hat and at most twelve rounds", () => {
    renderHats();
    for (let i = 7; i > 1; i--) {
      fireEvent.click(screen.getAllByRole("button", { name: /^Remove .* round 1$/ })[0]);
    }
    expect(
      screen.getByRole("button", {
        name: "Remove Blue hat, round 1 (a session needs at least one hat)",
      })
    ).toBeDisabled();
    // The last Remove is disabled now, so focus moves on to adding a hat.
    expect(screen.getByRole("button", { name: "Add White hat" })).toHaveFocus();
    for (let i = 1; i < ORDER_MAX; i++)
      fireEvent.click(screen.getByRole("button", { name: "Add Red hat" }));
    expect(screen.getByRole("button", { name: "Add Red hat" })).toBeDisabled();
    expect(screen.getByText(/most rounds a session can have \(12\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Red hat, round 12" })).toHaveFocus();
  });

  it("edits a session in place, moving a round past a shortened order to the last one", () => {
    seed([session({ currentRound: 6 })]);
    renderHats();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit session “Adopt trunk-based development?”" })
    );
    expect(screen.getByLabelText(/^Topic/)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Remove Blue hat, round 7" }));
    fireEvent.change(screen.getByLabelText(/Minutes per round/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sessionById("s1")).toMatchObject({ roundMinutes: 3, currentRound: 5 });
    expect(sessionById("s1").order).toHaveLength(6);
  });

  const editButton = () =>
    screen.getByRole("button", { name: "Edit session “Adopt trunk-based development?”" });
  const orderRows = () =>
    within(screen.getByRole("list", { name: "Order of the hats" })).getAllByRole("listitem");

  it("keeps the hat being worn when a hat before it goes, and its clock follows the round", async () => {
    seed([session({ currentRound: 2, summary: "Go." })]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Time this round" }));
    expect(dock()!.label).toBe("Six Hats · Green hat (3/7)");
    const endsAt = dock()!.endsAt;

    fireEvent.click(editButton());
    expect(orderRows()[2]).toHaveTextContent(/Green.*being worn/);
    fireEvent.click(screen.getByRole("button", { name: "Remove Blue hat, round 1" }));
    expect(orderRows()[1]).toHaveTextContent(/Green.*being worn/);
    fireEvent.click(screen.getByRole("button", { name: "Move Green hat, round 2 later" }));
    expect(orderRows()[2]).toHaveTextContent(/Green.*being worn/);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(sessionById("s1").currentRound).toBe(2);
    expect(currentHat(sessionById("s1"))).toBe("green");
    expect(hatRadio("Green")).toHaveAttribute("aria-checked", "true");
    // The same clock, renamed for the round's new place, so the page still owns it.
    expect(dock()).toMatchObject({ label: "Six Hats · Green hat (3/6)", endsAt });
    expect(screen.getByRole("timer")).toBeInTheDocument();
    await waitFor(() => expect(editButton()).toHaveFocus());

    // And closing the session can still stop it.
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));
    expect(dock()).toBeNull();
  });

  it("when the round being worn is removed, moves to the one in its place, stops its clock and says so", async () => {
    seed([session({ currentRound: 2 })]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Time this round" }));
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: "Remove Green hat, round 3" }));
    expect(screen.getByText(/The round being worn is removed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(sessionById("s1").currentRound).toBe(2);
    expect(currentHat(sessionById("s1"))).toBe("yellow");
    expect(dock()).toBeNull();
    await waitFor(() =>
      expect(live()).toHaveTextContent(
        "Session saved. The Green hat round was removed, so it's Round 3 of 6: Yellow hat now; its clock is stopped."
      )
    );
  });

  it("returns focus to Edit session after Save, Cancel or Escape, and to New session after its Cancel", async () => {
    seed([session()]);
    renderHats();
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(editButton()).toHaveFocus());
    fireEvent.click(editButton());
    fireEvent.keyDown(screen.getByLabelText(/^Topic/), { key: "Escape" });
    await waitFor(() => expect(editButton()).toHaveFocus());
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(editButton()).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "New session" })).toHaveFocus());
  });

  it("keeps focus in the hat order when the row or the button used goes", async () => {
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Remove Blue hat, round 7" }));
    await act(() => Promise.resolve());
    expect(screen.getByRole("button", { name: "Remove Red hat, round 6" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Use the common order" }));
    await act(() => Promise.resolve());
    expect(screen.getByRole("button", { name: "Add White hat" })).toHaveFocus();
  });

  it("opens an agent's session (no round yet, thoughts already in it) as not started", () => {
    seed([session()], [thought("t1", "white", "Builds take 40 minutes.")]);
    renderHats();
    expect(screen.getByText(/^Not started\./)).toBeInTheDocument();
    // Not "Started … · not started".
    expect(screen.getByText(/^Created .+ · 1 thought · not started$/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "White hat" })).getByText("Builds take 40 minutes.")
    );
    // Outside a round no hat is picked for the next thought.
    for (const h of HATS) expect(hatRadio(h.name)).toHaveAttribute("aria-checked", "false");
  });
});

/* ── Rounds ── */

describe("rounds on the docked timer", () => {
  it("starts round 1 on the dock, moves hat by hat, and the current hat picks where thoughts go", async () => {
    seed([session()]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Start round 1" }));

    expect(sessionById("s1").currentRound).toBe(0);
    expect(dock()).toMatchObject({
      label: "Six Hats · Blue hat (1/7)",
      href: "/six-hats",
      totalSeconds: 300,
    });
    expect(dock()!.endsAt).not.toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent(/0[45]:\d\d/);
    expect(screen.getByText(/^Round 1 of 7: Blue hat, 0[45]:\d\d left\.$/)).toBeInTheDocument();
    await waitFor(() => expect(live()).toHaveTextContent("Round 1 of 7: Blue hat. 5 minutes."));
    expect(hatRadio("Blue")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Next hat: White" }));
    expect(sessionById("s1").currentRound).toBe(1);
    expect(dock()!.label).toBe("Six Hats · White hat (2/7)");
    expect(hatRadio("White")).toHaveAttribute("aria-checked", "true");
    expect(spies.log).toHaveBeenCalledWith(
      "round_advanced",
      expect.objectContaining({ round: 2, hat: "white", skipped: false })
    );

    fireEvent.change(thoughtBox(), { target: { value: "Merges to main take a day." } });
    fireEvent.keyDown(thoughtBox(), { key: "Enter" });
    expect(thoughts()).toEqual([
      expect.objectContaining({
        hat: "white",
        text: "Merges to main take a day.",
        sessionId: "s1",
      }),
    ]);
    expect(thoughtBox()).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Skip the White hat" }));
    expect(sessionById("s1").currentRound).toBe(2);
    await waitFor(() =>
      expect(live()).toHaveTextContent("Skipped the White hat. Round 3 of 7: Green hat. 5 minutes.")
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to White" }));
    expect(sessionById("s1").currentRound).toBe(1);
    expect(dock()!.label).toBe("Six Hats · White hat (2/7)");
    expect(screen.getByText(/^Started .+ · 1 thought · in progress$/)).toBeInTheDocument();

    // Back to round 1: the Back button goes, so focus moves to Next hat.
    fireEvent.click(screen.getByRole("button", { name: "Back to Blue" }));
    expect(sessionById("s1").currentRound).toBe(0);
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next hat: White" })).toHaveFocus()
    );
  });

  it("back from another tool, opens the session whose round is on the dock", () => {
    const timed = session({ id: "timed", topic: "Older, being timed", currentRound: 1 });
    seed([timed, session({ id: "newer", topic: "Newer", startedAt: "2026-10-22T09:00:00Z" })]);
    useDockTimer.setState({ timer: roundDock(timed) });
    renderHats();
    expect(screen.getByRole("heading", { name: "Older, being timed" }));
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(pickSession(sessions(), null, null)?.id).toBe("newer");
  });

  it("pauses and resumes the round from the page", () => {
    seed([session({ currentRound: 2 })]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Time this round" }));
    expect(dock()!.label).toBe("Six Hats · Green hat (3/7)");
    fireEvent.click(screen.getByRole("button", { name: "Pause the round's clock" }));
    expect(dock()!.endsAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume the round's clock" }));
    expect(dock()!.endsAt).not.toBeNull();
  });

  it("never replaces another page's docked timer without asking", async () => {
    useDockTimer.setState({ timer: countdown("Standup: Bo", "/standup", 60) });
    seed([session()]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Start round 1" }));
    expect(sessionById("s1").currentRound).toBe(0);
    expect(dock()!.label).toBe("Standup: Bo");
    expect(screen.getByText(/The docked timer is running “Standup: Bo”/)).toBeInTheDocument();
    // One announcement that says both, not a warning the round's own message replaces.
    const said = "Round 1 of 7: Blue hat, not timed: the docked timer is running “Standup: Bo”.";
    await waitFor(() => expect(live()).toHaveTextContent(said));
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(live()).toHaveTextContent(said);
    expect(live()).not.toHaveTextContent(/minutes/);

    fireEvent.click(screen.getByRole("button", { name: "Stop it and time this round" }));
    expect(dock()!.label).toBe("Six Hats · Blue hat (1/7)");
    expect(screen.queryByText(/The docked timer is running/)).toBeNull();
  });

  it("on the last round offers the summary instead of a next hat", () => {
    seed([session({ currentRound: 6 })]);
    renderHats();
    expect(screen.queryByRole("button", { name: /^Next hat/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Write the summary" }));
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveFocus();
  });

  it("shows the Red hat's half-time hint without changing the clock", () => {
    seed([session({ currentRound: 5 })]);
    renderHats();
    expect(screen.getByText(/about half the time \(2:30\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Time this round" }));
    expect(dock()!.totalSeconds).toBe(300);
  });
});

/* ── Thoughts ── */

describe("thoughts", () => {
  it("never saves a blank thought or one without a hat", () => {
    seed([session()]);
    renderHats();
    fireEvent.keyDown(thoughtBox(), { key: "Enter" });
    expect(thoughts()).toEqual([]);
    expect(screen.getByText("Write the thought first.")).toBeInTheDocument();
    expect(screen.getByText("Pick the hat this thought is under.")).toBeInTheDocument();
    // The first invalid control, the hat, gets focus.
    expect(hatRadio("White")).toHaveFocus();

    fireEvent.change(thoughtBox(), { target: { value: "Line one" } });
    fireEvent.keyDown(thoughtBox(), { key: "Enter", shiftKey: true });
    expect(thoughts()).toEqual([]);
    fireEvent.click(hatRadio("Black"));
    fireEvent.click(screen.getByRole("button", { name: "Log thought" }));
    expect(thoughts()).toEqual([expect.objectContaining({ hat: "black", text: "Line one" })]);
    // The next thought stays under the hat just used.
    expect(hatRadio("Black")).toHaveAttribute("aria-checked", "true");
  });

  it("edits a thought in place and moves it to another hat", async () => {
    seed(
      [session()],
      [thought("t1", "white", "Releases slip a week"), thought("t2", "red", "Anxious")]
    );
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Edit thought: Releases slip a week" }));
    const box = within(screen.getByRole("group", { name: "Edit thought" })).getByRole("textbox", {
      name: "Thought",
    });
    fireEvent.change(box, { target: { value: "Releases slip two weeks" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(thoughts().find((t) => t.id === "t1")!.text).toBe("Releases slip two weeks");
    await act(() => Promise.resolve());
    expect(
      screen.getByRole("button", { name: "Edit thought: Releases slip two weeks" })
    ).toHaveFocus();

    openMenu("Move to another hat: Anxious");
    expect(screen.getByRole("menuitem", { name: "Red hat (here now)" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Black hat" }));
    expect(thoughts().find((t) => t.id === "t2")!.hat).toBe("black");
    expect(within(screen.getByRole("region", { name: "Black hat" })).getByText("Anxious"));
    await waitFor(() => expect(live()).toHaveTextContent("Moved “Anxious” to the Black hat."));
    expect(spies.log).toHaveBeenCalledWith("hat_changed", { id: "t2", from: "red", to: "black" });
  });

  it("deletes a thought with Undo", () => {
    seed([session()], [thought("t1", "green", "Feature flags")]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Delete thought: Feature flags" }));
    expect(thoughts()).toEqual([]);
    expect(lastToast()[0]).toBe("Deleted “Feature flags”");
    undoLast();
    expect(thoughts().map((t) => t.id)).toEqual(["t1"]);
  });

  it("deletes a session with its thoughts, and one Undo brings both back", () => {
    seed(
      [
        session({ currentRound: 1 }),
        session({ id: "s2", topic: "Other", startedAt: "2026-10-01T09:00:00Z" }),
      ],
      [
        thought("t1", "white", "Fact"),
        thought("t2", "red", "Feeling"),
        thought("t3", "white", "Elsewhere", { sessionId: "s2" }),
      ]
    );
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Time this round" }));
    expect(dock()).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session “Adopt trunk-based development?”" })
    );
    expect(sessions().map((x) => x.id)).toEqual(["s2"]);
    expect(thoughts().map((t) => t.id)).toEqual(["t3"]);
    // Its round's clock goes with it.
    expect(dock()).toBeNull();
    expect(lastToast()[0]).toBe("Deleted “Adopt trunk-based development?”");
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();

    undoLast();
    expect(
      sessions()
        .map((x) => x.id)
        .sort()
    ).toEqual(["s1", "s2"]);
    expect(
      thoughts()
        .map((t) => t.id)
        .sort()
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("after deleting the last session, focus is on the Start form's topic", async () => {
    seed([session()]);
    renderHats();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session “Adopt trunk-based development?”" })
    );
    expect(sessions()).toEqual([]);
    await waitFor(() => expect(screen.getByLabelText(/^Topic/)).toHaveFocus());
  });
});

/* ── Earlier thoughts ── */

describe("earlier thoughts", () => {
  it("shows thoughts from before sessions, and orphans, and gives them a topic with Undo", async () => {
    seed(
      [],
      [
        thought("old1", "white", "We have no tests", { sessionId: undefined }),
        thought("old2", "black", "Risky", { sessionId: "gone" }),
        {
          id: "bad",
          hat: "purple",
          text: "Unknown hat",
          loggedAt: "2026-01-01T00:00:00Z",
        } as never,
      ]
    );
    renderHats();
    expect(screen.getByText("Earlier thoughts (2)")).toBeInTheDocument();
    // Orphans had a topic once, so the copy doesn't say they never did.
    expect(screen.getByText(/^2 thoughts in no session: logged before sessions existed, or left/));
    expect(
      within(screen.getByRole("region", { name: "Earlier thoughts: White hat" })).getByText(
        "We have no tests"
      )
    );
    expect(screen.queryByText("Unknown hat")).toBeNull();
    expect(screen.getByTestId("export-six-hats-earlier-thoughts").textContent).toContain(
      "# Six Thinking Hats — Earlier thoughts"
    );

    fireEvent.click(screen.getByRole("button", { name: "Give these a topic" }));
    expect(screen.getByText("Enter the topic these thoughts were about.")).toBeInTheDocument();
    expect(sessions()).toEqual([]);

    fireEvent.change(screen.getByLabelText(/Topic of these thoughts/), {
      target: { value: "Testing strategy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Give these a topic" }));
    expect(sessions()).toHaveLength(1);
    const made = sessions()[0];
    const [old1, old2] = thoughts().filter((t) => t.id === "old1" || t.id === "old2");
    // A past discussion: dated by its thoughts, closed, the hats as they came up.
    expect(made).toMatchObject({
      topic: "Testing strategy",
      startedAt: old1.loggedAt,
      closedAt: old2.loggedAt,
      order: ["white", "black"],
    });
    expect(made.currentRound).toBeUndefined();
    expect(isAdoptedSession(made)).toBe(true);
    expect(
      thoughts()
        .filter((t) => t.sessionId === made.id)
        .map((t) => t.id)
    ).toEqual(["old1", "old2"]);
    expect(screen.queryByText(/^Earlier thoughts/)).toBeNull();
    expect(lastToast()[0]).toBe("Made “Testing strategy” a session");
    // No rounds to start, no minutes it never had, and nowhere new to log a thought.
    expect(screen.queryByRole("button", { name: "Start round 1" })).toBeNull();
    expect(screen.queryByText(/× 5 min/)).toBeNull();
    expect(screen.getByText(/logged before sessions had timed rounds/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Thought" })).toBeNull();
    const md = screen.getByTestId("export-six-hats").textContent!;
    expect(md).toContain("before sessions had timed rounds.");
    expect(md).not.toMatch(/rounds of|\*\*Order:\*\*/);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit session “Testing strategy”" })).toHaveFocus()
    );

    undoLast();
    expect(sessions()).toEqual([]);
    expect(thoughts().find((t) => t.id === "old1")!.sessionId).toBeUndefined();
    expect(thoughts().find((t) => t.id === "old2")!.sessionId).toBe("gone");
  });
});

/* ── Summary and decision ── */

describe("the Blue-hat summary", () => {
  it("is needed to close, then goes to a decision record that Undo takes back", async () => {
    seed([session({ currentRound: 6 })], [thought("t1", "white", "Fact")]);
    renderHats();
    const send = () => screen.getByRole("button", { name: /^Send to… Adopt trunk-based/ });
    expect(send()).toBeDisabled();
    expect(screen.getByText("Write the summary first.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close session" }));
    expect(sessionById("s1").closedAt).toBeUndefined();
    expect(
      screen.getByText("Write the summary: what the team concluded and what happens next.")
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveFocus();

    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: " Try it for one sprint. " },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Summary" }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(sessionById("s1").summary).toBe("Try it for one sprint.");
    expect(spies.log).toHaveBeenCalledWith("summary_saved", { id: "s1" });

    openMenu("Send to… Adopt trunk-based development?");
    fireEvent.click(screen.getByRole("menuitem", { name: "Decision record" }));
    const blob = decisionBlob();
    expect(blob).toHaveLength(1);
    expect(blob[0]).toMatchObject({
      title: "Adopt trunk-based development?",
      context: "Try it for one sprint.",
      status: "proposed",
      sourceRef: { tool: "six-hats", id: "s1" },
    });
    expect(ws().decisions).toEqual([blob[0]]);
    expect(sessionById("s1").sentTo).toEqual([
      expect.objectContaining({ route: "decision", targetId: blob[0].id }),
    ]);
    expect(screen.getByRole("link", { name: /Proposed in the Decision Log/ })).toHaveAttribute(
      "href",
      "/decision-log"
    );

    undoLast();
    expect(decisionBlob()).toEqual([]);
    expect(ws().decisions).toEqual([]);
    expect(sessionById("s1").sentTo).toEqual([]);
  });

  it("closes the session (stopping its clock), and reopens it in the last round", async () => {
    seed([session({ currentRound: 6, summary: "Go." })]);
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Time this round" }));
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));
    expect(sessionById("s1").closedAt).toBeTruthy();
    expect(sessionById("s1").currentRound).toBeUndefined();
    expect(dock()).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Thought" })).toBeNull();
    expect(spies.log).toHaveBeenCalledWith("session_closed", { id: "s1", thoughts: 0 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reopen session" })).toHaveFocus()
    );

    fireEvent.click(screen.getByRole("button", { name: "Reopen session" }));
    expect(sessionById("s1").closedAt).toBeUndefined();
    expect(sessionById("s1").currentRound).toBe(6);
    expect(thoughtBox()).toBeInTheDocument();
    // The Reopen button went; focus lands on the round's own control.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Write the summary" })).toHaveFocus()
    );
  });

  it("keeps the closed session on screen, with its Send to, while another one is open", async () => {
    seed([
      session({ currentRound: 6, summary: "Go." }),
      session({ id: "s2", topic: "Older and open", startedAt: "2026-10-01T09:00:00Z" }),
    ]);
    renderHats();
    expect(screen.getByRole("heading", { name: "Adopt trunk-based development?" }));
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));
    expect(sessionById("s1").closedAt).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Adopt trunk-based development?" }));
    expect(screen.getByRole("button", { name: /^Send to… Adopt trunk-based/ })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reopen session" })).toHaveFocus()
    );
  });

  it("doesn't switch sessions, or lose a draft, when an agent starts a newer one", () => {
    seed([session({ currentRound: 1 })]);
    renderHats();
    fireEvent.change(thoughtBox(), { target: { value: "Half-typed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Draft summary" },
    });
    act(() =>
      ws().upsertSixHatsSession(
        session({ id: "agent", topic: "From the agent", startedAt: "2026-10-22T09:00:00Z" })
      )
    );
    expect(screen.getByRole("heading", { name: "Adopt trunk-based development?" }));
    expect(thoughtBox()).toHaveValue("Half-typed");
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue("Draft summary");
    // It's one pick away.
    fireEvent.change(screen.getByRole("combobox", { name: "Open a session" }), {
      target: { value: "agent" },
    });
    expect(screen.getByRole("heading", { name: "From the agent" }));
  });

  it("shows a summary an agent writes, unless one is being typed here", () => {
    seed([session()]);
    renderHats();
    act(() => ws().upsertSixHatsSession({ ...sessionById("s1"), summary: "From the agent" }));
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue("From the agent");
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Mine" },
    });
    act(() => ws().upsertSixHatsSession({ ...sessionById("s1"), summary: "Again" }));
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue("Mine");
  });

  it("after saving a summary with a trailing newline, still shows the agent's next one, and Close keeps it", () => {
    seed([session({ currentRound: 6 })]);
    renderHats();
    const box = () => screen.getByRole("textbox", { name: "Summary" });
    fireEvent.change(box(), { target: { value: "Plan A\n" } });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    expect(sessionById("s1").summary).toBe("Plan A");

    act(() => ws().upsertSixHatsSession({ ...sessionById("s1"), summary: "Plan B" }));
    expect(box()).toHaveValue("Plan B");
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));
    expect(sessionById("s1")).toMatchObject({ summary: "Plan B", closedAt: expect.any(String) });
  });
});

/* ── Example ── */

describe("first run", () => {
  it("loads the example from the empty state, keeps it out of the Decision Log, and clears it with Undo", () => {
    renderHats();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(sessions().map((x) => x.id)).toEqual([EXAMPLE_SESSION_ID]);
    expect(thoughts()).toHaveLength(16);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("“Move to weekly releases?”: 16 thoughts, most under Black (4).")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Send to… Move to weekly releases/ })
    ).toBeDisabled();
    expect(screen.getByText("Example sessions stay out of the Decision Log.")).toBeInTheDocument();

    act(() => ws().upsertSixHatsSession(session({ id: "mine", topic: "My own" })));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(sessions().map((x) => x.id)).toEqual(["mine"]);
    expect(thoughts()).toEqual([]);
    expect(screen.queryByText(/Example data\./)).toBeNull();
    undoLast();
    expect(sessions()).toHaveLength(2);
    expect(thoughts()).toHaveLength(16);
  });

  it("the example uses example ids only, across every hat", () => {
    const ex = buildExample(new Date("2026-10-20T12:00:00Z"));
    expect(ex.session.id.startsWith("example-")).toBe(true);
    expect(
      ex.thoughts.every((t) => t.id.startsWith("example-") && t.sessionId === ex.session.id)
    ).toBe(true);
    expect(new Set(ex.thoughts.map((t) => t.hat))).toEqual(new Set(HATS.map((h) => h.id)));
    expect(ex.session.summary).toBeTruthy();
  });
});

/* ── Pure logic ── */

describe("session logic", () => {
  it("validates the session form instead of defaulting", () => {
    expect(validateSession(emptySessionDraft())).toEqual({
      ok: false,
      errors: {
        topic: "Enter the question the team will think about.",
        minutes: "Enter the minutes for each round.",
      },
    });
    const base = { topic: "T", order: [...DEFAULT_ORDER] };
    for (const minutes of ["0", "0.5", "31", "abc", "Infinity"]) {
      expect(validateSession({ ...base, minutes }).ok, minutes).toBe(false);
    }
    expect(validateSession({ ...base, minutes: "2.5" })).toMatchObject({
      ok: true,
      values: { roundMinutes: 2.5 },
    });
    expect(validateSession({ ...base, topic: "x".repeat(301), minutes: "5" })).toMatchObject({
      ok: false,
    });
    expect(validateSession({ ...base, order: [], minutes: "5" })).toMatchObject({
      ok: false,
      errors: { order: "Add at least one hat." },
    });
    expect(validateSession({ ...base, order: Array(13).fill("red"), minutes: "5" })).toMatchObject({
      ok: false,
      errors: { order: "Use at most 12 rounds." },
    });
    expect(validateThought({ text: "  ", hat: null })).toMatchObject({ ok: false });
    expect(validateThought({ text: " x ", hat: "red" })).toEqual({
      ok: true,
      values: { text: "x", hat: "red" },
    });
    expect(validateSummary({ summary: "  " }).ok).toBe(false);
    expect(validateSummary({ summary: "y".repeat(4001) }).ok).toBe(false);
  });

  it("moves through rounds and closes", () => {
    const s = session();
    expect(sessionStatus(s)).toBe("not-started");
    expect(roundsLeft(s)).toBe(7);
    const r1 = nextRound(s);
    expect(r1.currentRound).toBe(0);
    expect(currentHat(r1)).toBe("blue");
    expect(prevRound(r1)).toBe(r1);
    const last = { ...s, currentRound: 6 };
    expect(nextRound(last)).toBe(last);
    expect(roundsLeft(last)).toBe(0);
    const c = closed(last, "2026-10-20T10:00:00Z");
    expect(c.currentRound).toBeUndefined();
    expect(sessionStatus(c)).toBe("closed");
    expect(nextRound(c)).toBe(c);
    expect(reopened(c)).toMatchObject({ currentRound: 6 });
    expect(reopened(c).closedAt).toBeUndefined();
    // A stored round out of range (a hand edit) counts as no round.
    expect(sessionStatus({ ...s, currentRound: 9 })).toBe("not-started");
    expect(
      editedSession({ ...s, currentRound: 6 }, { topic: "T", order: ["red"], roundMinutes: 1 })
    ).toMatchObject({
      currentRound: 0,
    });
  });

  it("times a round as a step on the dock, labelled by its place", () => {
    const s = { ...session(), currentRound: 6 };
    expect(sessionRun(s)).toMatchObject({ index: 6, finished: false, title: "Six Hats" });
    const d = roundDock(s, 1000)!;
    expect(d).toEqual({
      label: "Six Hats · Blue hat (7/7)",
      href: "/six-hats",
      totalSeconds: 300,
      endsAt: 301000,
      pausedRemaining: 300,
    });
    // The opening Blue round's clock isn't the closing one's.
    expect(isRoundClock(d, { ...s, currentRound: 0 })).toBe(false);
    expect(isRoundClock(d, s)).toBe(true);
    expect(roundDock(session())).toBeNull();
    expect(roundDock(closed(s, "x"))).toBeNull();
    expect(halfTimeHint({ ...s, currentRound: 5, roundMinutes: 3 })).toContain("1:30");
    expect(halfTimeHint(s)).toBeNull();
  });

  it("groups and orders thoughts, skipping unknown hats", () => {
    const t = [
      thought("b", "black", "B"),
      thought("a", "white", "A"),
      { ...thought("x", "red", "X"), hat: "purple" } as never,
      thought("o", "green", "O", { sessionId: "other" }),
    ];
    expect(sessionThoughts(t, "s1").map((x) => x.id)).toEqual(["b", "a"]);
    expect(earlierThoughts(t, [session()]).map((x) => x.id)).toEqual(["o"]);
    expect(byHat(t).black.map((x) => x.id)).toEqual(["b"]);
    expect(hatColumns(["red", "red", "blue"], t)).toEqual([
      "red",
      "blue",
      "white",
      "black",
      "green",
    ]);
    expect(hatColumns(null, [])).toEqual([]);
    expect(isHat("purple")).toBe(false);
    expect(moveHat(["red", "blue"], 1, 1)).toEqual(["red", "blue"]);
    expect(removeHatAt(["red", "blue"], 0)).toEqual(["blue"]);
  });

  it("follows the round being worn through an edit of the order", () => {
    const worn = { from: 2, at: 2 };
    expect(wornAfterMove(worn, 2, -1, 7)).toEqual({ from: 2, at: 1 });
    expect(wornAfterMove(worn, 1, 1, 7)).toEqual({ from: 2, at: 1 });
    expect(wornAfterMove(worn, 4, 1, 7)).toEqual(worn);
    expect(wornAfterMove(worn, 6, 1, 7)).toEqual(worn);
    expect(wornAfterRemove(worn, 0)).toEqual({ from: 2, at: 1 });
    expect(wornAfterRemove(worn, 5)).toEqual(worn);
    expect(wornAfterRemove(worn, 2)).toEqual({ from: 2, at: null });
    expect(wornAfterRemove({ from: 2, at: null }, 0)).toEqual({ from: 2, at: null });
    expect(wornAfterMove(undefined, 0, 1, 7)).toBeUndefined();

    // The same hat, the same time it is worn: the closing Blue stays the closing one.
    expect(sameRoundIn(DEFAULT_ORDER, 6, ["white", "blue", "blue"])).toBe(2);
    expect(sameRoundIn(DEFAULT_ORDER, 0, ["white", "blue", "blue"])).toBe(1);
    expect(sameRoundIn(DEFAULT_ORDER, 6, ["white", "blue"])).toBe(1);
    expect(sameRoundIn(DEFAULT_ORDER, 2, ["white", "red"])).toBeNull();
    expect(sameRoundIn([], 0, DEFAULT_ORDER)).toBeNull();
  });

  it("edits a session mid-round without making another hat current", () => {
    const s = session({ currentRound: 2 }); // Green
    const noOpening = DEFAULT_ORDER.slice(1);
    const v = { topic: s.topic, order: noOpening, roundMinutes: 5 };
    // As the form followed it.
    expect(editedSession(s, { ...v, worn: { from: 2, at: 1 } }).currentRound).toBe(1);
    // Without the form's record (or one from an older round): the same hat.
    expect(editedSession(s, v).currentRound).toBe(1);
    expect(editedRound({ ...s, currentRound: 3 }, { ...v, worn: { from: 2, at: 1 } })).toBe(2);
    // The worn round removed: the one now in its place, the last past a shorter order.
    expect(editedRound(s, { ...v, worn: { from: 2, at: null } })).toBeNull();
    expect(editedSession(s, { ...v, worn: { from: 2, at: null } }).currentRound).toBe(2);
    expect(
      editedSession(s, { ...v, order: ["white"], worn: { from: 2, at: null } }).currentRound
    ).toBe(0);
    // Not in a round: nothing to follow, and a stored round already out of range stays out.
    expect(editedSession(session(), v).currentRound).toBeUndefined();
    const longer = { ...v, order: [...DEFAULT_ORDER, ...DEFAULT_ORDER.slice(0, 5)] };
    expect(sessionStatus(editedSession(session({ currentRound: 9 }), longer))).toBe("not-started");
    expect(editedSession(closed(s, "x"), v).currentRound).toBeUndefined();
    // Running it twice changes nothing more.
    const once = editedSession(s, v);
    expect(editedSession(once, v)).toEqual(once);
  });

  it("makes earlier thoughts a closed session with the hats they came up under", () => {
    const list = [
      thought("a", "red", "A", { sessionId: undefined }),
      thought("b", "white", "B", { sessionId: undefined }),
      thought("c", "red", "C", { sessionId: undefined }),
    ];
    const s = adoptedSession("Old talk", list, "u1");
    expect(s).toEqual({
      id: "earlier-u1",
      topic: "Old talk",
      order: ["red", "white"],
      roundMinutes: 5,
      startedAt: list[0].loggedAt,
      closedAt: list[2].loggedAt,
    });
    expect(isAdoptedSession(s)).toBe(true);
    expect(isAdoptedSession(session())).toBe(false);
    expect(sessionStatus(s)).toBe("closed");
    // Closed, so it never takes the view (or an agent's log_thought) from an open one.
    expect(
      pickSession([s, session({ id: "x", startedAt: "2026-01-01T00:00:00Z" })], null)?.id
    ).toBe("x");
    const md = toMarkdown(s, list);
    expect(md).toContain(
      "Thoughts logged 20 Oct 2026 to 20 Oct 2026, before sessions had timed rounds."
    );
    expect(md).not.toMatch(/rounds of|\*\*Order:\*\*/);
  });

  it("picks the session asked for, else the newest open one", () => {
    const a = session({ id: "a", startedAt: "2026-10-01T00:00:00Z" });
    const b = session({
      id: "b",
      startedAt: "2026-10-05T00:00:00Z",
      closedAt: "2026-10-05T01:00:00Z",
    });
    expect(pickSession([a, b], null)?.id).toBe("a");
    expect(pickSession([a, b], "b")?.id).toBe("b");
    expect(pickSession([a, b], "gone")?.id).toBe("a");
    expect(pickSession([], null)).toBeNull();
  });
});

describe("verdict", () => {
  const many = (hat: SixHatsThought["hat"], n: number) =>
    Array.from({ length: n }, (_, i) => thought(`${hat}${i}`, hat, `${hat} ${i}`));

  it("says where a round is and the time left", () => {
    const s = session({ currentRound: 4 });
    expect(sixHatsVerdict(s, [], { remainingSeconds: 130 })).toBe(
      "Round 5 of 7: Black hat, 02:10 left."
    );
    expect(sixHatsVerdict(s, [], { remainingSeconds: 0 })).toBe(
      "Round 5 of 7: Black hat, time's up."
    );
    expect(sixHatsVerdict(s, [])).toBe("Round 5 of 7: Black hat.");
  });

  it("weighs the balance only with enough thoughts, and names a thin hat", () => {
    expect(sixHatsVerdict(null, [])).toBe("No sessions yet.");
    expect(sixHatsVerdict(session(), [])).toBe("No thoughts yet.");
    expect(sixHatsVerdict(session(), many("black", 3))).toBe(
      "“Adopt trunk-based development?”: 3 thoughts so far."
    );
    const lots = [
      ...many("black", 5),
      ...many("white", 2),
      ...many("green", 2),
      ...many("red", 2),
      ...many("yellow", 1),
    ];
    expect(sixHatsVerdict(closed(session(), "x"), lots)).toBe(
      "“Adopt trunk-based development?”: 12 thoughts, most under Black (5); Yellow has only 1, so look for benefits before deciding."
    );
    expect(
      balanceSentence("T", ["black", "green", "yellow"], [...many("black", 4), ...many("green", 4)])
    ).toBe(
      "“T”: 8 thoughts, most under Black and Green (4 each); Yellow has none, so look for benefits before deciding."
    );
    expect(sixHatsVerdict(session(), many("white", 6), { sent: true })).toBe(
      "“Adopt trunk-based development?”: 6 thoughts, most under White (6); Green has none, so look for alternatives before deciding. Summary sent to the Decision Log."
    );
  });
});

describe("Markdown record", () => {
  it("writes the topic, the order, every hat's thoughts oldest first, the summary and the decision", () => {
    const ex = buildExample(new Date("2026-10-20T12:00:00Z"));
    const md = toMarkdown(ex.session, ex.thoughts, {
      decision: { route: "decision", targetId: "d1", at: "2026-10-20T12:30:00Z" },
    });
    expect(md.startsWith("# Six Thinking Hats — Move to weekly releases?\n")).toBe(true);
    expect(md).toContain("Started 20 Oct 2026 · closed 20 Oct 2026 · 7 rounds of 5 minutes");
    expect(md).toContain("**Order:** Blue → White → Green → Yellow → Black → Red → Blue");
    expect(md).toContain("**“Move to weekly releases?”: 16 thoughts, most under Black (4).**");
    const headings = md.match(/^## .*$/gm);
    expect(headings).toEqual([
      "## Blue hat (Process)",
      "## White hat (Facts)",
      "## Green hat (New ideas)",
      "## Yellow hat (Benefits)",
      "## Black hat (Risks)",
      "## Red hat (Feelings)",
      "## Summary (Blue hat)",
    ]);
    const blue = md.slice(md.indexOf("## Blue hat"), md.indexOf("## White hat"));
    expect(blue.indexOf("Question:")).toBeLessThan(blue.indexOf("Agreed:"));
    expect(md).toContain("Trial weekly releases for two sprints.");
    expect(md).toContain("Sent to the Decision Log as a proposed decision on 20 Oct 2026.");
    const decided = toMarkdown(ex.session, ex.thoughts, {
      decision: { route: "decision", targetId: "d1", at: "2026-10-20T12:30:00Z" },
      decided: true,
    });
    expect(decided).toContain("Sent to the Decision Log on 20 Oct 2026, and decided there.");
    expect(decided).not.toContain("proposed");
  });

  it("says the decision was decided once the Decision Log accepted it, as the page does", () => {
    seed([
      session({
        summary: "Go.",
        sentTo: [{ route: "decision", targetId: "d1", at: "2026-10-20T12:30:00Z" }],
      }),
    ]);
    useWorkspaceStore.setState({
      decisions: [{ id: "d1", title: "Adopt", status: "accepted" } as unknown as Decision],
    });
    renderHats();
    expect(screen.getByRole("link", { name: /Decided in the Decision Log/ })).toBeInTheDocument();
    expect(screen.getByTestId("export-six-hats").textContent).toContain(
      "Sent to the Decision Log on 20 Oct 2026, and decided there."
    );
  });

  it("marks empty hats and a missing summary, and keeps line breaks inside a thought", () => {
    const md = toMarkdown(session({ order: ["white", "red"] }), [
      thought("a", "white", "one\ntwo | three"),
    ]);
    expect(md).toContain("- one\n  two | three");
    expect(md).toContain("## Red hat (Feelings)\n\n_No thoughts under this hat._");
    expect(md).toContain("_No summary yet._");
    expect(md).not.toContain("Sent to the Decision Log");
    expect(toMarkdown(null, [])).toContain("**No thoughts yet.**");
    // Thoughts handed over out of order are written oldest first.
    const later = thought("z", "white", "Later");
    const sooner = thought("y", "white", "Sooner", { loggedAt: "2026-01-01T00:00:00Z" });
    const both = toMarkdown(session({ order: ["white"] }), [later, sooner]);
    expect(both.indexOf("Sooner")).toBeLessThan(both.indexOf("Later"));
  });

  it("is what the page exports for the session", () => {
    seed([session()], [thought("t1", "white", "Fact")]);
    renderHats();
    expect(screen.getByTestId("export-six-hats").textContent).toContain(
      "# Six Thinking Hats — Adopt trunk-based development?"
    );
  });
});

describe("theme colours", () => {
  it("uses no hex colours anywhere in the tool", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/six-hats");
    for (const name of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      expect(src, name).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|style=\{\{/);
    }
    for (const h of HATS) expect(hatInfo(h.id).text).toMatch(/^text-/);
  });
});
