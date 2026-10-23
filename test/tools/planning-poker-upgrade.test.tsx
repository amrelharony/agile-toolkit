import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink, Story as WorkspaceStory } from "@/lib/stores/workspace-types";

/**
 * Planning Poker's upgrade (tool UX contract, Phase 2):
 *   - consensus counted in card positions on the deck, for every deck;
 *   - any card on the deck can be accepted, starting on the suggested one;
 *   - stories typed into a session can be saved to the backlog with their
 *     points, once each, with Undo, never the queue's or the example's;
 *   - the Estimation Guide's notes for the card being discussed sit under
 *     the deck;
 *   - the decks come from lib/constants/scales;
 *   - the lobby and the add-story box say what's wrong instead of greying
 *     out or doing nothing.
 */

const h = vi.hoisted(() => ({
  auth: null as Partial<AuthContextValue> | null,
  undo: null as null | { label: string; description?: string; revert: () => void },
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => false,
  getSupabaseClient: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; description?: string; apply: () => void; revert: () => void }) => {
    h.undo = a;
    a.apply();
  },
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "whileHover",
    "whileTap",
  ]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const cache = new Map<string, unknown>();
  const component = (tag: string) => {
    if (!cache.has(tag)) {
      const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
        React.createElement(tag, { ...strip(props), ref })
      );
      C.displayName = `Motion(${tag})`;
      cache.set(tag, C);
    }
    return cache.get(tag);
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";
import { SessionScreen } from "@/app/(tools)/planning-poker/session-screen";
import {
  consensusOf,
  consensusVerdict,
  estimateCards,
  isEstimateCard,
} from "@/app/(tools)/planning-poker/consensus";
import {
  planBacklogSave,
  planSize,
  pointsFromEstimate,
  savedCount,
} from "@/app/(tools)/planning-poker/backlog";
import {
  INITIAL_LOBBY,
  customDeckError,
  parseCustomDeck,
  validateLobby,
} from "@/app/(tools)/planning-poker/lobby";
import { MAX_STORIES, QUEUE_FULL, validateStory } from "@/app/(tools)/planning-poker/stories";
import {
  LOCAL_SESSION_KEY,
  QUEUED_IDS_KEY,
  clearLocalSession,
  loadQueuedStoryIds,
  saveQueuedStoryIds,
} from "@/app/(tools)/planning-poker/local-session";
import {
  DEFAULT_CUSTOM_DECK,
  SCALES,
  SCALE_LABELS,
  isValidSession,
  type Session,
  type Story,
} from "@/app/(tools)/planning-poker/types";
import { useEstimationGuideStore, initialState } from "@/app/(tools)/estimation-guide/store";
import { sendHandoff } from "@/lib/handoffs/send";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

const FIB = SCALES.fibonacci;
const TSHIRT = SCALES.tshirt;
const HOST = "host-1";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: [...FIB],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: HOST,
    participants: [{ id: HOST, name: "Scrum Master", vote: null }],
    stories: [{ id: "s1", title: "Login page", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

/** Revealed votes on the table, one seat each (the host's first). */
const seats = (...votes: string[]) =>
  votes.map((vote, i) => ({ id: i === 0 ? HOST : `p${i}`, name: `P${i}`, vote }));

function Harness({
  initial,
  references,
}: {
  initial: Session;
  references?: Parameters<typeof SessionScreen>[0]["references"];
}) {
  const [session, setSession] = useState(initial);
  latest = session;
  return (
    <SessionScreen
      session={session}
      onUpdateSession={(updater) => setSession((s) => updater(s))}
      localParticipantId={HOST}
      isHost
      onLeave={() => {}}
      references={references}
    />
  );
}
let latest: Session;

const ws = () => useWorkspaceStore.getState();
const story = (over: Partial<WorkspaceStory> & { id: string }): WorkspaceStory => ({
  title: over.id,
  status: "backlog",
  ...over,
});
const sessionStory = (id: string, title: string, finalEstimate: string | null = null): Story => ({
  id,
  title,
  finalEstimate,
});

beforeEach(() => {
  h.auth = { status: "anonymous", user: null };
  h.undo = null;
  window.localStorage.clear();
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [], storyMaps: [] });
  useEstimationGuideStore.setState({ ...initialState });
});

