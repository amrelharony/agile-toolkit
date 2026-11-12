import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  WALL_ROOM_EVENTS,
  intentAad,
  lockOf,
  padIntent,
  readIntent,
  wallStateInput,
  type IntentEnvelope,
  type WallIntent,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { CODE, NOW, fakeVoteCrypto, type FakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * The wall's round kinds through the hook and the views (Audience Wall):
 * the host marks questions answered, runs brainwriting ("Yes, and…") and a
 * 25/10 scoring, and lowers every hand; a participant builds on a post from
 * its "Yes, and…" button, scores the five posts picked for them, and sees
 * the averages only once the host shows them.
 */

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() })
);
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { useWallRoom } from "@/lib/realtime/wall-room/use-wall-room";
import { WallJoinRoom } from "@/components/collab/wall-room/wall-join-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const ident = (m: FakeMember) => ({ id: m.id, name: m.name });
const ROUND = "round_000001";

async function flush() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

async function deliver(ch: FakeChannel, event: string, payload: unknown) {
  act(() => ch.deliver(event, payload));
  await flush();
}

type State = WallStateBody & { sig: string };
const states = (ch: FakeChannel) => ch.sent(WALL_ROOM_EVENTS.state) as State[];

let iidN = 0;
async function request(crypto: FakeVoteCrypto, s: State, by: string, intent: WallIntent) {
  const iid = `iidv_${String(++iidN).padStart(7, "0")}`;
  const sealed = await crypto.seal(s.keys.ecdh, intentAad(by, iid), padIntent(intent)!);
  return { v: 1, by, iid, ...sealed };
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("the host's hook", () => {
  async function startHost() {
    const crypto = fakeVoteCrypto();
    const view = renderHook(() =>
      useWallRoom({
        role: "host",
        tool: "audience-wall",
        code: CODE,
        identity: ident(HOST),
        startedAt: NOW,
        crypto,
      })
    );
    await flush();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A, B]);
    });
    await flush();
    await tick(600);
    return { ...view, ch, crypto };
  }

  it("shares brainwriting replies and answered questions, and lowers every hand", async () => {
    const { ch, crypto, result } = await startHost();
    act(() => {
      result.current.openRound("Ideas for onboarding", "live", { build: true });
    });
    await tick(600);
    let s = states(ch).at(-1)!;
    expect(s.round).toMatchObject({ build: true });
    const r = s.round!.id;
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, A.id, {
        t: "post",
        r,
        pid: "pid_first001",
        text: "A buddy for each joiner",
        lock: lockOf("keyA_0123456789abcdef"),
      })
    );
    await tick(600);
    s = states(ch).at(-1)!;
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, B.id, {
        t: "post",
        r,
        pid: "pid_reply001",
        text: "and a first-week checklist",
        lock: lockOf("keyB_0123456789abcdef"),
        re: "pid_first001",
      })
    );
    await tick(600);
    s = states(ch).at(-1)!;
    expect(s.round!.posts!.find((p) => p.id === "pid_reply001")!.re).toBe("pid_first001");
    act(() => result.current.answer("pid_first001", true));
    await tick(600);
    expect(
      states(ch)
        .at(-1)!
        .round!.posts!.find((p) => p.id === "pid_first001")
    ).toMatchObject({
      answered: true,
    });
    const saved = result.current.result()!;
    expect(saved.posts.find((p) => p.text === "and a first-week checklist")!.re).toBe(
      saved.posts.findIndex((p) => p.text === "A buddy for each joiner")
    );

    for (const m of [A, B]) {
      s = states(ch).at(-1)!;
      await deliver(
        ch,
        WALL_ROOM_EVENTS.intent,
        await request(crypto, s, m.id, { t: "hand", up: true })
      );
    }
    expect(result.current.hands.map((h) => h.id)).toEqual([A.id, B.id]);
    act(() => result.current.lowerAllHands());
    expect(result.current.hands).toEqual([]);
  });

  it("runs a 25/10 scoring: counts scores while open, shares totals only when shown", async () => {
    const { ch, crypto, result } = await startHost();
    act(() => {
      result.current.openRound("Our boldest idea", "hidden");
    });
    await tick(600);
    let s = states(ch).at(-1)!;
    const r = s.round!.id;
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, A.id, {
        t: "post",
        r,
        pid: "pid_idea0001",
        text: "Ship every week",
        lock: lockOf("keyA_0123456789abcdef"),
      })
    );
    await tick(600);
    act(() => result.current.setScoring("open"));
    await tick(600);
    s = states(ch).at(-1)!;
    expect(s.round).toMatchObject({ scoring: "open", scored: 0, open: false, revealed: true });
    await deliver(
      ch,
      WALL_ROOM_EVENTS.intent,
      await request(crypto, s, B.id, {
        t: "score",
        r,
        pid: "pid_idea0001",
        value: 4,
        lock: lockOf("keyB_0123456789abcdef"),
      })
    );
    await tick(600);
    s = states(ch).at(-1)!;
    expect(s.round!.scored).toBe(1);
    expect(s.round!.posts![0].score).toBeUndefined();
    expect(result.current.round!.posts![0].score).toBeUndefined();
    act(() => result.current.setScoring("shown"));
    await tick(600);
    expect(states(ch).at(-1)!.round!.posts![0]).toMatchObject({ score: 4, scorers: 1 });
    expect(result.current.result()!.posts[0]).toMatchObject({ score: 4, scorers: 1 });
  });
});

