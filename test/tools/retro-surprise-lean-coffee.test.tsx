import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroCard } from "@/lib/stores/workspace-types";

/**
 * The Retro add-ons: "Surprise me" (a format the last three retros didn't
 * use, an opening and a closing, why it fits from Amr or without AI, and
 * the plan's activities on the board it starts) and the Lean Coffee runner
 * (merge duplicate topics, topics in vote order with a timebox, and at
 * time-up the keep-going-or-move-on vote: counted by hand on one screen,
 * on everyone's phone in a live room).
 */

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log, toolRunId: "test-run" }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate/chime")>()),
  timesUp: vi.fn(),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});

import { SurprisePlanPanel } from "@/app/(tools)/retro/components/surprise-plan";
import { RetroPlanNote } from "@/app/(tools)/retro/components/retro-plan-note";
import {
  LeanCoffeeRunner,
  LEAN_COFFEE_LOG,
} from "@/app/(tools)/retro/components/lean-coffee-runner";
import { ThumbsVoteCard, thumbsVerdict } from "@/app/(tools)/retro/room/thumbs-vote-card";
import {
  PLAN_SHOWN_MS,
  clearPlan,
  planFor,
  savePlan,
  useRetroPlanStore,
} from "@/app/(tools)/retro/plan-store";
import { useLeanCoffeeStore } from "@/app/(tools)/retro/lean-coffee-store";
import { RetroClient } from "@/app/(tools)/retro/retro-client";
import type { BoardState } from "@/app/(tools)/retro/types";
import type { RetroThumbsHost } from "@/app/(tools)/retro/room/use-retro-room";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import { retroActivity } from "@/lib/retro/surprise";

const fmt = (id: string) => retroFormats.find((f) => f.id === id)!;
const LEAN = fmt("lean-coffee");

const wrap = (ui: ReactNode) =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>
    </TooltipProvider>
  );