// ─── Consensus in card positions ─────────────────────────────────────────

describe("consensus, counted in cards on the deck", () => {
  it("treats neighbouring cards alike whatever their values", () => {
    expect(consensusOf(["5", "5", "5"], FIB)).toMatchObject({ level: "agree", apart: 0 });
    // The old absolute spread called 1 vs 3 "near" and 13 vs 21 "discuss".
    expect(consensusOf(["13", "21"], FIB)).toMatchObject({ level: "close", apart: 1 });
    expect(consensusOf(["1", "2"], FIB)).toMatchObject({ level: "close", apart: 1 });
    expect(consensusOf(["1", "3"], FIB)).toMatchObject({ level: "spread", apart: 2 });
    expect(consensusOf(["3", "13"], FIB)).toMatchObject({
      level: "spread",
      apart: 3,
      low: "3",
      high: "13",
    });
  });

  it("gives T-shirt decks a verdict too", () => {
    expect(consensusOf(["M", "M"], TSHIRT).level).toBe("agree");
    expect(consensusOf(["S", "M", "M"], TSHIRT)).toMatchObject({ level: "close", suggested: "M" });
    expect(consensusOf(["XS", "L"], TSHIRT)).toMatchObject({ level: "spread", apart: 3 });
  });

  it("leaves out ?, ∞, coffee and cards that aren't on the deck", () => {
    expect(consensusOf(["5", "?", "∞", "☕", "42"], FIB)).toMatchObject({
      level: "agree",
      estimates: 1,
      abstained: 4,
    });
    expect(consensusOf(["?", "?"], FIB)).toMatchObject({ level: null, abstained: 2 });
    expect(consensusOf([], FIB)).toMatchObject({ level: null, estimates: 0, abstained: 0 });
    expect(isEstimateCard(" ? ")).toBe(false);
    expect(isEstimateCard("Coffee")).toBe(false);
    expect(estimateCards(["1", "2", "2", "?", "∞", ""])).toEqual(["1", "2"]);
  });

  it("suggests the middle of the votes by position, the higher card on an even split", () => {
    expect(consensusOf(["3", "8", "8", "13"], FIB).suggested).toBe("8");
    expect(consensusOf(["3", "5"], FIB).suggested).toBe("5");
    // Two cards apart: the card between them, though nobody played it.
    expect(consensusOf(["3", "8"], FIB).suggested).toBe("5");
    expect(consensusOf(["1", "1", "8", "13", "21"], FIB).suggested).toBe("8");
    // A hundred votes: one 21 among 99 twos still suggests 2.
    expect(consensusOf([...Array<string>(99).fill("2"), "21"], FIB)).toMatchObject({
      suggested: "2",
      level: "spread",
      apart: 5,
    });
  });

  it("counts a custom deck in the order it was typed", () => {
    const deck = ["tiny", "small", "big", "huge"];
    expect(consensusOf(["tiny", "small"], deck).level).toBe("close");
    expect(consensusOf(["tiny", "huge"], deck)).toMatchObject({ level: "spread", apart: 3 });
  });

  it("says what to do in one sentence", () => {
    expect(consensusVerdict(consensusOf(["5", "5"], FIB))).toBe("Everyone played 5.");
    expect(consensusVerdict(consensusOf(["5"], FIB))).toBe("Only one estimate: 5.");
    expect(consensusVerdict(consensusOf(["5", "5", "?"], FIB))).toBe(
      "Everyone who estimated played 5. 1 person couldn't estimate: ask what's unclear."
    );
    expect(consensusVerdict(consensusOf(["13", "21"], FIB))).toBe(
      "Neighbouring cards, 13 and 21: settle on 21 unless someone sees more."
    );
    expect(consensusVerdict(consensusOf(["3", "13"], FIB))).toBe(
      "3 cards apart, 3 to 13: hear from whoever played 3 and 13, then vote again."
    );
    expect(consensusVerdict(consensusOf(["?", "∞"], FIB))).toBe(
      "Nobody could estimate this one: talk through what's unclear, or split the story."
    );
  });
});

