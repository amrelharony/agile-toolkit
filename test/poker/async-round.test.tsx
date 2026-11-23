import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink, PokerAsyncRound, StoryMap } from "@/lib/stores/workspace-types";

/**
 * Estimate without a meeting on the host's page: a round is blind until
 * Reveal, a reply under a name already in asks before it replaces anything,
 * Accept writes a queue story's estimate back and saves a typed story to the
 * backlog (logging ESTIMATE_COMMITTED with the story's id), "Talk about it
 * live" seeds a session with the round's cards and waits while a session is
 * open, and the queue items a round holds stay out of a session. History
 * payloads hold counts only.
 */

const h = vi.hoisted(() => ({
  auth: null as Partial<AuthContextValue> | null,
  log: vi.fn(),
  undos: [] as { label: string; apply: () => void; revert: () => void }[],
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
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
  useHistoryLogger: () => ({ log: h.log }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/utils/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), message: vi.fn() },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    h.undos.push(a);
    a.apply();
  },
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
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

import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { AsyncRoundsPanel } from "@/app/(tools)/planning-poker/async/async-rounds-panel";
import { AsyncRoundCard } from "@/app/(tools)/planning-poker/async/async-round-card";
import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";
import { sendHandoff } from "@/lib/handoffs/send";
import { STORY_MAP_ID, takeQueuedStoriesById } from "@/lib/handoffs/poker-writeback";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";
import {
  asyncDeckFor,
  encodeReply,
  newAsyncRound,
  newAsyncRoundId,
  packFor,
  validateReply,
} from "@/lib/estimation/async-pack";

const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];
const ws = () => useWorkspaceStore.getState();
const rounds = () => ws().pokerAsyncRounds ?? [];
const queue = () => ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID)?.queue ?? [];
const card = (id: string) =>
  ws()
    .storyMaps?.find((m) => m.id === STORY_MAP_ID)
    ?.slices.flatMap((sl) => Object.values(sl.cards).flat())
    .find((c) => c.id === id);

function storyMap(): StoryMap {
  return {
    id: STORY_MAP_ID,
    steps: [{ id: "st1", name: "Browse" }],
    slices: [
      {
        id: "sl1",
        name: "MVP",
        cards: {
          st1: [
            { id: "c1", title: "Search products", description: "", color: "#00f0ff" },
            { id: "c2", title: "Filter by price", description: "", color: "#00f0ff" },
          ],
        },
      },
    ],
  };
}

function queueCard(id: string, title: string): string {
  let links: HandoffLink[] = [];
  const link = sendHandoff(
    "poker-queue",
    { title, sourceRef: { tool: "story-mapper", id, doc: STORY_MAP_ID } },
    { getLinks: () => links, setLinks: (u) => (links = u(links)) }
  );
  return link!.targetId;
}