beforeEach(() => {
  undo.all = [];
  history.log.mockClear();
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({ retroBoards: [], sprints: [] });
  useRetroPlanStore.setState({ plan: null });
  useLeanCoffeeStore.setState({ timeboxMin: 7, extendMin: 3 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ── Surprise me ────────────────────────────────────────────────────── */

describe("Surprise me", () => {
  const recent = ["start-stop-continue", "4ls", "sailboat"];

  function panel(formats: readonly RetroFormat[] = retroFormats, last = recent) {
    const onStart = vi.fn();
    wrap(<SurprisePlanPanel formats={formats} recent={last} onStart={onStart} />);
    return onStart;
  }

  it("shows a plan: a format none of the last three retros used, an opening and a closing", () => {
    panel();
    const trigger = screen.getByRole("button", { name: /Surprise me/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const heading = screen.getByRole("heading", { name: /Surprise plan:/ });
    const name = heading.textContent!.replace("Surprise plan: ", "");
    expect(recent.map((id) => fmt(id).name)).not.toContain(name);
    expect(
      screen.getByText(/Not one of your last 3: Start \/ Stop \/ Continue, 4Ls, Sailboat\./)
    ).toBeInTheDocument();
    expect(screen.getByText("Open with")).toBeInTheDocument();
    expect(screen.getByText("Close with")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Shuffle again/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("shuffles to another format when there is one", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Surprise me/ }));
    const first = screen.getByRole("heading", { name: /Surprise plan:/ }).textContent;
    fireEvent.click(screen.getByRole("button", { name: /Shuffle again/ }));
    expect(screen.getByRole("heading", { name: /Surprise plan:/ }).textContent).not.toBe(first);
  });

  it("says why a candidate fits without AI, and starts with the plan and the reason", () => {
    const onStart = panel();
    fireEvent.click(screen.getByRole("button", { name: /Surprise me/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pick for this sprint without AI" }));
    expect(screen.getByText("Why it fits (suggested without AI)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start this retro/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
    const [{ plan, why }] = onStart.mock.calls[0];
    expect(recent).not.toContain(plan.format.id);
    expect(why).toMatch(/fresh way to look back/);
  });

  it("can pick any format once every one was used lately", () => {
    const two = [fmt("start-stop-continue"), fmt("4ls")];
    panel(two, ["start-stop-continue", "4ls"]);
    fireEvent.click(screen.getByRole("button", { name: /Surprise me/ }));
    expect(screen.getByText(/Every format has been used lately/)).toBeInTheDocument();
  });

  it("closes, putting focus back on its button", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Surprise me/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close the surprise plan" }));
    expect(screen.queryByRole("heading", { name: /Surprise plan:/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Surprise me/ })).toHaveFocus();
  });
});

describe("the plan on the board", () => {
  const at = "2026-11-12T09:00:00.000Z";
  const saved = { formatId: "starfish", openingId: "q-7", closingId: "a-7", at };

  it("is read only for its format, within a day, with activities the Ice Breaker has", () => {
    const now = Date.parse(at) + 60_000;
    expect(planFor(saved, "starfish", now)).toMatchObject({
      opening: retroActivity("q-7", "opening"),
      closing: retroActivity("a-7", "closing"),
    });
    expect(planFor(saved, "sailboat", now)).toBeNull();
    expect(planFor(saved, "starfish", Date.parse(at) + PLAN_SHOWN_MS + 1)).toBeNull();
    expect(planFor({ ...saved, openingId: "zz-1" }, "starfish", now)).toBeNull();
    expect(planFor({ ...saved, formatId: 7 }, "starfish", now)).toBeNull();
    expect(planFor(null, "starfish", now)).toBeNull();
  });

  it("shows the opening while people write and the closing at Actions, until dismissed", () => {
    savePlan({ ...saved, at: new Date().toISOString(), why: "Starfish fits a mixed sprint." });
    const { rerender } = wrap(<RetroPlanNote formatId="starfish" phase="write" />);
    const note = screen.getByRole("complementary", { name: "Opening activity" });
    expect(within(note).getByText(retroActivity("q-7", "opening")!.name)).toBeInTheDocument();
    expect(within(note).getByText("Starfish fits a mixed sprint.")).toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <RetroPlanNote formatId="starfish" phase="vote" />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    rerender(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <RetroPlanNote formatId="starfish" phase="actions" />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
    expect(screen.getByRole("complementary", { name: "Closing activity" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the retro plan" }));
    expect(useRetroPlanStore.getState().plan).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("starts a board from the picker, logged as a surprise, with its opening shown", () => {
    wrap(<RetroClient />);
    fireEvent.click(screen.getByRole("button", { name: /Surprise me/ }));
    const name = screen
      .getByRole("heading", { name: /Surprise plan:/ })
      .textContent!.replace("Surprise plan: ", "");
    fireEvent.click(screen.getByRole("button", { name: /Start this retro/ }));
    const board = (useWorkspaceStore.getState().retroBoards ?? []).find(
      (b) => b.id === "retro:current"
    )!;
    expect(board.format.name).toBe(name);
    expect(history.log).toHaveBeenCalledWith(
      RETRO_ACTIONS.FORMAT_CHANGED,
      expect.objectContaining({ format: name, surprise: true })
    );
    expect(useRetroPlanStore.getState().plan?.formatId).toBe(board.format.id);
    expect(screen.getByRole("complementary", { name: "Opening activity" })).toBeInTheDocument();
  });

  it("is dropped when a format is picked by hand", () => {
    savePlan({
      formatId: "starfish",
      openingId: "q-7",
      closingId: "a-7",
      at: new Date().toISOString(),
    });
    wrap(<RetroClient />);
    fireEvent.click(screen.getAllByRole("button", { name: /Starfish/ })[0]);
    expect(useRetroPlanStore.getState().plan).toBeNull();
    clearPlan();
  });
});

/* ── Lean Coffee ────────────────────────────────────────────────────── */

const topic = (
  id: string,
  text: string,
  votes: number,
  over: Partial<RetroCard> = {}
): RetroCard => ({
  id,
  columnKey: "to-discuss",
  text,
  votes,
  groupedWith: null,
  isActionItem: false,
  assignee: "",
  discussing: false,
  ...over,
});

const leanBoard = (over: Partial<BoardState> = {}): BoardState => ({
  format: LEAN,
  phase: "discuss",
  cards: [
    topic("t1", "Release checklist is out of date", 1),
    topic("t2", "Our standups run too long", 4),
    topic("t3", "Lunch and learn ideas", 2),
  ],
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...over,
});

function fakeThumbs(poll: RetroThumbsHost["poll"] = null): RetroThumbsHost {
  return { poll, open: vi.fn(), close: vi.fn(), clear: vi.fn() };
}

/** The runner on a board kept in state, as the Board keeps it. */
function runner(
  initial: BoardState,
  opts: { timeUp?: boolean; thumbs?: RetroThumbsHost | null } = {}
) {
  const log = vi.fn();
  const latest: { board: BoardState } = { board: initial };
  function Harness({ timeUp, thumbs }: { timeUp: boolean; thumbs: RetroThumbsHost | null }) {
    const [state, setState] = useState(initial);
    latest.board = state;
    return (
      <LeanCoffeeRunner
        state={state}
        shownCards={state.cards}
        onUpdate={(u) => setState((prev) => u(prev))}
        timeUp={timeUp}
        thumbs={thumbs}
        log={log}
      />
    );
  }
  const view = wrap(<Harness timeUp={opts.timeUp ?? false} thumbs={opts.thumbs ?? null} />);
  const rerun = (next: { timeUp?: boolean; thumbs?: RetroThumbsHost | null }) =>
    view.rerender(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <Harness timeUp={next.timeUp ?? false} thumbs={next.thumbs ?? null} />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
  const card = (id: string) => latest.board.cards.find((c) => c.id === id)!;
  return { log, latest, card, rerun };
}

describe("Lean Coffee: before Discuss", () => {
  it("groups topics that are the same without AI; each merge has Undo", () => {
    const { card } = runner(
      leanBoard({
        phase: "vote",
        cards: [
          topic("t1", "Standups run too long", 1),
          topic("t2", "Standups overrun every day", 3),
          topic("t3", "Release checklist", 0),
          topic("t4", "Pairing on reviews", 0),
          topic("t5", "Lunch and learn ideas", 2),
          topic("t6", "Hiring plans", 0),
        ],
      })
    );
    expect(screen.getByText(/dot-vote the topics/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Group similar topics without AI" }));
    fireEvent.click(screen.getByRole("button", { name: /^Merge: / }));
    // The less-voted topic goes under the more-voted one.
    expect(card("t1").groupedWith).toBe("t2");
    expect(card("t2").groupedWith).toBeNull();
    expect(undo.all.at(-1)!.label).toBe("Merged 2 topics");
    act(() => undo.all.at(-1)!.revert());
    expect(card("t1").groupedWith).toBeNull();
  });

  it("needs two topics before grouping", () => {
    runner(leanBoard({ phase: "write", cards: [topic("t1", "Only one", 0)] }));
    expect(screen.getByText(/everyone writes topics in To Discuss/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Group similar topics without AI" }));
    expect(screen.getByText("Add at least two topics first.")).toBeInTheDocument();
    expect(screen.queryByText("Topics that look the same")).toBeNull();
  });

  it("says when no topics look the same", () => {
    runner(
      leanBoard({
        phase: "write",
        cards: [topic("t1", "Standups", 0), topic("t2", "Release checklist", 0)],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Group similar topics without AI" }));
    expect(screen.getByText("No topics look the same. Nothing to merge.")).toBeInTheDocument();
  });
});

describe("Lean Coffee: Discuss", () => {
  it("starts the most-voted topic with a 7-minute timebox, the rest queued in vote order", () => {
    const { card, latest, log } = runner(leanBoard());
    fireEvent.click(
      screen.getByRole("button", { name: /Start the first topic: Our standups run too long/ })
    );
    expect(card("t2")).toMatchObject({ columnKey: "discussing", discussing: true });
    expect(latest.board).toMatchObject({ timerSeconds: 420, timerRunning: true });
    expect(log).toHaveBeenCalledWith(LEAN_COFFEE_LOG.TOPIC_STARTED, { cardId: "t2", minutes: 7 });
    const next = screen.getByText("Up next").nextElementSibling!;
    expect(
      within(next as HTMLElement)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "1. Lunch and learn ideas · 2 votes",
      "2. Release checklist is out of date · 1 vote",
    ]);
  });

  it("takes the timebox and the extension the facilitator picks", () => {
    const { latest } = runner(leanBoard());
    fireEvent.click(
      within(screen.getByRole("group", { name: "Minutes per topic" })).getByRole("button", {
        name: "10 min",
      })
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Minutes each keep going adds" })).getByRole(
        "button",
        { name: "5 min" }
      )
    );
    expect(useLeanCoffeeStore.getState()).toMatchObject({ timeboxMin: 10, extendMin: 5 });
    fireEvent.click(screen.getByRole("button", { name: /Start the first topic/ }));
    expect(latest.board.timerSeconds).toBe(600);
  });

  it("reads a stored timebox it doesn't offer as the default", () => {
    useLeanCoffeeStore.setState({ timeboxMin: 99, extendMin: -1 });
    runner(leanBoard());
    expect(
      within(screen.getByRole("group", { name: "Minutes per topic" })).getByRole("button", {
        name: "7 min",
      })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(screen.getByRole("group", { name: "Minutes each keep going adds" })).getByRole(
        "button",
        { name: "3 min" }
      )
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("at time-up on one screen, counts the thumbs held up and keeps going 3 more minutes", () => {
    const started = leanBoard({
      cards: [
        topic("t2", "Our standups run too long", 4, { columnKey: "discussing", discussing: true }),
        topic("t3", "Lunch and learn ideas", 2),
      ],
    });
    const { latest, log } = runner(started, { timeUp: true });
    expect(screen.getByText("Time's up. Keep going or move on?")).toBeInTheDocument();
    const count = screen.getByRole("group", { name: "Count the thumbs" });
    fireEvent.click(within(count).getByRole("button", { name: /One more thumb up/ }));
    fireEvent.click(within(count).getByRole("button", { name: /One more thumb up/ }));
    fireEvent.click(within(count).getByRole("button", { name: /One more thumb down/ }));
    expect(screen.getByText(thumbsVerdict({ keep: 2, move: 1 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep going \(3 min\)/ }));
    expect(latest.board).toMatchObject({ timerSeconds: 180, timerRunning: true });
    expect(log).toHaveBeenCalledWith(LEAN_COFFEE_LOG.TOPIC_EXTENDED, { cardId: "t2", minutes: 3 });
  });

  it("moves on: the topic is done and the next one starts, then says when it was the last", () => {
    const started = leanBoard({
      cards: [
        topic("t2", "Our standups run too long", 4, { columnKey: "discussing", discussing: true }),
        topic("t3", "Lunch and learn ideas", 2),
      ],
    });
    const { card, latest, log } = runner(started, { timeUp: true });
    fireEvent.click(screen.getByRole("button", { name: /Move on to the next topic/ }));
    expect(card("t2")).toMatchObject({ columnKey: "done", discussing: false });
    expect(card("t3")).toMatchObject({ columnKey: "discussing", discussing: true });
    expect(latest.board.timerSeconds).toBe(420);
    expect(log).toHaveBeenCalledWith(LEAN_COFFEE_LOG.TOPIC_DONE, { cardId: "t2", extended: 0 });
  });

  it("finishes a topic early, and says when every topic has been discussed", () => {
    const { card } = runner(
      leanBoard({
        cards: [
          topic("t2", "Our standups run too long", 4, {
            columnKey: "discussing",
            discussing: true,
          }),
          topic("t9", "Already done", 1, { columnKey: "done" }),
        ],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Done with this topic/ }));
    expect(card("t2").columnKey).toBe("done");
    expect(screen.getByText(/Every topic has been discussed/)).toBeInTheDocument();
    expect(screen.getByText("Discussed: 2 topics.")).toBeInTheDocument();
  });

  it("in a live room, asks every phone once at time-up and closes the vote on the host's word", () => {
    const started = leanBoard({
      cards: [
        topic("t2", "Our standups run too long", 4, { columnKey: "discussing", discussing: true }),
        topic("t3", "Lunch and learn ideas", 2),
      ],
    });
    const thumbs = fakeThumbs();
    const view = runner(started, { thumbs });
    expect(thumbs.open).not.toHaveBeenCalled();
    view.rerun({ timeUp: true, thumbs });
    view.rerun({ timeUp: true, thumbs });
    expect(thumbs.open).toHaveBeenCalledTimes(1);
    expect(thumbs.open).toHaveBeenCalledWith("Our standups run too long");

    const open = fakeThumbs({ id: "p1", topic: "x", open: true, keep: 2, move: 1, voters: 3 });
    view.rerun({ timeUp: true, thumbs: open });
    // While it's open the host's screen shows how many voted, not the split.
    expect(screen.getByText("3 people have voted so far.")).toBeInTheDocument();
    expect(screen.queryByText(/Keep going 2/)).toBeNull();
    expect(screen.getByRole("button", { name: /Keep going \(3 min\)/ })).not.toHaveClass(
      "bg-primary"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close the vote and show everyone" }));
    expect(open.close).toHaveBeenCalled();

    const closed = fakeThumbs({ id: "p1", topic: "x", open: false, keep: 1, move: 3, voters: 4 });
    view.rerun({ timeUp: true, thumbs: closed });
    // The totals in words, not bare numbers beside icons.
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === "Keep going 1 · Move on 3 (4 voted)"
      )
    ).toHaveAttribute("role", "status");
    expect(screen.getByText("Most want to move on.")).toBeInTheDocument();
    // The tally marks the room's choice; the facilitator still decides.
    expect(screen.getByRole("button", { name: /Move on to the next topic/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Keep going/ }));
    expect(closed.clear).toHaveBeenCalled();
  });

  it("never opens the room's vote outside Discuss, or on a hidden card", () => {
    // A participant's card in Discussing, hidden while people write: the host's
    // screen doesn't show it, so it can't be asked about.
    const hidden = topic("t9", "Secret topic", 0, { columnKey: "discussing" });
    for (const phase of ["write", "vote"] as const) {
      const thumbs = fakeThumbs();
      const view = wrap(
        <LeanCoffeeRunner
          state={leanBoard({ phase, cards: [hidden] })}
          shownCards={[]}
          onUpdate={() => {}}
          timeUp={true}
          thumbs={thumbs}
          log={() => {}}
        />
      );
      expect(thumbs.open).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("doesn't open the room's vote for a card nobody started", () => {
    const thumbs = fakeThumbs();
    const dropped = leanBoard({
      cards: [topic("t2", "Dropped in Discussing", 4, { columnKey: "discussing" })],
    });
    const view = runner(dropped, { thumbs });
    view.rerun({ timeUp: true, thumbs });
    expect(thumbs.open).not.toHaveBeenCalled();
  });

  it("doesn't take a timebox that ran out before Discuss as a topic's time being up", () => {
    const thumbs = fakeThumbs();
    function Harness({ phase }: { phase: BoardState["phase"] }) {
      const state = leanBoard({
        phase,
        cards: [
          topic("t2", "Our standups run too long", 4, {
            columnKey: "discussing",
            discussing: true,
          }),
        ],
      });
      return (
        <LeanCoffeeRunner
          state={state}
          shownCards={state.cards}
          onUpdate={() => {}}
          timeUp={true}
          thumbs={thumbs}
          log={() => {}}
        />
      );
    }
    const view = wrap(<Harness phase="vote" />);
    view.rerender(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <Harness phase="discuss" />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
    expect(thumbs.open).not.toHaveBeenCalled();
  });

  it("shows the next topic on its own line, with a short start button", () => {
    runner(leanBoard());
    expect(screen.getByText("Next:").parentElement).toHaveTextContent(
      "Next: Our standups run too long · 4 votes"
    );
    expect(screen.getByRole("button", { name: /Start the first topic/ })).toHaveTextContent(
      /^Start the first topic$/
    );
  });

  it("isn't shown in Actions", () => {
    wrap(
      <LeanCoffeeRunner
        state={leanBoard({ phase: "actions" })}
        shownCards={[]}
        onUpdate={() => {}}
        timeUp={false}
        thumbs={null}
        log={() => {}}
      />
    );
    expect(screen.queryByLabelText("Lean Coffee")).toBeNull();
  });
});

describe("a participant's thumbs vote", () => {
  const poll = { id: "p1", topic: "Our standups run too long", open: true, voters: 2 };

  it("puts a thumb up or down, and says so", () => {
    const onThumb = vi.fn();
    const { rerender } = wrap(
      <ThumbsVoteCard poll={poll} myThumb={null} canVote onThumb={onThumb} />
    );
    expect(screen.getByText("Our standups run too long")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep going/ }));
    expect(onThumb).toHaveBeenCalledWith("keep");
    rerender(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <ThumbsVoteCard poll={poll} myThumb="move" canVote onThumb={onThumb} />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
    expect(screen.getByRole("button", { name: /Move on/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "You said move on. You can change it until the host closes the vote. 2 people have voted."
    );
  });

  it("can't vote without a seat, and shows the totals once closed", () => {
    const { rerender } = wrap(
      <ThumbsVoteCard poll={poll} myThumb={null} canVote={false} onThumb={() => {}} />
    );
    expect(screen.getByRole("button", { name: /Keep going/ })).toBeDisabled();
    rerender(
      <TooltipProvider>
        <LiveAnnouncerProvider>
          <ThumbsVoteCard
            poll={{ ...poll, open: false, voters: 4, keep: 2, move: 2 }}
            myThumb="keep"
            canVote
            onThumb={() => {}}
          />
        </LiveAnnouncerProvider>
      </TooltipProvider>
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Keep going 2 · Move on 2. It's a tie: the facilitator decides."
    );
  });
});