// ─── Accepting any card ──────────────────────────────────────────────────

describe("accepting an estimate", () => {
  const acceptGroup = () => screen.getByRole("radiogroup", { name: "Estimate to accept" });

  it("offers every card on the deck, starts on the suggestion, and commits a card nobody played", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    expect(screen.getByText("Discussion needed")).toBeInTheDocument();
    const radios = within(acceptGroup()).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["1", "2", "3", "5", "8", "13", "21"]);
    expect(within(acceptGroup()).getByRole("radio", { name: "5" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("button", { name: "Accept 5" })).toBeInTheDocument();

    fireEvent.click(within(acceptGroup()).getByRole("radio", { name: "21" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept 21" }));
    expect(latest.stories[0].finalEstimate).toBe("21");
    expect(latest.stories[0].rounds).toEqual([["3", "8"]]);
  });

  it("asks for a card when nobody could estimate, instead of picking one", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("?", "∞") })} />);
    expect(
      screen.getByText(
        "Nobody could estimate this one: talk through what's unclear, or split the story."
      )
    ).toBeInTheDocument();
    expect(within(acceptGroup()).queryByRole("radio", { checked: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick the card the team agreed on.");
    expect(latest.stories[0].finalEstimate).toBeNull();
  });

  it("gives a T-shirt round a verdict and the cards apart", () => {
    render(
      <Harness
        initial={makeSession({
          scale: [...TSHIRT],
          scaleType: "tshirt",
          revealed: true,
          participants: seats("S", "M"),
        })}
      />
    );
    expect(screen.getByText("Near consensus")).toBeInTheDocument();
    expect(screen.getByText("Cards apart").nextSibling).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Accept M" }));
    expect(latest.stories[0].finalEstimate).toBe("M");
  });
});

// ─── The Estimation Guide under the deck ─────────────────────────────────

describe("reference stories under the deck", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      stories: [story({ id: "done-8", title: "Checkout rewrite", points: 8, status: "done" })],
    });
    useEstimationGuideStore.setState({
      descriptions: { ...initialState.descriptions, "Fibonacci:8": "Our 8: a whole flow" },
      examples: { "Fibonacci:8": "The refunds page" },
      referenceStoryIds: { "Fibonacci:8": ["done-8", "gone"] },
    });
  });

  it("shows the guide's notes for the card you picked, and for the card to accept", () => {
    h.auth = { status: "anonymous", user: null };
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    fireEvent.change(screen.getByPlaceholderText("Story title…"), {
      target: { value: "Refund flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    expect(
      screen.getByText("Pick a card to compare it with your Estimation Guide's reference stories.")
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
        name: "8",
      })
    );
    const panel = screen.getByRole("region", { name: "Estimation Guide for 8" });
    expect(panel).toHaveTextContent("Our 8: a whole flow");
    expect(panel).toHaveTextContent("Team example: The refunds page");
    // A pinned story that's gone from the workspace is skipped.
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Checkout rewrite · 8 points"]);

    fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
    expect(screen.getByRole("region", { name: "Estimation Guide for 8" })).toBeInTheDocument();
    // Picking another card to accept shows that card's notes (the default meaning).
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Estimate to accept" })).getByRole("radio", {
        name: "13",
      })
    );
    expect(screen.getByRole("region", { name: "Estimation Guide for 13" })).toHaveTextContent(
      "No team example or reference story for this card yet"
    );
  });

  it("shows nothing for ? or on a guest's screen", () => {
    const lookup = vi.fn(() => null);
    render(<Harness initial={makeSession({ participants: seats("?") })} references={lookup} />);
    expect(screen.queryByRole("region", { name: /Estimation Guide/ })).toBeNull();
    expect(lookup).toHaveBeenCalledWith("?");

    render(<Harness initial={makeSession({ participants: seats("8") })} />);
    expect(screen.queryByText(/Estimation Guide/)).toBeNull();
  });
});