function round(over: Partial<PokerAsyncRound> = {}): PokerAsyncRound {
  return {
    id: "async_round000001",
    title: "Checkout stories",
    scaleType: "fibonacci",
    deck: [...FIB],
    stories: [
      { id: "s1", title: "Pay by phone" },
      { id: "s2", title: "Refund a payment" },
    ],
    expected: ["Ana", "Bo", "Cy"],
    dueDate: "2099-11-28",
    replies: [],
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const reply = (id: string, name: string, cards: [string, string], note?: string) => ({
  id,
  name,
  votes: [
    { storyId: "s1", card: cards[0] },
    { storyId: "s2", card: cards[1] },
  ],
  ...(note ? { notes: [{ storyId: "s1", text: note }] } : {}),
  at: new Date().toISOString(),
});

function codeFor(r: PokerAsyncRound, name: string, picks: (string | null)[]): string {
  const v = validateReply(
    { r: r.id, d: r.deck, s: r.stories.map((s) => s.title) },
    {
      name,
      picks,
      notes: [],
    }
  );
  if (!v.ok) throw new Error("bad reply");
  return v.values.code;
}

const article = (title = "Checkout stories") =>
  screen.getByRole("article", { name: title }) as HTMLElement;

/** Every history payload holds counts and ids only. */
function expectCountsOnly(names: string[]) {
  for (const [, payload] of h.log.mock.calls) {
    const text = JSON.stringify(payload ?? {});
    for (const n of names) expect(text, `${text} holds ${n}`).not.toContain(n);
  }
}

beforeEach(() => {
  h.auth = { status: "anonymous", user: null };
  h.log.mockReset();
  h.undos = [];
  window.localStorage.clear();
  useWorkspaceStore.setState({
    storyMaps: [storyMap()],
    pokerEstimationLogs: [],
    pokerAsyncRounds: [],
    stories: [],
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the panel", () => {
  it("makes no claim about where replies are kept: they sync with the workspace", () => {
    render(<AsyncRoundsPanel hostName="Priya" />);
    const intro = screen.getByText(/send the team a link/);
    expect(intro.textContent).toContain("No live room needed");
    expect(intro.textContent).not.toMatch(/server|stored|online/i);
  });
});

describe("a round before Reveal", () => {
  it("is blind: who replied and how many cards, never which", () => {
    useWorkspaceStore.setState({
      pokerAsyncRounds: [
        round({ replies: [reply("a", "Ana", ["13", "5"]), reply("b", "Bo", ["3", "5"], "Big")] }),
      ],
    });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const box = article();
    expect(box.textContent).toContain("2 replies, 4 cards");
    expect(box.textContent).toContain("From Ana, Bo.");
    expect(box.textContent).toContain("Still to reply: Cy.");
    expect(within(box).queryByText("13")).toBeNull();
    expect(box.textContent).not.toContain("Big");
    expect(within(box).queryByRole("button", { name: /^Accept/ })).toBeNull();

    fireEvent.click(within(box).getByRole("button", { name: "Reveal the cards" }));
    expect(rounds()[0].status).toBe("revealed");
    const cards = within(article()).getByRole("list", { name: "Cards for “Pay by phone”" });
    expect(cards.textContent).toBe("Bo 3Ana 13");
    expect(article().textContent).toContain("“Big”, Bo");
    // Far apart: ticked for the live talk; the agreed story isn't.
    expect(rounds()[0].stories.map((s) => Boolean(s.discuss))).toEqual([true, false]);
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.ASYNC_REVEALED, {
      roundId: "async_round000001",
      replies: 2,
      stories: 2,
    });
  });

  it("waits for a first reply before it can reveal", () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [round()] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const reveal = within(article()).getByRole("button", { name: "Reveal the cards" });
    expect((reveal as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("pasting reply codes", () => {
  it("adds a reply, and logs only the count", () => {
    const r = round();
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.change(within(article()).getByLabelText("Paste reply codes"), {
      target: { value: `Here you go: ${codeFor(r, "Lee", ["5", "8"])}` },
    });
    fireEvent.click(within(article()).getByRole("button", { name: "Add replies" }));
    expect(rounds()[0].replies.map((x) => x.name)).toEqual(["Lee"]);
    expect(article().textContent).toContain("Added Lee.");
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.ASYNC_REPLY_ADDED, {
      roundId: r.id,
      replies: 1,
    });
    expectCountsOnly(["Lee"]);
  });

  it("asks before a reply under a name already in: Replace, Keep both or Ignore", () => {
    const r = round({ replies: [reply("a", "Lee", ["1", "1"])] });
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const paste = (value: string) => {
      fireEvent.change(within(article()).getByLabelText("Paste reply codes"), {
        target: { value },
      });
      fireEvent.click(within(article()).getByRole("button", { name: "Add replies" }));
    };

    paste(codeFor(r, "lee", ["8", "8"]));
    expect(article().textContent).toContain("This replaces lee's earlier reply.");
    // Nothing is replaced until the host says so.
    expect(rounds()[0].replies).toHaveLength(1);
    fireEvent.click(within(article()).getByRole("button", { name: "Ignore" }));
    expect(rounds()[0].replies.map((x) => x.votes[0].card)).toEqual(["1"]);

    paste(codeFor(r, "lee", ["8", "8"]));
    fireEvent.click(within(article()).getByRole("button", { name: "Keep both" }));
    expect(rounds()[0].replies.map((x) => x.name)).toEqual(["Lee", "lee (2)"]);

    paste(codeFor(r, "Lee", ["3", "3"]));
    fireEvent.click(within(article()).getByRole("button", { name: "Replace" }));
    expect(rounds()[0].replies.map((x) => [x.name, x.votes[0].card])).toEqual([
      ["lee (2)", "8"],
      ["Lee", "3"],
    ]);
  });

  it("announces each confirmation once, through the app's announcer", async () => {
    const r = round();
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(
      <LiveAnnouncerProvider>
        <AsyncRoundsPanel hostName="Priya" />
      </LiveAnnouncerProvider>
    );
    fireEvent.change(within(article()).getByLabelText("Paste reply codes"), {
      target: { value: codeFor(r, "Lee", ["5", "8"]) },
    });
    fireEvent.click(within(article()).getByRole("button", { name: "Add replies" }));
    await waitFor(() => expect(screen.getByTestId("live-polite").textContent).toBe("Added Lee."));
    // Shown on the card too, but not as a second live region.
    expect(article().textContent).toContain("Added Lee.");
    const live = Array.from(document.querySelectorAll("[aria-live], [role=status]")).filter((el) =>
      el.textContent?.includes("Added Lee.")
    );
    expect(live).toEqual([screen.getByTestId("live-polite")]);
  });

  it("adds a code pasted with its link once, and skips the same reply pasted again", () => {
    const r = round();
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const code = codeFor(r, "Lee", ["5", "8"]);
    const paste = (value: string) => {
      fireEvent.change(within(article()).getByLabelText("Paste reply codes"), {
        target: { value },
      });
      fireEvent.click(within(article()).getByRole("button", { name: "Add replies" }));
    };

    paste(`My cards: ${code}\nor open https://x.test/planning-poker#reply=${code}`);
    expect(rounds()[0].replies.map((x) => x.name)).toEqual(["Lee"]);
    expect(article().textContent).toContain("Added Lee.");
    expect(article().textContent).not.toContain("This replaces");

    paste(code);
    expect(rounds()[0].replies).toHaveLength(1);
    expect(article().textContent).not.toContain("This replaces");
    expect(article().textContent).toContain("Already in with the same cards: Lee.");
    expect(within(article()).queryByRole("button", { name: "Keep both" })).toBeNull();
  });

  it("says why a code can't go in: unreadable, another round, or off the deck", () => {
    const r = round();
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const other = encodeReply({
      roundId: "async_elsewhere01",
      name: "Ana",
      cards: "33",
      notes: [],
    });
    const offDeck = encodeReply({ roundId: r.id, name: "Bo", cards: "f3", notes: [] });
    fireEvent.change(within(article()).getByLabelText("Paste reply codes"), {
      target: { value: `AT1.nonsense ${other} ${offDeck}` },
    });
    fireEvent.click(within(article()).getByRole("button", { name: "Add replies" }));
    const alert = within(article()).getByRole("alert");
    expect(alert.textContent).toContain("couldn't be read");
    expect(alert.textContent).toContain("another round");
    expect(alert.textContent).toContain("isn't on the deck");
    expect(rounds()[0].replies).toEqual([]);
  });

  it("adds the host's own cards under the lobby's name", () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [round()] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(within(article()).getByRole("button", { name: "Add my own cards" }));
    fireEvent.click(
      within(
        within(article()).getByRole("radiogroup", { name: "Your card for “Pay by phone”" })
      ).getByRole("radio", { name: "5" })
    );
    fireEvent.click(within(article()).getByRole("button", { name: "Add my cards" }));
    expect(rounds()[0].replies.map((x) => [x.name, x.votes])).toEqual([
      ["Priya", [{ storyId: "s1", card: "5" }]],
    ]);
  });
});

describe("accepting an estimate after Reveal", () => {
  it("writes a queue story's estimate back to its card", () => {
    const q1 = queueCard("c1", "Search products");
    const [taken] = takeQueuedStoriesById([q1]);
    const r = round({
      status: "revealed",
      stories: [{ id: taken.id, title: "Search products" }],
      replies: [
        { id: "a", name: "Ana", votes: [{ storyId: taken.id, card: "5" }], at: "x" },
        { id: "b", name: "Bo", votes: [{ storyId: taken.id, card: "5" }], at: "x" },
      ],
    });
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(within(article()).getByRole("button", { name: "Accept 5" }));
    expect(card("c1")?.estimate).toBe("5");
    expect(queue()).toEqual([]);
    expect(rounds()[0].stories[0].finalEstimate).toBe("5");
    expect(article().textContent).toContain("Agreed: 5");
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.ESTIMATE_COMMITTED, {
      storyId: taken.id,
      title: "Search products",
      value: "5",
      via: "async",
    });
  });

  it("saves a typed story to the backlog with its points, with Undo", () => {
    const r = round({
      status: "revealed",
      replies: [reply("a", "Ana", ["3", "8"]), reply("b", "Bo", ["5", "8"])],
    });
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const refund = within(article())
      .getAllByRole("listitem")
      .find((li) => li.textContent?.startsWith("2. Refund a payment")) as HTMLElement;
    fireEvent.click(within(refund).getByRole("button", { name: "Accept 8" }));
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Refund a payment",
        points: 8,
        sourceRef: { tool: "planning-poker", id: "s2" },
      }),
    ]);
    expect(rounds()[0].stories[1].finalEstimate).toBe("8");
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.ESTIMATE_COMMITTED, {
      storyId: "s2",
      title: "Refund a payment",
      value: "8",
      via: "async",
    });
    act(() => h.undos.at(-1)!.revert());
    expect(ws().stories).toEqual([]);
    expect(rounds()[0].stories[1].finalEstimate).toBeUndefined();
  });
});

