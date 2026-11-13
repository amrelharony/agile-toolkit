import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { VISITOR_ROOM_CONSENT_TEXT } from "@/components/collab/visitor-room-consent";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import type { RoomEndBody } from "@/lib/realtime/signed-room";
import {
  SHOW_ROOM_EVENTS,
  showControlInput,
  showStateInput,
  type ShowStateBody,
} from "@/lib/realtime/show-room/protocol";
import {
  WALL_ROOM_EVENTS,
  intentAad,
  lockOf,
  readIntent,
  wallControlInput,
  wallStateInput,
  type IntentEnvelope,
  type WallIntent,
  type WallStateBody,
} from "@/lib/realtime/wall-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { CODE, NOW, fakeVoteCrypto, type FakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * The generic show and wall views on a fake Realtime channel and a fake
 * VoteCrypto: the participant views (ShowJoinRoom, WallJoinRoom, with
 * WallPostForm and RoomClosedPanel) and the host's ShowRoomHost. Nothing
 * opens before consent or without the link's key; a participant sends only
 * what each control says, sealed to the host on a wall; end states show
 * their own panel.
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

import { ShowJoinRoom } from "@/components/collab/show-room/show-join-room";
import { ShowRoomHost } from "@/components/collab/show-room/show-room-host";
import { WallJoinRoom } from "@/components/collab/wall-room/wall-join-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const ident = (m: FakeMember) => ({ id: m.id, name: m.name });

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

const wrap = (ui: ReactNode) => render(<LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>);

