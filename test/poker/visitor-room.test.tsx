import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * Planning Poker visitor live rooms (`visitor:planning-poker:<code>`):
 * the host's "Start a live room" flow on the tool page, the participant
 * view the /join page mounts, and the hook's visitor-only rules (join
 * snapshot + 30 s keepalive instead of the 5 s heartbeat, size check,
 * 20-participant cap, kick, TTL, idle). Owner rooms must be untouched.
 */

const h = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void;
  interface Sent {
    event: string;
    payload: unknown;
  }
  const channels: FakeChannel[] = [];
  interface FakeChannel {
    name: string;
    handlers: Map<string, Handler[]>;
    presence: Record<string, unknown[]>;
    sent: Sent[];
    on: (type: string, filter: { event: string }, cb: Handler) => FakeChannel;
    subscribe: (cb?: (status: string) => void) => FakeChannel;
    track: (meta: { id: string }) => Promise<string>;
    untrack: () => Promise<string>;
    unsubscribe: () => Promise<string>;
    send: (msg: { event: string; payload: unknown }) => Promise<string>;
    presenceState: () => Record<string, unknown[]>;
  }
  const makeChannel = (name: string): FakeChannel => {
    const channel: FakeChannel = {
      name,
      handlers: new Map(),
      presence: {},
      sent: [],
      on: (type, filter, cb) => {
        const key = `${type}:${filter.event}`;
        channel.handlers.set(key, [...(channel.handlers.get(key) ?? []), cb]);
        return channel;
      },
      // SUBSCRIBED straight away, so the host's pending session commits.
      subscribe: (cb) => {
        cb?.("SUBSCRIBED");
        return channel;
      },
      track: async (meta) => {
        channel.presence[meta.id] = [meta];
        return "ok";
      },
      untrack: async () => "ok",
      unsubscribe: async () => "ok",
      send: async (msg) => {
        channel.sent.push({ event: msg.event, payload: msg.payload });
        return "ok";
      },
      presenceState: () => channel.presence,
    };
    channels.push(channel);
    return channel;
  };
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
    loading: vi.fn(),
  });
  return {
    auth: null as Partial<AuthContextValue> | null,
    channels,
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => FakeChannel>((name) => makeChannel(name)),
      removeChannel: vi.fn(async () => "ok"),
    },
    log: vi.fn(),
    toast,
    exportToMarkdown: vi.fn(),
  };
});

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => h.client,
}));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
vi.mock("@/lib/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/export")>()),
  exportToMarkdown: h.exportToMarkdown,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));