describe("talking about it live", () => {
  const revealed = () =>
    round({
      status: "revealed",
      stories: [
        { id: "s1", title: "Pay by phone", discuss: true },
        { id: "s2", title: "Refund a payment" },
      ],
      replies: [reply("a", "Ana", ["13", "5"]), reply("b", "Bo", ["3", "5"])],
    });

  it("opens a session with the flagged stories, their cards as the first round", () => {
    const onTalkLive = vi.fn();
    render(
      <AsyncRoundCard round={revealed()} hostName="Priya" log={h.log} onTalkLive={onTalkLive} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Talk about it live (1)" }));
    expect(onTalkLive).toHaveBeenCalledWith({
      sessionName: "Checkout stories",
      scale: FIB,
      scaleType: "fibonacci",
      displayName: "Priya",
      stories: [{ id: "s1", title: "Pay by phone", finalEstimate: null, rounds: [["3", "13"]] }],
    });
  });

  it("waits while a session is open", () => {
    const onTalkLive = vi.fn();
    render(
      <AsyncRoundCard
        round={revealed()}
        hostName="Priya"
        log={h.log}
        sessionOpen
        onTalkLive={onTalkLive}
      />
    );
    const talk = screen.getByRole("button", { name: "Talk about it live (1)" });
    expect((talk as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("End the current session first.")).toBeTruthy();
    fireEvent.click(talk);
    expect(onTalkLive).not.toHaveBeenCalled();
  });

  it("starts the session on the Poker page under the round's story ids", async () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [revealed()] });
    render(<PlanningPokerClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Talk about it live (1)" }));
    expect(await screen.findByRole("heading", { name: "Pay by phone" })).toBeTruthy();
    // The round's cards are the story's first round.
    expect(screen.getByRole("list", { name: "Voting rounds" }).textContent).toBe("Round 1: 3 · 13");
  });

  /** In the live session: vote, reveal and accept the one card. */
  function voteRevealAccept(value: string) {
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
        name: value,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
    fireEvent.click(screen.getByRole("button", { name: `Accept ${value}` }));
  }

  it("agrees a queue story accepted live on its round, and writes it back once", async () => {
    const q1 = queueCard("c1", "Search products");
    const [taken] = takeQueuedStoriesById([q1]);
    useWorkspaceStore.setState({
      pokerAsyncRounds: [
        round({
          status: "revealed",
          stories: [{ id: taken.id, title: "Search products", discuss: true }],
          replies: [
            { id: "a", name: "Ana", votes: [{ storyId: taken.id, card: "3" }], at: "x" },
            { id: "b", name: "Bo", votes: [{ storyId: taken.id, card: "13" }], at: "x" },
          ],
        }),
      ],
    });
    render(<PlanningPokerClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Talk about it live (1)" }));
    expect(await screen.findByRole("heading", { name: "Search products" })).toBeTruthy();

    voteRevealAccept("8");
    expect(card("c1")?.estimate).toBe("8");
    expect(queue()).toEqual([]);
    expect(rounds()[0].stories[0]).toMatchObject({ finalEstimate: "8", discuss: false });
    // Written back where it came from, so no backlog story is made.
    expect(ws().stories).toEqual([]);
  });

  it("saves a typed story accepted live to the backlog, as Accept on the round does", async () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [revealed()] });
    render(<PlanningPokerClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Talk about it live (1)" }));
    expect(await screen.findByRole("heading", { name: "Pay by phone" })).toBeTruthy();

    voteRevealAccept("5");
    expect(rounds()[0].stories[0].finalEstimate).toBe("5");
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Pay by phone",
        points: 5,
        sourceRef: { tool: "planning-poker", id: "s1" },
      }),
    ]);
    // One Undo takes back the backlog story and the round's agreed card.
    act(() => h.undos.at(-1)!.revert());
    expect(ws().stories).toEqual([]);
    expect(rounds()[0].stories[0].finalEstimate).toBeUndefined();
  });
});