/** The join link's path, with or without the host key. */
function atLink(tool: string, fingerprint: string | null) {
  window.history.replaceState(
    null,
    "",
    `/join/${tool}/${CODE}${fingerprint ? `#k=${fingerprint}` : ""}`
  );
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  toastMock.error.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

async function hostEnd(
  crypto: FakeVoteCrypto,
  keys: HostKeyPair,
  event: string,
  input: typeof showControlInput
) {
  const body: RoomEndBody = { v: 1, by: HOST.id, reason: "host" };
  return { ...body, sig: await crypto.sign(keys, input(event, body)) };
}

// ── Show rooms: the participant ──────────────────────────────────────

describe("ShowJoinRoom", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  async function showState(o: Partial<ShowStateBody> = {}) {
    const body: ShowStateBody = {
      v: 1,
      by: HOST.id,
      seq: 1,
      tool: "picker",
      endsAt: Date.now() + 3 * 3_600_000,
      keys: keys.publicKeys,
      here: 0,
      frame: null,
      ...o,
    };
    return JSON.parse(
      JSON.stringify({ ...body, sig: await crypto.sign(keys, showStateInput(body)) })
    );
  }

  it("opens nothing for a link without the host key, and offers Leave", async () => {
    atLink("picker", null);
    const onLeave = vi.fn();
    wrap(
      <ShowJoinRoom
        tool="picker"
        toolName="Picker"
        code={CODE}
        identity={ident(A)}
        onLeave={onLeave}
        crypto={crypto}
      />
    );
    await flush();
    expect(
      screen.getByRole("heading", { level: 1, name: "This link is incomplete" })
    ).toBeInTheDocument();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("draws the host's frame, says I'm here, and shows the end when the host ends the room", async () => {
    atLink("picker", keys.fingerprint);
    const onLeave = vi.fn();
    wrap(
      <ShowJoinRoom
        tool="picker"
        toolName="Picker"
        code={CODE}
        identity={ident(A)}
        onLeave={onLeave}
        crypto={crypto}
      />
    );
    await flush();
    const ch = fakeRealtime.last();
    expect(ch.name).toBe(`visitor:picker:${CODE}`);
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the host…");
    await deliver(
      ch,
      SHOW_ROOM_EVENTS.state,
      await showState({
        frame: { n: 1, kind: "text", data: '{"title":"Sam","body":"is up next"}', at: NOW },
      })
    );
    expect(screen.getByRole("heading", { level: 1, name: "Live Picker" })).toBeInTheDocument();
    expect(screen.getByText(/Hosted by Hana\. You are Alex\./)).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("is up next")).toBeInTheDocument();

    const here = screen.getByRole("button", { name: "I'm here" });
    expect(here).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(here);
    expect(here).toHaveAttribute("aria-pressed", "true");
    expect(ch.sent(SHOW_ROOM_EVENTS.here)).toEqual([{ v: 1, by: A.id, here: true }]);
    // That is all a participant sends.
    expect(new Set(ch.send.mock.calls.map((c) => c[0].event))).toEqual(
      new Set([SHOW_ROOM_EVENTS.here])
    );
    await deliver(ch, SHOW_ROOM_EVENTS.state, await showState({ seq: 2, here: 1 }));
    expect(screen.getByText("1 person is here.")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the host to show something/)).toBeInTheDocument();

    await deliver(
      ch,
      SHOW_ROOM_EVENTS.end,
      await hostEnd(crypto, keys, SHOW_ROOM_EVENTS.end, showControlInput)
    );
    const ended = screen.getByRole("heading", { name: "The host ended the room" });
    expect(ended).toHaveFocus();
    expect(screen.getByText("Nothing from the room was kept.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

// ── Wall rooms: the participant ──────────────────────────────────────

describe("WallJoinRoom", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;
  const ROUND = "round_000001";
  const OTHER = { id: "pid_bobby001", text: "Fewer meetings", votes: 0, merged: [] };

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  let seq = 0;
  async function wallState(o: Partial<WallStateBody> = {}) {
    const body: WallStateBody = {
      v: 1,
      by: HOST.id,
      seq: ++seq,
      tool: "audience-wall",
      endsAt: Date.now() + 3 * 3_600_000,
      keys: keys.publicKeys,
      round: {
        id: ROUND,
        prompt: "What should we change?",
        open: true,
        mode: "live",
        revealed: false,
        count: 1,
        posts: [OTHER],
      },
      hands: [],
      acks: [],
      nacks: [],
      ...o,
    };
    return JSON.parse(
      JSON.stringify({ ...body, sig: await crypto.sign(keys, wallStateInput(body)) })
    );
  }

  /** The requests this tab sent, opened with the host's key. */
  async function sentIntents(ch: FakeChannel): Promise<{ iid: string; intent: WallIntent }[]> {
    const out: { iid: string; intent: WallIntent }[] = [];
    for (const env of ch.sent(WALL_ROOM_EVENTS.intent) as IntentEnvelope[]) {
      expect(env.by).toBe(A.id);
      const plain = await crypto.open(keys, env, intentAad(env.by, env.iid));
      const intent = plain === null ? null : readIntent(plain);
      if (!intent) throw new Error("a request the host couldn't read");
      out.push({ iid: env.iid, intent });
    }
    return out;
  }

  async function joined() {
    atLink("audience-wall", keys.fingerprint);
    const onLeave = vi.fn();
    wrap(
      <WallJoinRoom
        tool="audience-wall"
        toolName="Audience Wall"
        code={CODE}
        identity={ident(A)}
        onLeave={onLeave}
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
    await deliver(ch, WALL_ROOM_EVENTS.state, await wallState());
    return { ch, onLeave };
  }

  it("posts, upvotes, raises a hand and takes a post back, each sealed to the host", async () => {
    const { ch } = await joined();
    expect(
      screen.getByRole("heading", { level: 1, name: "What should we change?" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Posts show without your name\./)).toBeInTheDocument();
    // Posts show as they arrive here, and the page says what that gives away.
    expect(
      screen.getByText(
        /They show as they arrive, so others could tell who sent a post or an upvote\./
      )
    ).toBeInTheDocument();

    const box = screen.getByLabelText("Your post");
    fireEvent.change(box, { target: { value: "More   pairing" } });
    expect(screen.getByText("12 of 280 characters.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
    });
    await flush();
    expect(box).toHaveValue("");

    const upvote = screen.getByRole("button", { name: /Upvote: Fewer meetings/ });
    await act(async () => {
      fireEvent.click(upvote);
    });
    await flush();
    expect(upvote).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Raise my hand" }));
    });
    await flush();

    let sent = await sentIntents(ch);
    expect(sent.map((s) => s.intent.t)).toEqual(["post", "vote", "hand"]);
    const postReq = sent[0].intent as Extract<WallIntent, { t: "post" }>;
    expect(postReq).toMatchObject({ t: "post", r: ROUND, text: "More pairing" });
    expect(sent[1].intent).toMatchObject({ t: "vote", r: ROUND, pid: OTHER.id });
    expect(sent[2].intent).toEqual({ t: "hand", up: true });

    // The host takes the post and the hand, and refuses the vote.
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await wallState({
        round: {
          id: ROUND,
          prompt: "What should we change?",
          open: true,
          mode: "live",
          revealed: false,
          count: 2,
          posts: [OTHER, { id: postReq.pid, text: "More pairing", votes: 0, merged: [] }],
        },
        hands: [A.id],
        acks: [sent[0].iid, sent[2].iid],
        nacks: [{ iid: sent[1].iid, why: "closed" }],
      })
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The host isn't taking that right now.");
    expect(screen.getByRole("button", { name: /Upvote: Fewer meetings/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    const wall = screen.getByRole("region", { name: "The wall" });
    expect(within(wall).getByText("Your post")).toBeInTheDocument();
    expect(screen.getByText(/You're number 1 in the queue/)).toBeInTheDocument();
    // Nobody's name or id is on a post.
    expect(wall.textContent).not.toContain("Bo");
    expect(wall.innerHTML).not.toContain(B.id);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Take it back: More pairing/ }));
    });
    await flush();
    sent = await sentIntents(ch);
    const withdraw = sent.at(-1)!.intent as Extract<WallIntent, { t: "withdraw" }>;
    expect(withdraw).toMatchObject({ t: "withdraw", r: ROUND, pid: postReq.pid });
    // Only the key behind the post's lock takes it back.
    expect(lockOf(withdraw.key)).toBe(postReq.lock);
  });

  it("shows only a count and this tab's own posts while the host hides the wall", async () => {
    const { ch } = await joined();
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await wallState({
        round: {
          id: ROUND,
          prompt: "What worries you?",
          open: true,
          mode: "hidden",
          revealed: false,
          count: 3,
          posts: null,
        },
      })
    );
    expect(
      screen.getByText("3 posts so far. The host shows them all at once.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Fewer meetings")).toBeNull();
    expect(screen.queryByRole("button", { name: /Upvote/ })).toBeNull();
    expect(screen.getByText(/Posts show without your name\./)).toBeInTheDocument();
    expect(screen.queryByText(/They show as they arrive/)).toBeNull();
    // Revealed: all at once, and the host stopped taking posts.
    await deliver(
      ch,
      WALL_ROOM_EVENTS.state,
      await wallState({
        round: {
          id: ROUND,
          prompt: "What worries you?",
          open: false,
          mode: "hidden",
          revealed: true,
          count: 1,
          posts: [OTHER],
        },
      })
    );
    expect(screen.getByText("Fewer meetings")).toBeInTheDocument();
    expect(screen.getByText("The host isn't taking posts right now.")).toBeInTheDocument();
    expect(screen.queryByText(/They show as they arrive/)).toBeNull();
  });

  it("shows the end when the host ends the room", async () => {
    const { ch, onLeave } = await joined();
    const body: RoomEndBody = { v: 1, by: HOST.id, reason: "idle" };
    await deliver(ch, WALL_ROOM_EVENTS.end, {
      ...body,
      sig: await crypto.sign(keys, wallControlInput(WALL_ROOM_EVENTS.end, body)),
    });
    expect(
      screen.getByRole("heading", { name: "The room ended after 30 minutes without activity" })
    ).toHaveFocus();
    expect(screen.queryByLabelText("Your post")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

// ── Show rooms: the host ─────────────────────────────────────────────

describe("ShowRoomHost", () => {
  it("asks for consent first, then shows, clears and ends", async () => {
    const crypto = fakeVoteCrypto();
    wrap(
      <ShowRoomHost tool="picker" toolName="Picker" crypto={crypto}>
        {(room) => (
          <button type="button" onClick={() => room.show("text", { title: "Sam", body: "next" })}>
            Show Sam
          </button>
        )}
      </ShowRoomHost>
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Show on everyone's phones" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleDescription(VISITOR_ROOM_CONSENT_TEXT);
    // Nothing opens before consent.
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Hana" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
    });
    await flush();
    const ch = fakeRealtime.last();
    expect(ch.name).toMatch(/^visitor:picker:[A-Z0-9]{12}$/);
    act(() => ch.connect());
    await flush();
    const me = (ch.track.mock.calls.at(-1) as unknown as [{ id: string }])[0];
    act(() => ch.setPresence([{ ...HOST, id: me.id }, A]));
    await flush();
    await tick(600);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing yet\. What you show appears here/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 person said they're here/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Sam" }));
    await tick(400);
    expect(screen.getByText("Sam")).toBeInTheDocument();
    const shown = ch.sent(SHOW_ROOM_EVENTS.state).at(-1) as ShowStateBody;
    expect(shown.frame).toMatchObject({ n: 1, kind: "text" });

    fireEvent.click(screen.getByRole("button", { name: "Clear the screen" }));
    await tick(400);
    expect(screen.queryByText("Sam")).toBeNull();
    expect((ch.sent(SHOW_ROOM_EVENTS.state).at(-1) as ShowStateBody).frame).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    const confirm = screen.getByRole("dialog", { name: "End the live room?" });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "End room" }));
    });
    await flush();
    expect(screen.getByRole("heading", { name: "You ended the live room" })).toBeInTheDocument();
    expect(ch.sent(SHOW_ROOM_EVENTS.end)).toEqual([expect.objectContaining({ reason: "host" })]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flush();
    expect(screen.getByRole("button", { name: "Show on everyone's phones" })).toBeInTheDocument();
  });
});