vi.mock("@/lib/sonification/emit", () => ({
  emit: () => {},
  emitRtEvent: () => {},
  emitUiEvent: () => {},
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
    MotionConfig: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";
import { VisitorPokerRoom } from "@/app/(tools)/planning-poker/visitor-poker-room";
import { usePokerSession } from "@/app/(tools)/planning-poker/use-poker-session";
import { useAutoSeat } from "@/app/(tools)/planning-poker/use-auto-seat";
import { LOCAL_SESSION_KEY } from "@/app/(tools)/planning-poker/local-session";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import type { Session } from "@/app/(tools)/planning-poker/types";
import { SHORTENED_MARK } from "@/app/(tools)/planning-poker/visitor-session";
import { pokerQueueRoute, storyQueueSource } from "@/lib/handoffs/targets/poker-queue";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

type FakeChannel = (typeof h.channels)[number];

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];
const CODE = "ABCDEFGHJKMN";
const HOST = "hostmember000001";
const ME = { id: "participant00001", name: "Pat" };
const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];

function memberId(i: number): string {
  return `member${String(i).padStart(10, "0")}`;
}

function hostSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: CODE,
    sessionName: "Sprint 9",
    scale: FIB,
    scaleType: "fibonacci",
    host: "Ana",
    hostId: HOST,
    participants: [{ id: HOST, name: "Ana", vote: null }],
    stories: [{ id: "s1", title: "Login page", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

function live(): FakeChannel {
  const ch = h.channels[h.channels.length - 1];
  if (!ch) throw new Error("no channel opened");
  return ch;
}

function fire(ch: FakeChannel, key: string, payload?: unknown) {
  act(() => {
    for (const cb of ch.handlers.get(key) ?? []) cb(payload);
  });
}

function presenceSync(ch: FakeChannel) {
  fire(ch, "presence:sync");
}

function send(ch: FakeChannel, event: string, payload: unknown) {
  fire(ch, `broadcast:${event}`, { type: "broadcast", event, payload });
}

function arrive(ch: FakeChannel, id: string, name: string, joinedAt = "2026-10-19T10:00:00.000Z") {
  ch.presence[id] = [{ id, name, color: "#00f0ff", joinedAt }];
  presenceSync(ch);
}

function states(ch: FakeChannel): Array<{ state: Session; by: string }> {
  return ch.sent
    .filter((s) => s.event === "poker:state")
    .map((s) => s.payload as { state: Session; by: string });
}

function addStory(title: string) {
  fireEvent.change(screen.getByPlaceholderText("Story title…"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Add story" }));
}

/** The host's path: lobby → "Start a live room" → consent → live. */
function startLiveRoom(name = "Ana") {
  const utils = render(<PlanningPokerClient />);
  fireEvent.click(screen.getByRole("button", { name: "Start a live room" }));
  const dialog = screen.getByRole("dialog", { name: "Start a live Planning Poker room" });
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
  const ch = live();
  presenceSync(ch);
  const hostId = states(ch)[0]?.by;
  if (!hostId) throw new Error("the host never sent its session");
  return { ...utils, ch, hostId };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  h.auth = { status: "anonymous", user: null };
  h.channels.length = 0;
  h.client.channel.mockClear();
  h.client.removeChannel.mockClear();
  h.log.mockClear();
  h.toast.error.mockClear();
  h.exportToMarkdown.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ─── Host: starting a room from the tool page ──────────────────────────

describe("Start a live room (host, tool page)", () => {
  it("is hidden while the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    render(<PlanningPokerClient />);
    expect(screen.getByText("Running it with your team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a live room" })).toBeNull();
  });

  it("is never offered to the owner", () => {
    h.auth = { status: "authenticated", user: owner };
    render(<PlanningPokerClient />);
    expect(screen.queryByRole("button", { name: "Start a live room" })).toBeNull();
    expect(screen.queryByRole("group", { name: "How will you run it?" })).toBeNull();
  });

  it("sits beside Start Session as the two named ways, with the room's limits", () => {
    render(<PlanningPokerClient />);
    const choice = screen.getByRole("group", { name: "How will you run it?" });
    const one = within(choice).getByRole("group", { name: "One screen" });
    const own = within(choice).getByRole("group", { name: "Everyone on their own device" });
    expect(within(one).getByRole("button", { name: "Start Session" })).toBeInTheDocument();
    expect(within(own).getByRole("button", { name: "Start a live room" })).toBeInTheDocument();
    expect(within(own).getByText(/No account needed, for you or your guests\./)).toHaveTextContent(
      "Up to 20 people, for up to 3 hours. We store nothing."
    );
    // The card under it still explains the one-screen way.
    expect(screen.getByText("Running it with your team")).toBeInTheDocument();
    expect(screen.getByText(/On one screen: share it in your meeting/)).toBeInTheDocument();
  });

  it("still starts on one screen when the form is submitted (Enter in a field)", () => {
    render(<PlanningPokerClient />);
    fireEvent.submit(screen.getByLabelText("Session name").closest("form")!);
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("group", { name: "How will you run it?" })).toBeNull();
  });

  it("opens no channel before consent, nor when consent is cancelled", () => {
    render(<PlanningPokerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start a live room" }));
    const dialog = screen.getByRole("dialog", { name: "Start a live Planning Poker room" });
    // The lobby's display name is offered.
    expect(within(dialog).getByLabelText(/your name/i)).toHaveValue("Scrum Master");
    expect(h.client.channel).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.client.channel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start Session" })).toBeInTheDocument();
  });

  it("goes live on a visitor channel with a 12-character code after consent", () => {
    const { ch, hostId } = startLiveRoom("Ana");
    expect(h.client.channel).toHaveBeenCalledTimes(1);
    expect(ch.name).toMatch(/^visitor:planning-poker:[23456789A-HJKMNP-Z]{12}$/);
    const code = ch.name.split(":")[2];
    // The host's seat is the consented identity.
    expect(hostId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(states(ch)[0].state).toMatchObject({ roomCode: code, hostId, host: "Ana" });
    // The chip carries the code and the copy link; no squad invite.
    expect(screen.getByText(code)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByText("1 of 20 people")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite squad" })).toBeNull();
    expect(screen.queryByText("Browser-only")).toBeNull();
  });

  it("removes a participant: kick message, seat gone, later rows ignored", () => {
    const { ch, hostId } = startLiveRoom();
    arrive(ch, ME.id, ME.name);
    const withMe = (vote: string | null) => ({
      state: {
        ...states(ch)[0].state,
        participants: [...states(ch)[0].state.participants, { id: ME.id, name: ME.name, vote }],
      },
      by: ME.id,
    });
    send(ch, "poker:state", withMe(null));
    expect(screen.getByText(ME.name)).toBeInTheDocument();
    expect(screen.getByText("2 of 20 people")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Pat from the room" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Pat from the room?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(ch.sent).toContainEqual({ event: "poker:kick", payload: { by: hostId, id: ME.id } });
    expect(screen.queryByText(ME.name)).toBeNull();
    // Still connected, they keep sending their row: the host ignores it.
    send(ch, "poker:state", withMe("5"));
    expect(screen.queryByText(ME.name)).toBeNull();
    expect(
      states(ch)
        .at(-1)
        ?.state.participants.map((p) => p.id)
    ).toEqual([hostId]);
  });

  it("logs nothing to history and writes nothing back while live", () => {
    startLiveRoom();
    addStory("Checkout flow");
    const deck = screen.getByRole("radiogroup", { name: "Your vote" });
    fireEvent.click(within(deck).getByRole("radio", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: /Reveal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Accept 5" }));
    expect(h.log).not.toHaveBeenCalled();
  });

  it("takes a queue of fully described stories without going over the room's size limit", () => {
    // 40 backlog stories with full notes and acceptance criteria: about
    // 160,000 characters of description, more than the room sends at once.
    const text = (word: string) => `- ${word} of the story\n`.repeat(120).slice(0, 2_000);
    useWorkspaceStore.setState({ pokerEstimationLogs: [] });
    for (let i = 0; i < 40; i++) {
      pokerQueueRoute.send(
        storyQueueSource({
          id: `st${i}`,
          title: `Queued story ${i}`,
          notes: text("note"),
          acceptanceCriteria: text("criterion"),
        })
      );
    }
    const { ch } = startLiveRoom();
    const before = states(ch).length;
    fireEvent.click(screen.getByRole("button", { name: "Add queued stories (40)" }));

    // The room got the session, with every story: nothing was refused.
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(states(ch).length).toBeGreaterThan(before);
    const sent = states(ch).at(-1)!;
    expect(sent.state.stories.map((st) => st.title)).toEqual(
      Array.from({ length: 40 }, (_, i) => `Queued story ${i}`)
    );
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(VISITOR_LIMITS.maxPayloadChars);
    // Each description was shortened, and says so.
    for (const st of sent.state.stories) {
      expect(st.description?.startsWith("- note of the story")).toBe(true);
      expect(st.description?.endsWith(SHORTENED_MARK)).toBe(true);
    }
    useWorkspaceStore.setState({ pokerEstimationLogs: [] });
  });

  it("ending the room keeps the session locally, with only the host's seat", () => {
    const { ch, hostId } = startLiveRoom();
    const code = ch.name.split(":")[2];
    addStory("Checkout flow");
    arrive(ch, ME.id, ME.name);
    send(ch, "poker:state", {
      state: {
        ...states(ch).at(-1)!.state,
        participants: [
          { id: hostId, name: "Ana", vote: null },
          { id: ME.id, name: "Pat", vote: null },
        ],
      },
      by: ME.id,
    });
    expect(screen.getAllByText("Pat").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "End room" }));

    expect(ch.sent).toContainEqual({ event: "poker:session-ended", payload: { by: hostId } });
    expect(h.client.removeChannel).toHaveBeenCalled();
    // Carries on as a local session: same stories, no chip, no room.
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(screen.getByText("Browser-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText("Pat")).toBeNull();
    // The room identity is forgotten; the stored copy has the host only.
    expect(window.sessionStorage.getItem(`agile-toolkit:visitor-room:${code}`)).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_SESSION_KEY) ?? "null") as Session;
    expect(stored.participants.map((p) => p.name)).toEqual(["Ana"]);
    expect(h.client.channel).toHaveBeenCalledTimes(1);
  });

  it("restoring the session after a refresh never reconnects the room", () => {
    const first = startLiveRoom();
    addStory("Checkout flow");
    arrive(first.ch, ME.id, ME.name);
    send(first.ch, "poker:state", {
      state: {
        ...states(first.ch).at(-1)!.state,
        participants: [
          { id: first.hostId, name: "Ana", vote: null },
          { id: ME.id, name: "Pat", vote: null },
        ],
      },
      by: ME.id,
    });
    // What's stored while live never holds anyone else's name.
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_SESSION_KEY) ?? "null") as Session;
    expect(stored.participants.map((p) => p.name)).toEqual(["Ana"]);
    first.unmount();
    h.client.channel.mockClear();

    render(<PlanningPokerClient />);
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(screen.getByText("Browser-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(h.client.channel).not.toHaveBeenCalled();
  });
});

// ─── Participant: the view /join mounts ────────────────────────────────

function enterRoom(onLeave = vi.fn()) {
  const utils = render(
    <LiveAnnouncerProvider>
      <VisitorPokerRoom code={CODE} identity={ME} onLeave={onLeave} />
    </LiveAnnouncerProvider>
  );
  const ch = live();
  ch.presence[HOST] = [
    { id: HOST, name: "Ana", color: "#00f0ff", joinedAt: "2026-10-19T09:00:00.000Z" },
  ];
  presenceSync(ch);
  return { ...utils, ch, onLeave };
}

describe("VisitorPokerRoom (participant)", () => {
  it("joins the visitor channel for the code and waits for the host", () => {
    const { ch } = enterRoom();
    expect(ch.name).toBe(`visitor:planning-poker:${CODE}`);
    expect(screen.getByText("Waiting for the host to share the session…")).toBeInTheDocument();
  });

  it("rejects a session with more than 20 participants", () => {
    const { ch } = enterRoom();
    const crowd = Array.from({ length: 20 }, (_, i) => ({
      id: memberId(i),
      name: `Member ${i}`,
      vote: null,
    }));
    send(ch, "poker:state", {
      state: hostSession({ participants: [{ id: HOST, name: "Ana", vote: null }, ...crowd] }),
      by: HOST,
    });
    expect(screen.queryByRole("heading", { name: "Login page" })).toBeNull();
    expect(screen.getByText("Waiting for the host to share the session…")).toBeInTheDocument();

    send(ch, "poker:state", {
      state: hostSession({
        participants: [{ id: HOST, name: "Ana", vote: null }, ...crowd.slice(0, 19)],
      }),
      by: HOST,
    });
    expect(screen.getByRole("heading", { name: "Login page" })).toBeInTheDocument();
  });

  it("rejects a session for another room, or with bidi characters", () => {
    const { ch } = enterRoom();
    send(ch, "poker:state", { state: hostSession({ roomCode: "ABCDEFGHJKMP" }), by: HOST });
    send(ch, "poker:state", {
      state: hostSession({ stories: [{ id: "s1", title: "Log‮in", finalEstimate: null }] }),
      by: HOST,
    });
    expect(screen.getByText("Waiting for the host to share the session…")).toBeInTheDocument();
  });

  it("takes its seat, then leaves and stops re-seating once the host removes it", () => {
    const { ch } = enterRoom();
    send(ch, "poker:state", { state: hostSession(), by: HOST });
    expect(screen.getByRole("heading", { name: "Login page" })).toBeInTheDocument();
    const seat = states(ch).at(-1);
    expect(seat?.by).toBe(ME.id);
    expect(seat?.state.participants.map((p) => p.id)).toEqual([HOST, ME.id]);

    // Only the trusted host can remove anyone.
    arrive(ch, "intruder00000001", "Mallory", "2026-10-19T09:30:00.000Z");
    send(ch, "poker:kick", { by: "intruder00000001", id: ME.id });
    expect(screen.getByRole("heading", { name: "Login page" })).toBeInTheDocument();

    send(ch, "poker:kick", { by: HOST, id: ME.id });
    expect(
      screen.getByRole("heading", { name: "The host removed you from the room" })
    ).toHaveFocus();
    expect(h.client.removeChannel).toHaveBeenCalled();

    // The host's next session (without us) doesn't make us sit down again.
    const sentBefore = ch.sent.length;
    send(ch, "poker:state", { state: hostSession(), by: HOST });
    expect(ch.sent.length).toBe(sentBefore);
  });

  it("says when the host ended the room, announces it, and offers a copy", async () => {
    const { ch } = enterRoom();
    send(ch, "poker:state", { state: hostSession(), by: HOST });
    // Someone who isn't the host can't end it.
    arrive(ch, "intruder00000001", "Mallory", "2026-10-19T09:30:00.000Z");
    send(ch, "poker:session-ended", { by: "intruder00000001" });
    expect(screen.getByRole("heading", { name: "Login page" })).toBeInTheDocument();

    send(ch, "poker:session-ended", { by: HOST });
    expect(screen.getByRole("heading", { name: "The host ended the room" })).toHaveFocus();
    expect(h.client.removeChannel).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(/Room ended/));

    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    expect(h.exportToMarkdown).toHaveBeenCalledWith(
      expect.stringContaining("Login page"),
      `planning-poker-${CODE}`
    );
  });

  it("turns back when the room already holds 20 people", () => {
    render(
      <LiveAnnouncerProvider>
        <VisitorPokerRoom code={CODE} identity={ME} onLeave={() => {}} />
      </LiveAnnouncerProvider>
    );
    const ch = live();
    for (let i = 0; i < 20; i++) {
      ch.presence[memberId(i)] = [
        {
          id: memberId(i),
          name: `Member ${i}`,
          color: "#00f0ff",
          joinedAt: "2026-10-19T09:00:00.000Z",
        },
      ];
    }
    presenceSync(ch);
    expect(screen.getByRole("heading", { name: "This room is full (20 people)" })).toHaveFocus();
    expect(h.client.removeChannel).toHaveBeenCalled();
  });
});

describe("useAutoSeat", () => {
  function seat(opts: { enabled: boolean; session: Session; maxParticipants?: number }) {
    const setSession = vi.fn();
    renderHook(() =>
      useAutoSeat({
        session: opts.session,
        setSession,
        userId: ME.id,
        name: ME.name,
        enabled: opts.enabled,
        maxParticipants: opts.maxParticipants,
      })
    );
    return setSession;
  }

  it("adds this client's row when it's missing", () => {
    const setSession = seat({ enabled: true, session: hostSession() });
    expect(setSession).toHaveBeenCalledTimes(1);
    const next = (setSession.mock.calls[0][0] as (s: Session) => Session)(hostSession());
    expect(next.participants.map((p) => p.id)).toEqual([HOST, ME.id]);
  });

  it("does nothing once disabled (a removed visitor, a viewer)", () => {
    expect(seat({ enabled: false, session: hostSession() })).not.toHaveBeenCalled();
  });

  it("does not take a seat in a full session", () => {
    const full = hostSession({
      participants: Array.from({ length: 20 }, (_, i) => ({
        id: memberId(i),
        name: "M",
        vote: null,
      })),
    });
    expect(seat({ enabled: true, session: full, maxParticipants: 20 })).not.toHaveBeenCalled();
  });
});

// ─── The hook's visitor-only rules ─────────────────────────────────────

describe("usePokerSession in a visitor room", () => {
  const hostIdentity = { id: HOST, name: "Ana" };

  function renderHost() {
    const hook = renderHook(() =>
      usePokerSession(CODE, true, { visitor: true, identity: hostIdentity })
    );
    const ch = live();
    presenceSync(ch);
    return { ...hook, ch };
  }

  it("sends a snapshot when someone joins and a 30 s keepalive, not the 5 s heartbeat", () => {
    vi.useFakeTimers();
    const { result, ch } = renderHost();
    act(() => result.current.setSession(hostSession()));
    expect(states(ch)).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(10_000));
    expect(states(ch)).toHaveLength(1);

    arrive(ch, ME.id, ME.name);
    act(() => void vi.advanceTimersByTime(499));
    expect(states(ch)).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(states(ch)).toHaveLength(2);

    // The keepalive started when the room connected (t = 0).
    act(() => void vi.advanceTimersByTime(19_499));
    expect(states(ch)).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(states(ch)).toHaveLength(3);
  });

  it("keeps the owner room's 5 s heartbeat", () => {
    vi.useFakeTimers();
    h.auth = { status: "authenticated", user: owner };
    const { result } = renderHook(() => usePokerSession("ABC234", true));
    const ch = live();
    expect(ch.name).toBe("tool:planning-poker:room:ABC234");
    act(() =>
      result.current.setSession(hostSession({ roomCode: "ABC234", hostId: result.current.userId }))
    );
    expect(states(ch)).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(states(ch)).toHaveLength(2);
  });

  it("doesn't send a session over the size limit, and warns once", () => {
    const { result, ch } = renderHost();
    const big = (n: number) =>
      hostSession({
        stories: Array.from({ length: n }, (_, i) => ({
          id: `s${i}`,
          title: `Story ${i}`,
          description: "x".repeat(5_000),
          finalEstimate: null,
        })),
      });
    act(() => result.current.setSession(big(25)));
    act(() => result.current.setSession(big(26)));
    expect(states(ch)).toHaveLength(0);
    expect(h.toast.error).toHaveBeenCalledTimes(1);

    act(() => result.current.setSession(hostSession()));
    expect(states(ch)).toHaveLength(1);
  });

  it("strips control and bidi characters from what it sends", () => {
    const { result, ch } = renderHost();
    act(() =>
      result.current.setSession(
        hostSession({ stories: [{ id: "s1", title: "Log‮in‏", finalEstimate: null }] })
      )
    );
    expect(states(ch)[0].state.stories[0].title).toBe("Login");
  });

  it("prompts after 30 idle minutes and ends the room 2 minutes later", () => {
    vi.useFakeTimers();
    const { result, ch } = renderHost();
    act(() => result.current.setSession(hostSession()));

    act(() => void vi.advanceTimersByTime(30 * 60_000));
    expect(result.current.idleWarning).toBe(true);
    act(() => result.current.keepRoomOpen());
    expect(result.current.idleWarning).toBe(false);

    act(() => void vi.advanceTimersByTime(32 * 60_000));
    expect(result.current.leftReason).toBe("idle");
    expect(ch.sent).toContainEqual({ event: "poker:session-ended", payload: { by: HOST } });
    expect(h.client.removeChannel).toHaveBeenCalled();
    // The session itself stays in memory.
    expect(result.current.session?.stories[0].title).toBe("Login page");
  });

  it("leaves after the 3-hour hard TTL", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      usePokerSession(CODE, false, { visitor: true, identity: ME })
    );
    act(() => void vi.advanceTimersByTime(3 * 60 * 60_000 - 1));
    expect(result.current.leftReason).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.leftReason).toBe("expired");
    expect(h.client.removeChannel).toHaveBeenCalled();
  });

  it("opens nothing with the flag off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    const { result } = renderHook(() =>
      usePokerSession(CODE, false, { visitor: true, identity: ME })
    );
    expect(result.current.isLocalOnly).toBe(true);
    expect(h.client.channel).not.toHaveBeenCalled();
  });
});