describe("keyboard focus", () => {
  it("follows a clash, then lands on the round's heading after Reveal and Close", () => {
    const r = round({ replies: [reply("a", "Lee", ["1", "1"])] });
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    const heading = () => screen.getByRole("heading", { name: "Checkout stories" });
    /** Press a button the way a keyboard does: focused, then clicked. */
    const press = (name: string) => {
      const button = within(article()).getByRole("button", { name });
      button.focus();
      fireEvent.click(button);
    };

    fireEvent.change(within(article()).getByLabelText("Paste reply codes"), {
      target: { value: codeFor(r, "Lee", ["8", "8"]) },
    });
    press("Add replies");
    expect(document.activeElement).toBe(
      within(article()).getByRole("group", { name: "Lee's reply" })
    );
    press("Ignore");
    expect(document.activeElement).toBe(within(article()).getByLabelText("Paste reply codes"));

    press("Reveal the cards");
    expect(rounds()[0].status).toBe("revealed");
    expect(document.activeElement).toBe(heading());
    press("Close the round");
    expect(rounds()[0].status).toBe("closed");
    expect(document.activeElement).toBe(heading());
  });

  it("goes back to “Add my own cards” once the host's cards are in", () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [round()] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(within(article()).getByRole("button", { name: "Add my own cards" }));
    fireEvent.click(
      within(
        within(article()).getByRole("radiogroup", { name: "Your card for “Pay by phone”" })
      ).getByRole("radio", { name: "5" })
    );
    const add = within(article()).getByRole("button", { name: "Add my cards" });
    add.focus();
    fireEvent.click(add);
    expect(rounds()[0].replies).toHaveLength(1);
    expect(document.activeElement).toBe(
      within(article()).getByRole("button", { name: "Add my own cards" })
    );
  });
});