// ─── Save to backlog ─────────────────────────────────────────────────────

describe("saving session stories to the backlog (logic)", () => {
  const typed = [
    sessionStory("a", "Login page", "5"),
    sessionStory("b", "Search", null),
    sessionStory("c", "Profile", "M"),
    sessionStory("d", "Settings", "0"),
  ];

  it("plans one backlog story per typed story, with numeric estimates as points", () => {
    const plan = planBacklogSave(typed, []);
    expect(plan.create.map((s) => [s.title, s.points, s.status, s.sourceRef])).toEqual([
      ["Login page", 5, "backlog", { tool: "planning-poker", id: "a" }],
      ["Search", undefined, "backlog", { tool: "planning-poker", id: "b" }],
      ["Profile", undefined, "backlog", { tool: "planning-poker", id: "c" }],
      ["Settings", undefined, "backlog", { tool: "planning-poker", id: "d" }],
    ]);
    expect(plan.unsized).toBe(3);
    expect(new Set(plan.create.map((s) => s.id)).size).toBe(4);
  });

  it("skips queue stories, example stories and blank titles", () => {
    const plan = planBacklogSave(
      [...typed, sessionStory("example-poker-story-1", "Example"), sessionStory("e", "  ")],
      [],
      new Set(["a", "b"])
    );
    expect(plan.create.map((s) => s.title)).toEqual(["Profile", "Settings"]);
  });

  it("never duplicates, and gives a saved story its points once it's estimated", () => {
    const first = planBacklogSave(typed, []);
    const backlog = first.create;
    expect(planSize(planBacklogSave(typed, backlog))).toBe(0);
    expect(savedCount(typed, backlog)).toBe(4);

    const later = typed.map((s) => (s.id === "b" ? { ...s, finalEstimate: "8" } : s));
    const again = planBacklogSave(later, backlog);
    expect(again.create).toEqual([]);
    expect(again.update.map((u) => [u.before.points, u.after.points])).toEqual([[undefined, 8]]);
    expect(again.alreadySaved).toBe(3);

    // Points set in the backlog since are never overwritten.
    const edited = backlog.map((s) => (s.sourceRef?.id === "b" ? { ...s, points: 3 } : s));
    expect(planSize(planBacklogSave(later, edited))).toBe(0);
  });

  it("reads only positive numbers as points", () => {
    expect(pointsFromEstimate("8")).toBe(8);
    expect(pointsFromEstimate(" 0.5 ")).toBe(0.5);
    for (const v of ["0", "-3", "M", "?", "", null, undefined]) {
      expect(pointsFromEstimate(v), String(v)).toBeUndefined();
    }
  });
});

function startSession() {
  render(<PlanningPokerClient />);
  fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
}
function addStory(title: string) {
  fireEvent.change(screen.getByPlaceholderText("Story title…"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Add story" }));
}
function estimate(value: string) {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
      name: value,
    })
  );
  fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
  fireEvent.click(screen.getByRole("button", { name: `Accept ${value}` }));
}
const pokerStories = () => ws().stories.filter((s) => s.sourceRef?.tool === "planning-poker");

