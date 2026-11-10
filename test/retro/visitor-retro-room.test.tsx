import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import type { RoomSnapshot } from "@/app/(tools)/retro/room/protocol";
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

const h = vi.hoisted(() => ({ auth: null as unknown, realtime: true }));

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
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
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

function hostSnapshot(b: BoardState, seq = 1): RoomSnapshot {
  return JSON.parse(
    JSON.stringify(
      toRoomSnapshot(b, {
        by: HOST.id,
        seq,
        endsAt: Date.now() + VISITOR_LIMITS.hardTtlMs,
        members: [HOST, ME].map(({ id, name }) => ({ id, name })),
        votesUsed: {},
        timer: { running: false, remaining: b.timerSeconds },
        now: Date.now(),
        hideWhileWriting: false,
        votesPerPerson: 3,
      })
    )
  ) as RoomSnapshot;
}

/** Fill in and confirm the consent dialog. */
function consentAs(name: string) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
}

beforeEach(() => {
  h.auth = VISITOR;
  h.realtime = true;
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

  it("opens no channel before consent, and one visitor channel after it", () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/passes through our realtime provider/i);
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();

    // Cancelling opens nothing either.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    consentAs("Hana");
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
    consentAs("Hana");
    act(() => fakeRealtime.last().connect());
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Live room started. Share it with your team: Copy link or Show QR code."
      )
    );
  });

  it("ends the room on request and keeps the board", () => {
    render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    consentAs("Hana");
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

  it("ends the room before New Retro clears the board", () => {
    const onReset = vi.fn();
    render(<Harness initial={makeBoard()} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    consentAs("Hana");
    const ch = fakeRealtime.last();
    act(() => ch.connect());

    fireEvent.click(screen.getByRole("button", { name: /new retro/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Start new retro" })
    );
    expect(ch.sent("retro:end")).toHaveLength(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("closes the room if this browser turns out to be the owner's", () => {
    const { rerender } = render(<Harness initial={makeBoard()} />);
    fireEvent.click(screen.getByRole("button", { name: GO_LIVE }));
    consentAs("Hana");
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
    // Participants don't delete or group cards.
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
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
    expect(filename).toMatch(/^retro-start-stop-continue-/);
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
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