describe("closing and deleting", () => {
  it("close drops names and notes, with Undo", () => {
    const r = round({
      status: "revealed",
      replies: [reply("a", "Ana", ["3", "8"], "Bank API")],
    });
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(within(article()).getByRole("button", { name: "Close the round" }));
    expect(rounds()[0].status).toBe("closed");
    expect(JSON.stringify(rounds()[0])).not.toMatch(/Ana|Bank API/);
    expect(article().textContent).toContain("Names and notes were dropped");
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.ASYNC_CLOSED, {
      roundId: r.id,
      estimated: 0,
    });
    act(() => h.undos.at(-1)!.revert());
    expect(rounds()[0].replies[0].name).toBe("Ana");
  });

  it("delete takes the round away, with Undo", () => {
    useWorkspaceStore.setState({ pokerAsyncRounds: [round()] });
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete “Checkout stories”" }));
    expect(rounds()).toEqual([]);
    act(() => h.undos.at(-1)!.revert());
    expect(rounds()).toHaveLength(1);
  });
});

describe("a new round", () => {
  it("stamps only the ticked queue stories and logs counts only", () => {
    const q1 = queueCard("c1", "Search products");
    const q2 = queueCard("c2", "Filter by price");
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(screen.getByRole("button", { name: "New round" }));
    fireEvent.change(screen.getByLabelText(/Round name/), { target: { value: "Search work" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Search products" }));
    fireEvent.change(screen.getByLabelText(/Or type stories/), {
      target: { value: "Save a search\n\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make the link" }));

    const [made] = rounds();
    expect(made.title).toBe("Search work");
    expect(made.stories.map((s) => s.title)).toEqual(["Search products", "Save a search"]);
    const stamped = queue().find((q) => q.id === q1)!.sessionStoryId;
    expect(made.stories[0].id).toBe(stamped);
    expect(queue().find((q) => q.id === q2)!.sessionStoryId).toBeUndefined();
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.ASYNC_ROUND_CREATED, {
      roundId: made.id,
      stories: 2,
    });
    expectCountsOnly(["Search work", "Save a search"]);
    // The round's link is ready to copy.
    expect(within(article("Search work")).getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("checks the link's length with the round's real id, so a round that passes fits", () => {
    // The pack's JSON in bytes for these titles, with an id as long as a real one.
    const packBytes = (titles: string[]) =>
      new TextEncoder().encode(
        JSON.stringify(
          packFor(
            newAsyncRound(
              {
                title: "Big",
                scaleType: "fibonacci",
                deck: asyncDeckFor("fibonacci"),
                stories: titles.map((title, i) => ({ id: `t${i}`, title })),
              },
              newAsyncRoundId(),
              ""
            ),
            { host: "Priya" }
          )
        )
      ).length;
    // 4,500 bytes are exactly 6,000 base64url characters, the cap; one more is 6,002.
    const titlesAt = (bytes: number) => {
      const base = Array.from({ length: 12 }, () => "估".repeat(120));
      // One ASCII character is one byte ("" would become "Untitled story").
      const pad = bytes - packBytes([...base, "a"]) + 1;
      expect(pad).toBeGreaterThan(0);
      expect(pad).toBeLessThanOrEqual(120);
      return [...base, "a".repeat(pad)];
    };
    const makeRound = (titles: string[]) => {
      fireEvent.click(screen.getByRole("button", { name: "New round" }));
      fireEvent.change(screen.getByLabelText(/Round name/), { target: { value: "Big" } });
      fireEvent.change(screen.getByLabelText(/Stories, one per line/), {
        target: { value: titles.join("\n") },
      });
      fireEvent.click(screen.getByRole("button", { name: "Make the link" }));
    };
    render(<AsyncRoundsPanel hostName="Priya" />);

    // One byte over: refused in the form, before anything is saved.
    makeRound(titlesAt(4501));
    expect(screen.getByText(/Split the stories into two rounds/)).toBeTruthy();
    expect(rounds()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Right at the cap: saved, and its card offers the link.
    makeRound(titlesAt(4500));
    expect(rounds()).toHaveLength(1);
    expect(rounds()[0].id).toMatch(/^async_[0-9a-f]{12}$/);
    const box = article("Big");
    expect(within(box).getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(box.textContent).not.toContain("Too long for one link");
  });

  it("strips hidden direction marks from queued and typed titles, never “Untitled story”", () => {
    const q1 = queueCard("c1", "‏بحث المنتجات");
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(screen.getByRole("button", { name: "New round" }));
    fireEvent.change(screen.getByLabelText(/Round name/), {
      target: { value: "؜مراجعة" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "‏بحث المنتجات" }));
    fireEvent.change(screen.getByLabelText(/Or type stories/), {
      target: { value: "دفع بالهاتف‏\n‏" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make the link" }));

    const [made] = rounds();
    expect(made.title).toBe("مراجعة");
    expect(made.stories.map((s) => s.title)).toEqual(["بحث المنتجات", "دفع بالهاتف"]);
    expect(made.stories[0].id).toBe(queue().find((q) => q.id === q1)!.sessionStoryId);
  });

  it("says what's missing, and refuses a round too long for one link before stamping", () => {
    const q1 = queueCard("c1", "Search products");
    render(<AsyncRoundsPanel hostName="Priya" />);
    fireEvent.click(screen.getByRole("button", { name: "New round" }));
    fireEvent.click(screen.getByRole("button", { name: "Make the link" }));
    expect(screen.getByText("Name the round.")).toBeTruthy();
    expect(screen.getByText(/Tick a queued story or type/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Round name/), { target: { value: "Big" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Search products" }));
    fireEvent.change(screen.getByLabelText(/Or type stories/), {
      target: { value: Array.from({ length: 19 }, () => "估".repeat(120)).join("\n") },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make the link" }));
    expect(screen.getByText(/Split the stories into two rounds/)).toBeTruthy();
    expect(rounds()).toEqual([]);
    expect(queue().find((q) => q.id === q1)!.sessionStoryId).toBeUndefined();
  });
});

describe("the Poker page", () => {
  it("keeps a round's queue stories out of a session, and says how many it holds", async () => {
    const q1 = queueCard("c1", "Search products");
    queueCard("c2", "Filter by price");
    const [held] = takeQueuedStoriesById([q1]);
    useWorkspaceStore.setState({
      pokerAsyncRounds: [round({ stories: [{ id: held.id, title: "Search products" }] })],
    });
    render(<PlanningPokerClient />);
    expect(screen.getByText(/1 story queued for estimation/).textContent).toContain(
      "1 in an async round"
    );
    fireEvent.click(screen.getByRole("button", { name: "Start with the queue" }));
    expect(await screen.findByRole("heading", { name: "Filter by price" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Search products" })).toBeNull();
    // The held item keeps the id its round knows it by.
    expect(queue().find((q) => q.id === q1)!.sessionStoryId).toBe(held.id);
  });

  it("asks before adding a reply opened from its link, then clears the address", async () => {
    const r = round();
    useWorkspaceStore.setState({ pokerAsyncRounds: [r] });
    window.history.replaceState(null, "", `/planning-poker#reply=${codeFor(r, "Lee", ["5", "8"])}`);
    render(<PlanningPokerClient />);
    expect(await screen.findByText("Add Lee's cards to “Checkout stories”?")).toBeTruthy();
    expect(rounds()[0].replies).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rounds()[0].replies.map((x) => x.name)).toEqual(["Lee"]);
    expect(window.location.hash).toBe("");
    expect(screen.getByText("Added Lee's cards to “Checkout stories”.")).toBeTruthy();
    expectCountsOnly(["Lee"]);
  });

  it("says to open a reply on the device that made the round", async () => {
    const r = round();
    window.history.replaceState(null, "", `/planning-poker#reply=${codeFor(r, "Lee", ["5", "8"])}`);
    render(<PlanningPokerClient />);
    expect(await screen.findByText(/isn't in this browser/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/isn't in this browser/)).toBeNull());
    expect(window.location.hash).toBe("");
  });

  it("closes a round past its 14 days when the page loads, dropping names", async () => {
    const old = round({
      createdAt: "2026-01-01T10:00:00.000Z",
      dueDate: "2026-01-05",
      replies: [reply("a", "Ana", ["3", "8"])],
    });
    useWorkspaceStore.setState({ pokerAsyncRounds: [old] });
    render(<PlanningPokerClient />);
    await waitFor(() => expect(rounds()[0].status).toBe("closed"));
    expect(JSON.stringify(rounds()[0])).not.toContain("Ana");
  });
});