describe("saving session stories to the backlog (UI)", () => {
  it("saves typed stories with their points, once, with Undo", () => {
    startSession();
    addStory("Login page");
    addStory("Search");
    estimate("5");
    fireEvent.click(screen.getByRole("button", { name: "Save to backlog (2)" }));

    expect(pokerStories().map((s) => [s.title, s.points])).toEqual([
      ["Login page", 5],
      ["Search", undefined],
    ]);
    expect(h.undo?.label).toBe("Saved 2 stories to the backlog");
    expect(h.undo?.description).toBe("1 without points yet.");
    expect(screen.getByRole("button", { name: "All saved to the backlog" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /2 in the backlog: plan the sprint/ })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );

    // Estimating the second story offers its points, not a second copy.
    estimate("3");
    fireEvent.click(screen.getByRole("button", { name: "Save to backlog (1)" }));
    expect(pokerStories().map((s) => [s.title, s.points])).toEqual([
      ["Login page", 5],
      ["Search", 3],
    ]);
    act(() => h.undo!.revert());
    expect(pokerStories().find((s) => s.title === "Search")?.points).toBeUndefined();
    expect(pokerStories()).toHaveLength(2);
  });

  it("leaves out the queue's stories, even after their estimate is written back", () => {
    const sentTo: HandoffLink[] = [];
    useWorkspaceStore.setState({
      stories: [story({ id: "sp-1", title: "Planned story" })],
    });
    sendHandoff(
      "poker-queue",
      { title: "Planned story", sourceRef: { tool: "story", id: "sp-1" } },
      { getLinks: () => sentTo, setLinks: (u) => sentTo.splice(0, sentTo.length, ...u(sentTo)) }
    );
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start with the queue" }));
    // Only queue stories: nothing to save.
    expect(screen.queryByRole("button", { name: /Save to backlog/ })).toBeNull();
    estimate("8");
    expect(ws().stories.find((s) => s.id === "sp-1")?.points).toBe(8);
    expect(ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID)?.queue ?? []).toHaveLength(
      0
    );
    expect(screen.queryByRole("button", { name: /Save to backlog/ })).toBeNull();

    addStory("Typed here");
    fireEvent.click(screen.getByRole("button", { name: "Save to backlog (1)" }));
    expect(ws().stories.map((s) => s.title)).toEqual(["Planned story", "Typed here"]);
  });

  it("remembers the queue's stories across a reload of a local session", () => {
    const sentTo: HandoffLink[] = [];
    sendHandoff(
      "poker-queue",
      { title: "From the map", sourceRef: { tool: "story-mapper", id: "card-1" } },
      { getLinks: () => sentTo, setLinks: (u) => sentTo.splice(0, sentTo.length, ...u(sentTo)) }
    );
    const first = render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start with the queue" }));
    estimate("5");
    expect(loadQueuedStoryIds()).toHaveLength(1);
    first.unmount();

    render(<PlanningPokerClient />);
    expect(screen.getByRole("heading", { name: "From the map" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save to backlog/ })).toBeNull();
  });

  it("never saves the example's stories", () => {
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.queryByRole("button", { name: /Save to backlog/ })).toBeNull();
    expect(ws().stories).toEqual([]);
  });
});

// ─── Scales, lobby and add-story checks ──────────────────────────────────

describe("decks from lib/constants/scales", () => {
  it("are the same decks stored and broadcast sessions already use", () => {
    expect(SCALES.fibonacci).toEqual(["1", "2", "3", "5", "8", "13", "21", "?", "∞"]);
    expect(SCALES.tshirt).toEqual(["XS", "S", "M", "L", "XL", "XXL", "?"]);
    expect(SCALES.custom).toEqual([]);
    expect(SCALE_LABELS).toEqual({ fibonacci: "Fibonacci", tshirt: "T-Shirt", custom: "Custom" });
    expect(DEFAULT_CUSTOM_DECK).toBe("1, 2, 4, 8, 16, 32");
  });
});