describe("the participant's views", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;
  let seq = 0;
  const OTHER = { id: "pid_bobby001", text: "Fewer meetings", votes: 0, merged: [] };
  const MORE = [
    { id: "pid_carol001", text: "Pair on bugs", votes: 0, merged: [] },
    { id: "pid_dave0001", text: "Demo every Friday", votes: 0, merged: [] },
  ];

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
    seq = 0;
  });

  async function wallState(round: Partial<NonNullable<WallStateBody["round"]>> = {}) {
    const body: WallStateBody = {
      v: 1,
      by: HOST.id,
      seq: ++seq,
      tool: "audience-wall",
      endsAt: Date.now() + 3 * 3_600_000,
      keys: keys.publicKeys,
      round: {
        id: ROUND,
        prompt: "Ideas for onboarding",
        open: true,
        mode: "live",
        revealed: false,
        count: 1,
        posts: [OTHER],
        ...round,
      },
      hands: [],
      acks: [],
      nacks: [],
    };
    return JSON.parse(
      JSON.stringify({ ...body, sig: await crypto.sign(keys, wallStateInput(body)) })
    );
  }

  async function sentIntents(ch: FakeChannel): Promise<WallIntent[]> {
    const out: WallIntent[] = [];
    for (const env of ch.sent(WALL_ROOM_EVENTS.intent) as IntentEnvelope[]) {
      const plain = await crypto.open(keys, env, intentAad(env.by, env.iid));
      const intent = plain === null ? null : readIntent(plain);
      if (intent) out.push(intent);
    }
    return out;
  }

  async function joined(first: Partial<NonNullable<WallStateBody["round"]>>) {
    window.history.replaceState(null, "", `/join/audience-wall/${CODE}#k=${keys.fingerprint}`);
    const wrap = (ui: ReactNode) =>
      render(
        <TooltipProvider>
          <LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>
        </TooltipProvider>
      );
    wrap(
      <WallJoinRoom
        tool="audience-wall"
        toolName="Audience Wall"
        code={CODE}
        identity={ident(A)}
        onLeave={() => {}}
        crypto={crypto}
      />
    );
    await flush();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A, B]);
    });
    await flush();
    await deliver(ch, WALL_ROOM_EVENTS.state, await wallState(first));
    return ch;
  }

  it("says Yes, and… to a post from its button, and sends the post it builds on", async () => {
    const ch = await joined({ build: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Yes, and… on: Fewer meetings/ }));
    });
    expect(screen.getByText(/Yes, and… on:/)).toBeInTheDocument();
    const box = screen.getByLabelText(/Your Yes, and…/) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "and a shared calendar of them" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
    });
    await flush();
    const [sent] = await sentIntents(ch);
    expect(sent).toMatchObject({
      t: "post",
      text: "and a shared calendar of them",
      re: OTHER.id,
    });
    // The box is a plain one again.
    expect(screen.queryByText(/Yes, and… on:/)).toBeNull();
    // A round without brainwriting offers no Yes, and….
    await deliver(ch, WALL_ROOM_EVENTS.state, await wallState({}));
    expect(screen.queryByRole("button", { name: /Yes, and… on:/ })).toBeNull();
  });

  it("scores the posts picked for this person, then shows the averages once shared", async () => {
    const posts = [OTHER, ...MORE];
    const ch = await joined({
      open: false,
      revealed: true,
      count: 3,
      posts,
      scoring: "open",
      scored: 0,
    });
    const card = screen.getByRole("region", { name: "Score these posts" });
    expect(within(card).getByText(/0 of 3 scored/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
    const firstGroup = within(card).getAllByRole("radiogroup")[0];
    await act(async () => {
      fireEvent.click(within(firstGroup).getByRole("radio", { name: /^4/ }));
    });
    await flush();
    const [sent] = await sentIntents(ch);
    expect(sent).toMatchObject({ t: "score", value: 4 });
    expect(posts.map((p) => p.id)).toContain((sent as { pid: string }).pid);
    expect(within(card).getByText(/1 of 3 scored/)).toBeInTheDocument();

    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await wallState({
        open: false,
        revealed: true,
        count: 3,
        posts: posts.map((p, i) => ({ ...p, score: 4 - i, scorers: 1 })),
        scoring: "shown",
        scored: 3,
      })
    );
    expect(screen.queryByRole("region", { name: "Score these posts" })).toBeNull();
    expect(screen.getByText(/The host is showing the totals/)).toBeInTheDocument();
    expect(screen.getByText("Score: 4 on average from 1 person")).toBeInTheDocument();
  });

  const MANY = Array.from({ length: 8 }, (_, i) => ({
    id: `pid_many${String(i).padStart(4, "0")}`,
    text: `Idea number ${i + 1}`,
    votes: 0,
    merged: [],
  }));
  const groupNames = () =>
    within(screen.getByRole("region", { name: "Score these posts" }))
      .getAllByRole("radiogroup")
      .map((g) => g.getAttribute("aria-label"));

  it("keeps the same five, its own post out and its scores, after a refresh mid-scoring", async () => {
    let ch = await joined({});
    fireEvent.change(screen.getByLabelText(/Your post/), { target: { value: "My own idea" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
    });
    await flush();
    const mine = (await sentIntents(ch))[0] as Extract<WallIntent, { t: "post" }>;
    const posts = [...MANY, { id: mine.pid, text: "My own idea", votes: 0, merged: [] }];
    const scoring = {
      open: false,
      revealed: true,
      count: posts.length,
      posts,
      scoring: "open" as const,
      scored: 0,
    };
    await deliver(ch, WALL_ROOM_EVENTS.state, await wallState(scoring));
    const first = groupNames();
    expect(first).toHaveLength(5);
    // Each scale is named after its post, never this tab's own.
    expect(first.every((n) => /^Post \d of 5: Idea number \d$/.test(n ?? ""))).toBe(true);
    const group = within(screen.getByRole("region", { name: "Score these posts" })).getAllByRole(
      "radiogroup"
    )[0];
    await act(async () => {
      fireEvent.click(within(group).getByRole("radio", { name: /^4/ }));
    });
    await flush();
    const scored = (await sentIntents(ch)).at(-1) as Extract<WallIntent, { t: "score" }>;
    expect(scored).toMatchObject({ t: "score", value: 4 });
    expect(scored.key).toBeUndefined();

    // A refresh: the tab's memo brings back the same five and the score.
    cleanup();
    ch = await joined(scoring);
    expect(groupNames()).toEqual(first);
    const again = within(screen.getByRole("region", { name: "Score these posts" })).getAllByRole(
      "radiogroup"
    )[0];
    expect(within(again).getByRole("radio", { name: /^4/ })).toBeChecked();
    await act(async () => {
      fireEvent.click(within(again).getByRole("radio", { name: /^2/ }));
    });
    await flush();
    // The change carries the key behind the first score's lock, so the host takes it.
    const changed = (await sentIntents(ch)).at(-1) as Extract<WallIntent, { t: "score" }>;
    expect(changed).toMatchObject({ t: "score", pid: scored.pid, value: 2 });
    expect(lockOf(changed.key!)).toBe(scored.lock);
  });

  it("says when the scoring starts and when the totals show, with focus on what replaced the box", async () => {
    const ch = await joined({ posts: [OTHER, ...MORE], count: 3 });
    const box = screen.getByLabelText(/Your post/);
    box.focus();
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await wallState({
        open: false,
        revealed: true,
        count: 3,
        posts: [OTHER, ...MORE],
        scoring: "open",
        scored: 0,
      })
    );
    await tick(60);
    expect(screen.getByTestId("live-polite")).toHaveTextContent(
      "Scoring started: score 3 posts from 1 to 5."
    );
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Score these posts" }));
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await wallState({
        open: false,
        revealed: true,
        count: 3,
        posts: [OTHER, ...MORE].map((p) => ({ ...p, score: 3, scorers: 1 })),
        scoring: "shown",
        scored: 3,
      })
    );
    await tick(60);
    expect(screen.getByTestId("live-polite")).toHaveTextContent("The host is showing the totals.");
    expect(document.activeElement).toBe(
      screen.getByText("The host is showing the totals: the best-scored posts come first.")
    );
  });

  it("puts focus back in the box when a Yes, and… is cancelled", async () => {
    await joined({ build: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Yes, and… on: Fewer meetings/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel the Yes, and…" }));
    });
    expect(screen.queryByText(/Yes, and… on:/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText(/Your post/));
  });

  it("puts Raise my hand first when the round takes no posts and has none", async () => {
    await joined({ open: false, count: 0, posts: [] });
    expect(screen.queryByLabelText(/Your post/)).toBeNull();
    expect(screen.queryByText("Nothing on the wall yet.")).toBeNull();
    // One Raise my hand, where the post box would be, and no empty wall under it.
    expect(screen.getAllByRole("button", { name: "Raise my hand" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "The wall" })).toBeNull();
    expect(screen.getByText("Raise your hand to join the queue to speak.")).toBeInTheDocument();
  });
});
