import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import { lockOf, type RoomSnapshot } from "@/app/(tools)/retro/room/protocol";
import { toRoomSnapshot } from "@/app/(tools)/retro/room/snapshot";
import { exportToMarkdown } from "@/lib/utils/export";
import { fakeRealtime, type FakeMember } from "./fake-realtime";

/**
 * The Retro visitor room's UI: the Board's two ways to run it, "One screen"
 * and "Everyone on their own device" (flag on, visitors only, nothing opens
 * before consent), and the participant view.
 */

/** The button that opens a live room (it was "Go live"). */
const GO_LIVE = "Everyone on their own device";

const h = vi.hoisted(() => ({
  auth: null as unknown,
  realtime: true,
  undo: null as null | { label: string; apply: () => void; revert: () => void },
  /** Every config the Board handed the AI prompt panel, oldest first. */
  prompts: [] as unknown[],
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => h.realtime, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/export")>()),
  exportToMarkdown: vi.fn(),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    h.undo = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: unknown }) => {
    h.prompts.push(config);
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test-run" }),
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

import { Board } from "@/app/(tools)/retro/components/board";
import { VisitorRetroRoom } from "@/app/(tools)/retro/room/visitor-retro-room";

const logger: HistoryLogger = { log: () => {}, toolRunId: "test-run" };
const VISITOR = { status: "anonymous", user: null };
const OWNER = { status: "authenticated", user: { id: "owner-1", email: "o@example.com" } };
const CODE = "ABCDEFGHJKMN";
const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-19T09:00:00Z" };
const ME: FakeMember = { id: "self_00000000000", name: "Pat", joinedAt: "2026-10-19T09:01:00Z" };

function card(id: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey: "start",
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

function makeBoard(overrides: Partial<BoardState> = {}): BoardState {
  return {
    format: retroFormats[0],
    phase: "write",
    cards: [card("a"), card("b", { columnKey: "stop" })],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

function Harness({ initial, onReset = () => {} }: { initial: BoardState; onReset?: () => void }) {
  const [state, setState] = useState(initial);
  return (
    <Board
      state={state}
      onUpdate={(updater) => setState((prev) => updater(prev))}
      onReset={onReset}
      logger={logger}
    />
  );
}

function hostSnapshot(
  b: BoardState,
  seq = 1,
  extra: Partial<{
    hide: boolean;
    by: FakeMember;
    votesUsed: Record<string, number>;
    votes: number;
  }> = {}
): RoomSnapshot {
  const by = extra.by ?? HOST;
  return JSON.parse(
    JSON.stringify(
      toRoomSnapshot(b, {
        by: by.id,
        seq,
        endsAt: Date.now() + VISITOR_LIMITS.hardTtlMs,
        members: [by, ME].map(({ id, name }) => ({ id, name })),
        votesUsed: extra.votesUsed ?? {},
        timer: { running: false, remaining: b.timerSeconds },
        now: Date.now(),
        hideWhileWriting: extra.hide ?? false,
        votesPerPerson: extra.votes ?? 3,
      })
    )
  ) as RoomSnapshot;
}

type SentIntent = { intent: { t: string; iid: string; cardId?: string; text?: string } };

/** Fill in and confirm the consent dialog. */
/** Agrees and starts the room, then waits for it: the open room loads only now (next/dynamic). */
async function consentAs(name: string) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
  await waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalled());
}

// The open room's module, warmed so the first wait for it is short.
beforeAll(() => import("@/app/(tools)/retro/room/host-live-session"));

beforeEach(() => {
  h.auth = VISITOR;
  h.realtime = true;
  h.undo = null;
  h.prompts = [];
  vi.mocked(exportToMarkdown).mockClear();
  fakeRealtime.reset();
  useWorkspaceStore.setState({ retroBoards: [] });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
});

describe("Everyone on their own device, on the Retro board", () => {
  it("is hidden while the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    render(<Harness initial={makeBoard()} />);
    expect(screen.queryByRole("button", { name: GO_LIVE })).toBeNull();
    expect(screen.queryByText("One screen")).toBeNull();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("sits beside One screen, the way the board runs now, with the room's limits", () => {
    render(<Harness initial={makeBoard()} />);
    const group = screen.getByRole("group", { name: "How you run this retro" });
    expect(within(group).getByText("One screen")).toBeInTheDocument();
    expect(within(group).getByText(/how it runs now/)).toBeInTheDocument();
    // One screen is the board itself: there is nothing to press.
    expect(within(group).getAllByRole("button")).toHaveLength(1);
    const live = within(group).getByRole("button", { name: GO_LIVE });
    const hours = Math.round(VISITOR_LIMITS.hardTtlMs / 3_600_000);
    expect(live).toHaveAccessibleDescription(
      `No account needed, for you or your guests. Up to ${VISITOR_LIMITS.maxMembers} people, for up to ${hours} hours. We store nothing.`
    );
  });

  it("is hidden for the owner", () => {
    h.auth = OWNER;
    render(<Harness initial={makeBoard()} />);
    expect(screen.queryByRole("button", { name: GO_LIVE })).toBeNull();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("opens no channel before consent, and one visitor channel after it", async () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/passes through our realtime provider/i);
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();

    // Cancelling opens nothing either.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1);
    expect(fakeRealtime.last().name).toMatch(/^visitor:retro:[23456789A-HJKMNP-Z]{12}$/);
    expect(screen.getByText("Live room")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: GO_LIVE })).toBeNull();
  });

  it("says how to share the room once it is live: Copy link or Show QR code", async () => {
    render(
      <LiveAnnouncerProvider>
        <Harness initial={makeBoard()} />
      </LiveAnnouncerProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    act(() => fakeRealtime.last().connect());
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Live room started. Share it with your team: Copy link or Show QR code."
      )
    );
  });

  it("hides the participants' cards on the host's screen while people write", async () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    const hide = screen.getByRole("switch", { name: "Hide cards while writing" });
    expect(hide).toBeChecked();
    expect(hide).toHaveAccessibleDescription(
      "Until you move to Vote, each person sees only their own cards. This screen hides them too."
    );

    act(() =>
      ch.deliver("retro:intent", {
        v: 2,
        by: ME.id,
        intent: {
          t: "card:add",
          iid: "patCard01",
          columnKey: "start",
          text: "Pat's secret",
          lock: lockOf("pat_card_key_00000"),
        },
      })
    );
    // On the host's board, not on its screen: a count instead.
    expect(screen.queryByText("Pat's secret")).toBeNull();
    expect(screen.getByText("1 card from others, hidden until Vote")).toBeInTheDocument();
    expect(
      screen.getByText(/stay hidden until you move to Vote, on this screen too/)
    ).toBeVisible();
    // The host's own cards still show.
    expect(screen.getByText("Card a")).toBeInTheDocument();

    // Switched off: everyone's cards show, here and in the room.
    fireEvent.click(hide);
    expect(hide).not.toBeChecked();
    expect(screen.getByText("Pat's secret")).toBeInTheDocument();
    expect(screen.queryByText(/hidden until Vote/)).toBeNull();

    // Back on, then Next Phase reveals them.
    fireEvent.click(hide);
    expect(screen.queryByText("Pat's secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /next phase/i }));
    expect(screen.getByText("Pat's secret")).toBeInTheDocument();
  });

  it("never puts a hidden card's text in the host's page, not even for one render", async () => {
    // Ten cards of the host's, two sharing a word, so Common words shows.
    const words = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
    const own = [
      card("p1", { text: "Pairing sessions helped" }),
      card("p2", { text: "Pairing with juniors", columnKey: "continue" }),
      ...words.map((w, i) => card(`w${i}`, { text: w, columnKey: "stop" })),
    ];
    render(<Harness initial={makeBoard({ cards: own })} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    expect(screen.getByRole("button", { name: /^pairing/ })).toHaveTextContent("2 cards");

    // Every node the page inserts while the card lands, kept even if removed again,
    // and every prompt the AI panel is handed meanwhile.
    h.prompts = [];
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    act(() =>
      ch.deliver("retro:intent", {
        v: 2,
        by: ME.id,
        intent: {
          t: "card:add",
          iid: "patCard02",
          columnKey: "start",
          text: "Pairing is Pat's secret",
          lock: lockOf("pat_card_key_00000"),
        },
      })
    );
    const drawn = observer
      .takeRecords()
      .flatMap((r) =>
        r.type === "characterData"
          ? [r.target.textContent ?? ""]
          : Array.from(r.addedNodes, (n) => n.textContent ?? "")
      );
    observer.disconnect();
    expect(drawn.join("\n")).not.toContain("Pat's secret");
    expect(h.prompts.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.prompts)).not.toContain("Pat's secret");
    expect(screen.getByText("1 card from others, hidden until Vote")).toBeInTheDocument();
    // Its words stay out of Common words too.
    expect(screen.getByRole("button", { name: /^pairing/ })).toHaveTextContent("2 cards");

    fireEvent.click(screen.getByRole("button", { name: /next phase/i }));
    expect(screen.getByText("Pairing is Pat's secret")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pairing/ })).toHaveTextContent("3 cards");
    expect(JSON.stringify(h.prompts.at(-1))).toContain("Pat's secret");
  });

  it("ends the room on request and keeps the board", async () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    const ch = fakeRealtime.last();
    act(() => ch.connect());

    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    const confirm = screen.getByRole("dialog");
    expect(confirm).toHaveTextContent(/your board stays here/i);
    fireEvent.click(within(confirm).getByRole("button", { name: "End room" }));

    expect(ch.sent("retro:end")).toHaveLength(1);
    expect(ch.removed).toBe(true);
    expect(screen.getByRole("button", { name: GO_LIVE })).toBeInTheDocument();
    expect(screen.getByText("Card a")).toBeInTheDocument();
  });

  it("ends the room before New Retro clears the board", async () => {
    const onReset = vi.fn();
    render(<Harness initial={makeBoard()} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    const ch = fakeRealtime.last();
    act(() => ch.connect());

    fireEvent.click(screen.getByRole("button", { name: /new retro/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Start new retro" })
    );
    expect(ch.sent("retro:end")).toHaveLength(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("closes the room if this browser turns out to be the owner's", async () => {
    const { rerender } = render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    await consentAs("Hana");
    const ch = fakeRealtime.last();
    act(() => ch.connect());

    h.auth = OWNER;
    rerender(<Harness initial={makeBoard()} />);
    expect(ch.sent("retro:end")).toHaveLength(1);
    expect(ch.removed).toBe(true);
    expect(screen.queryByText("Live room")).toBeNull();
  });
});

describe("VisitorRetroRoom (participant)", () => {
  const identity = { id: ME.id, name: ME.name };

  it("shows 'Live rooms are off' and opens nothing while the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    const onLeave = vi.fn();
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={onLeave} />);
    expect(screen.getByRole("heading", { name: "Live rooms are off" })).toBeInTheDocument();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("renders the host's board read-only, sends cards as intents, and saves a copy on request", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/connecting/i);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard())));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(retroFormats[0].name);
    expect(screen.getByText("Hosted by Hana. You are Pat.")).toBeInTheDocument();
    expect(screen.getByText("Card a")).toBeInTheDocument();
    // Participants don't delete the host's cards, or group any.
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete my card" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /group with/i })).toBeNull();

    const input = screen.getByRole("textbox", { name: "New card for Start" });
    fireEvent.change(input, { target: { value: "More pairing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ch.sent("retro:intent")).toEqual([
      {
        v: 2,
        by: ME.id,
        intent: expect.objectContaining({
          t: "card:add",
          columnKey: "start",
          text: "More pairing",
        }),
      },
    ]);
    // The board changes only when the host's next snapshot says so.
    expect(screen.queryByText("More pairing")).toBeNull();

    // Vote phase: votes left, and no card input.
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard({ phase: "vote" }), 2)));
    expect(screen.getByText("3 votes left")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "New card for Start" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /vote for this card/i })[0]);
    expect(ch.sent("retro:intent").at(-1)).toEqual({
      v: 2,
      by: ME.id,
      intent: expect.objectContaining({ t: "vote", cardId: "a" }),
    });
    expect(screen.getByText("2 votes left")).toBeInTheDocument();

    // The store is untouched until "Save a copy".
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
    act(() => ch.deliver("retro:end", { by: HOST.id }));
    expect(screen.getByRole("heading", { name: "The host ended the room" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    const saved = useWorkspaceStore.getState().retroBoards ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0].archivedAt).toEqual(expect.any(String));
    expect(saved[0].id).not.toBe("retro:current");
    expect(saved[0].cards.map((c) => c.text)).toEqual(["Card a", "Card b"]);
    expect(screen.getByRole("button", { name: "Saved to Past retros" })).toBeDisabled();
  });

  it("hides everyone else's cards while people write, and deletes my own with Undo", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard(), 1, { hide: true })));

    // The host's cards are a count, not text.
    expect(screen.queryByText("Card a")).toBeNull();
    expect(screen.getByText(/You see only yours/)).toBeInTheDocument();
    expect(screen.getAllByText("1 card from others, hidden until Vote")).toHaveLength(2);
    expect(screen.getByText("2 cards")).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "New card for Start" });
    fireEvent.change(input, { target: { value: "My own idea" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // My card shows at once, from this tab's memory, with Delete my card.
    expect(screen.getByText("My own idea")).toBeInTheDocument();
    const [sent] = ch.sent("retro:intent") as SentIntent[];
    const id = sent.intent.iid;

    fireEvent.click(screen.getByRole("button", { name: "Delete my card" }));
    expect(screen.queryByText("My own idea")).toBeNull();
    expect((ch.sent("retro:intent") as SentIntent[]).at(-1)!.intent).toMatchObject({
      t: "card:delete",
      cardId: id,
    });
    expect(h.undo?.label).toBe("Deleted “My own idea”");
    // Undo before the host answered: the card is back as it was, and no copy
    // is sent (the tab adds it again only if the delete turns out to have landed).
    const sentBefore = ch.sent("retro:intent").length;
    act(() => h.undo!.revert());
    expect(ch.sent("retro:intent")).toHaveLength(sentBefore);
    expect(screen.getByText("My own idea")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete my card" })).toBeInTheDocument();

    // Vote: every card's text arrives.
    act(() =>
      ch.deliver("retro:state", hostSnapshot(makeBoard({ phase: "vote" }), 2, { hide: true }))
    );
    expect(screen.getByText("Card a")).toBeInTheDocument();
    expect(screen.queryByText(/hidden until Vote/)).toBeNull();
  });

  it("shows the host's own columns, empty ones too, and the votes each person has", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    const custom = {
      id: "custom-abc12345",
      name: "Team pulse",
      description: "",
      columns: [
        { key: "wins", label: "Wins", color: "#00f0ff", icon: "" },
        { key: "worries", label: "Worries", color: "#00ff88", icon: "" },
        { key: "ideas", label: "Ideas", color: "#f59e0b", icon: "" },
      ],
    };
    const b = makeBoard({
      format: custom,
      phase: "vote",
      cards: [card("w", { columnKey: "wins" })],
    });
    act(() => ch.deliver("retro:state", hostSnapshot(b, 1, { votes: 8 })));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Team pulse");
    for (const label of ["Wins", "Worries", "Ideas"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("8 votes left")).toBeInTheDocument();
    expect(screen.getByText(/Vote on cards \(8 votes each\)/)).toBeInTheDocument();

    // The file is named after the format, as the host's own export is.
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    const [, filename] = vi.mocked(exportToMarkdown).mock.calls[0];
    expect(filename).toMatch(/^retro-team-pulse-\d{4}-\d{2}-\d{2}$/);
    // A copy keeps the columns and the votes each.
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    const [copy] = useWorkspaceStore.getState().retroBoards ?? [];
    expect(copy.format.name).toBe("Team pulse");
    expect(copy.format.columns.map((c) => c.label)).toEqual(["Wins", "Worries", "Ideas"]);
    expect(copy.votesPerPerson).toBe(8);
  });

  it("says when the host opens a thumbs vote, and the totals when it closes", async () => {
    render(
      <LiveAnnouncerProvider>
        <VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />
      </LiveAnnouncerProvider>
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    const board = makeBoard({ phase: "discuss" });
    act(() => ch.deliver("retro:state", hostSnapshot(board)));
    const withPoll = (seq: number, poll: Record<string, unknown>) => ({
      ...hostSnapshot(board, seq),
      poll,
    });
    const open = { id: "poll_0000000001", topic: "Standups", open: true, voters: 0 };
    act(() => ch.deliver("retro:state", withPoll(2, open)));
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "The host asks: keep going or move on? Standups"
      )
    );
    // A later snapshot of the same open vote says nothing new.
    act(() => ch.deliver("retro:state", withPoll(3, { ...open, voters: 1 })));
    act(() =>
      ch.deliver("retro:state", withPoll(4, { ...open, open: false, voters: 2, keep: 2, move: 0 }))
    );
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "The vote is closed. Keep going 2, move on 0. Most want to keep going."
      )
    );
  });

  it("takes my vote back", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard({ phase: "vote" }))));
    expect(screen.queryByRole("button", { name: "Take my vote back" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /vote for this card/i })[0]);
    expect(screen.getByText("2 votes left")).toBeInTheDocument();
    const back = screen.getByRole("button", { name: "Take my vote back" });
    fireEvent.click(back);
    expect((ch.sent("retro:intent") as SentIntent[]).at(-1)!.intent).toMatchObject({
      t: "vote:undo",
      cardId: "a",
    });
    expect(screen.getByText("3 votes left")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take my vote back" })).toBeNull();
  });

  it("tells me to add my cards again when the host leaves while they are hidden", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    try {
      const other: FakeMember = {
        id: "other_0000000000",
        name: "Olu",
        joinedAt: "2026-10-19T08:59:00Z", // earlier than me: Olu takes over
      };
      render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
      const ch = fakeRealtime.last();
      act(() => {
        ch.connect();
        ch.setPresence([HOST, other, ME]);
      });
      act(() => ch.deliver("retro:state", hostSnapshot(makeBoard(), 1, { hide: true })));
      const input = screen.getByRole("textbox", { name: "New card for Stop" });
      fireEvent.change(input, { target: { value: "Fewer meetings" } });
      fireEvent.keyDown(input, { key: "Enter" });
      const start = screen.getByRole("textbox", { name: "New card for Start" });
      fireEvent.change(start, { target: { value: "More demos" } });
      fireEvent.keyDown(start, { key: "Enter" });

      act(() => ch.setPresence([other, ME]));
      act(() => vi.advanceTimersByTime(10_000));
      act(() =>
        ch.deliver(
          "retro:state",
          hostSnapshot(makeBoard({ cards: [] }), 2, { hide: true, by: other })
        )
      );
      expect(
        screen.getByText("The host left. Cards written so far were not shared; add yours again.")
      ).toBeInTheDocument();
      const list = screen.getByRole("list", { name: "Your cards from before" });
      expect(within(list).getByText("Fewer meetings")).toBeInTheDocument();
      expect(within(list).getByText("Stop")).toBeInTheDocument();
      const before = ch.sent("retro:intent").length;
      fireEvent.click(within(list).getByRole("button", { name: "Add “Fewer meetings” again" }));
      expect(ch.sent("retro:intent")).toHaveLength(before + 1);
      // Its button left with it: focus moves to the next card's.
      expect(screen.getByRole("button", { name: "Add “More demos” again" })).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "Add “More demos” again" }));
      expect(screen.queryByRole("list", { name: "Your cards from before" })).toBeNull();
      // None left: focus rests on the notice.
      expect(
        screen.getByText("The host left. Cards written so far were not shared; add yours again.")
      ).toHaveFocus();
      // Back on my board, as my own cards.
      expect(screen.getAllByRole("button", { name: "Delete my card" })).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the host controls to the member elected after the host leaves", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    try {
      const other: FakeMember = {
        id: "other_0000000000",
        name: "Olu",
        joinedAt: "2026-10-19T09:02:00Z",
      };
      render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
      const ch = fakeRealtime.last();
      act(() => {
        ch.connect();
        ch.setPresence([HOST, ME, other]);
      });
      act(() => ch.deliver("retro:state", hostSnapshot(makeBoard())));
      expect(screen.queryByRole("button", { name: /next phase/i })).toBeNull();

      act(() => ch.setPresence([ME, other]));
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText("The host left, so you are hosting this room now.")).toBeVisible();
      expect(screen.getByRole("button", { name: "End room" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove Olu from the room" })).toBeInTheDocument();
      // The host's setting comes with it, as the old host had it.
      expect(screen.getByRole("switch", { name: "Hide cards while writing" })).not.toBeChecked();

      fireEvent.click(screen.getByRole("button", { name: /next phase/i }));
      act(() => vi.advanceTimersByTime(600));
      const latest = ch.sent("retro:state").at(-1) as RoomSnapshot;
      expect(latest).toMatchObject({ by: ME.id, hostId: ME.id, phase: "vote" });
      expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells a removed participant and still offers a copy of what they saw", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard())));
    act(() => ch.deliver("retro:kick", { by: HOST.id, id: ME.id }));
    expect(
      screen.getByRole("heading", { name: "The host removed you from the room" })
    ).toHaveFocus();
    expect(ch.removed).toBe(true);
    // Read-only now: no card input, no votes.
    expect(screen.queryByRole("textbox", { name: "New card for Start" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(exportToMarkdown).toHaveBeenCalledTimes(1);
    const [markdown, filename] = vi.mocked(exportToMarkdown).mock.calls[0];
    expect(markdown).toContain("Card a");
    // Two cards are too few for common words, as on the board.
    expect(markdown).not.toContain("Common words");
    expect(filename).toMatch(/^retro-start-stop-continue-/);
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
  });

  it("downloads the Markdown with the board's summary, common words included", () => {
    const cards = [
      card("f1", { text: "Flaky login tests", votes: 3 }),
      card("f2", { text: "Flaky deploy pipeline", columnKey: "stop", votes: 2 }),
      card("f3", { text: "Flaky staging data", columnKey: "stop" }),
      ...[
        "Pairing helped",
        "Demo went well",
        "Clear goal",
        "Short standups",
        "Good retro",
        "Kind reviews",
      ].map((text, i) => card(`c${i}`, { text, columnKey: "continue" })),
      card("act", { text: "Quarantine the worst tests", isActionItem: true, assignee: "Sam" }),
    ];
    render(
      <VisitorRetroRoom code={CODE} identity={{ id: ME.id, name: ME.name }} onLeave={() => {}} />
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard({ cards }))));
    act(() => ch.deliver("retro:end", { by: HOST.id }));

    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    const [markdown] = vi.mocked(exportToMarkdown).mock.calls[0];
    // The same summary the board's own export opens with.
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("- **Most votes:** Flaky login tests (3 votes, Start)");
    expect(markdown).toContain("- **Common words:** flaky (3 cards)");
    expect(markdown).toContain("- **Actions:** Quarantine the worst tests (Sam)");
  });

  it("says so when the host runs another version of the toolkit", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", { ...hostSnapshot(makeBoard()), v: 1 }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "This room runs on a different version of the Agile Toolkit, so its board can't open here. Ask the host to reload their page, then reload this one."
    );
    expect(screen.queryByText("Card a")).toBeNull();
  });

  it("ignores end and kick from the host while it is missing from presence", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", hostSnapshot(makeBoard())));
    act(() => ch.setPresence([ME]));
    act(() => ch.deliver("retro:end", { by: HOST.id }));
    act(() => ch.deliver("retro:kick", { by: HOST.id, id: ME.id }));
    expect(screen.queryByRole("heading", { name: /ended|removed/i })).toBeNull();
    expect(screen.getByText("Card a")).toBeInTheDocument();
  });

  it("says when the room is full, without a copy to save", () => {
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    const ch = fakeRealtime.last();
    const crowd: FakeMember[] = Array.from({ length: VISITOR_LIMITS.maxMembers }, (_, i) => ({
      id: `crowd_${String(i).padStart(10, "0")}`,
      name: `Person ${i}`,
      joinedAt: "2026-10-19T09:00:00Z",
    }));
    act(() => {
      ch.connect();
      ch.setPresence([...crowd, ME]);
    });
    expect(
      screen.getByRole("heading", {
        name: `This room is full (${VISITOR_LIMITS.maxMembers} people)`,
      })
    ).toHaveFocus();
    expect(ch.removed).toBe(true);
    expect(screen.queryByRole("button", { name: "Save a copy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
  });

  it("says when live rooms can't connect", () => {
    h.realtime = false;
    render(<VisitorRetroRoom code={CODE} identity={identity} onLeave={() => {}} />);
    expect(
      screen.getByRole("heading", { name: "Live rooms aren't available right now" })
    ).toHaveFocus();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });
});