describe("the lobby's checks", () => {
  it("starts with the defaults, and names each problem", () => {
    expect(validateLobby(INITIAL_LOBBY)).toMatchObject({
      ok: true,
      values: { sessionName: "Sprint Planning", scale: SCALES.fibonacci },
    });
    expect(validateLobby({ ...INITIAL_LOBBY, sessionName: " ", displayName: "" })).toEqual({
      ok: false,
      errors: { sessionName: "Name the session.", displayName: "Enter the name the others see." },
    });
    expect(
      validateLobby({ ...INITIAL_LOBBY, sessionName: "x".repeat(201), displayName: "y".repeat(81) })
    ).toMatchObject({
      ok: false,
      errors: {
        sessionName: "Keep the name to 200 characters.",
        displayName: "Keep your name to 80 characters.",
      },
    });
  });

  it("rejects custom decks the room would drop", () => {
    expect(parseCustomDeck(" 1, ,2 ,, 3 ")).toEqual(["1", "2", "3"]);
    expect(customDeckError(["1"])).toBe("Enter at least two values, separated by commas.");
    expect(customDeckError(Array.from({ length: 33 }, (_, i) => String(i)))).toBe(
      "A deck holds up to 32 cards."
    );
    expect(customDeckError(["1", "x".repeat(33)])).toMatch(/^Keep each card to 32 characters/);
    expect(customDeckError(["1", "2", "1"])).toBe("“1” is on the deck twice.");
    expect(customDeckError(["?", "∞"])).toBe("Add at least one size, not only ? or ∞.");
    const ok = validateLobby({ ...INITIAL_LOBBY, scaleType: "custom", customInput: "S, M, L, ?" });
    expect(ok).toMatchObject({ ok: true, values: { scale: ["S", "M", "L", "?"] } });
    if (ok.ok) {
      const session = makeSession({ scale: ok.values.scale, scaleType: "custom" });
      expect(isValidSession(session)).toBe(true);
    }
  });

  it("shows the errors in the lobby and starts nothing", () => {
    render(<PlanningPokerClient />);
    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Card values"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));

    expect(screen.getByText("Name the session.")).toBeInTheDocument();
    expect(screen.getByText("Enter at least two values, separated by commas.")).toBeInTheDocument();
    expect(screen.getByLabelText("Session name")).toHaveFocus();
    expect(screen.queryByPlaceholderText("Story title…")).toBeNull();

    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "Refinement" } });
    fireEvent.change(screen.getByLabelText("Card values"), {
      target: { value: "1, 2, 4, 8, ?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    expect(screen.getByText("Refinement")).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_SESSION_KEY)!) as Session;
    expect(stored.scale).toEqual(["1", "2", "4", "8", "?"]);
  });
});

describe("adding a story", () => {
  it("says so when the title is empty or the queue is full", () => {
    expect(validateStory({ title: "  ", description: "x" }, 0)).toEqual({
      ok: false,
      errors: { title: "Enter a story title." },
    });
    expect(validateStory({ title: "A", description: "" }, MAX_STORIES)).toEqual({
      ok: false,
      errors: { title: QUEUE_FULL },
    });
    expect(validateStory({ title: " A ", description: " d " }, 0)).toEqual({
      ok: true,
      values: { title: "A", description: "d" },
    });
  });

  it("shows the error under the box on Enter, and clears it once fixed", () => {
    render(<Harness initial={makeSession({ stories: [] })} />);
    expect(screen.getByText(/Add a story to begin estimating/)).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a story title.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "Checkout" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(latest.stories.map((s) => s.title)).toEqual(["Checkout"]);
  });
});

describe("the note of queue stories in storage", () => {
  it("round-trips, ignores junk, and goes with the session", () => {
    saveQueuedStoryIds(["a", "b"]);
    expect(loadQueuedStoryIds()).toEqual(["a", "b"]);
    window.localStorage.setItem(QUEUED_IDS_KEY, JSON.stringify(["ok", 5, "", "x".repeat(65)]));
    expect(loadQueuedStoryIds()).toEqual(["ok"]);
    window.localStorage.setItem(QUEUED_IDS_KEY, "{not json");
    expect(loadQueuedStoryIds()).toEqual([]);
    saveQueuedStoryIds(["a"]);
    clearLocalSession();
    expect(window.localStorage.getItem(QUEUED_IDS_KEY)).toBeNull();
    saveQueuedStoryIds([]);
    expect(window.localStorage.getItem(QUEUED_IDS_KEY)).toBeNull();
  });
});
