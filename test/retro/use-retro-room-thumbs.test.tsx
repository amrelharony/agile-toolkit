import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { HOST_MIGRATION_DELAY_MS } from "@/lib/realtime/host-election";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BoardState } from "@/app/(tools)/retro/types";
import { lockOf, type RoomPoll, type RoomSnapshot } from "@/app/(tools)/retro/room/protocol";
import { toRoomSnapshot } from "@/app/(tools)/retro/room/snapshot";
import { fakeRealtime, type FakeMember } from "./fake-realtime";

/**
 * The Lean Coffee thumbs vote in the Retro room hook (protocol revision 2),
 * against a fake Realtime channel: the host opens a vote and its snapshot
 * says how many voted, never who; a member's thumb counts once and only
 * their own tab can change it; closing shares the totals; a member who
 * leaves takes their thumb; and a participant's thumb travels with a lock,
 * a change with the key behind it.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useRetroRoom } from "@/app/(tools)/retro/room/use-retro-room";

const CODE = "ABCDEFGHJKMN";
const NOW = Date.parse("2026-11-12T10:00:00.000Z");
const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-11-12T09:00:00Z" };
const ME: FakeMember = { id: "self_00000000000", name: "Pat", joinedAt: "2026-11-12T09:01:00Z" };
const OTHER: FakeMember = { id: "other_0000000000", name: "Olu", joinedAt: "2026-11-12T09:02:00Z" };
const KEY_ME = "kme_0123456789abcdef";
const KEY_ME_2 = "kme_fedcba9876543210";
const KEY_OTHER = "kot_0123456789abcdef";

const lean = retroFormats.find((f) => f.id === "lean-coffee") ?? retroFormats[0];
const board = (over: Partial<BoardState> = {}): BoardState => ({
  format: lean,
  phase: "discuss",
  cards: [],
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
  ...over,
});

function snap(by: string, poll?: RoomPoll, seq = 1): RoomSnapshot {
  return JSON.parse(
    JSON.stringify(
      toRoomSnapshot(board(), {
        by,
        seq,
        endsAt: NOW + VISITOR_LIMITS.hardTtlMs,
        members: [HOST, ME, OTHER].map(({ id, name }) => ({ id, name })),
        votesUsed: {},
        timer: { running: false, remaining: 0 },
        now: Date.now(),
        hideWhileWriting: false,
        votesPerPerson: 3,
        poll: poll ?? null,
      })
    )
  ) as RoomSnapshot;
}

const thumb = (
  by: string,
  pollId: string,
  choice: "keep" | "move",
  key: string,
  prev?: string
) => ({
  v: 2,
  by,
  intent: {
    t: "thumb",
    iid: `t_${choice}_${key.slice(0, 6)}`,
    pollId,
    choice,
    lock: lockOf(key),
    ...(prev ? { key: prev } : {}),
  },
});

function host() {
  return renderHook(() => {
    const [b, setBoard] = useState(board());
    const room = useRetroRoom({
      code: CODE,
      identity: { id: HOST.id, name: HOST.name },
      role: "host",
      hostBoard: b,
      onHostUpdate: (updater) => setBoard((prev) => updater(prev)),
      startedAt: NOW,
    });
    return { board: b, room };
  });
}

const states = () => fakeRealtime.last().sent("retro:state") as RoomSnapshot[];
const flush = () => act(() => vi.advanceTimersByTime(2_000));

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  useWorkspaceStore.setState({ retroBoards: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("hosting the thumbs vote", () => {
  function opened() {
    const view = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    flush();
    act(() => view.result.current.room.thumbs.open("Our standups run too long"));
    flush();
    const pollId = view.result.current.room.thumbs.poll!.id;
    return { ...view, ch, pollId };
  }

  it("opens a vote the snapshot shares as a count, never who", () => {
    const { result, ch, pollId } = opened();
    expect(states().at(-1)!.poll).toEqual({
      id: pollId,
      topic: "Our standups run too long",
      open: true,
      voters: 0,
    });
    act(() => {
      ch.deliver("retro:intent", thumb(ME.id, pollId, "keep", KEY_ME));
      ch.deliver("retro:intent", thumb(OTHER.id, pollId, "move", KEY_OTHER));
    });
    expect(result.current.room.thumbs.poll).toMatchObject({ keep: 1, move: 1, voters: 2 });
    flush();
    const shared = states().at(-1)!;
    expect(shared.poll).toEqual({
      id: pollId,
      topic: "Our standups run too long",
      open: true,
      voters: 2,
    });
    const json = JSON.stringify(shared.poll);
    for (const secret of [ME.id, OTHER.id, lockOf(KEY_ME)]) expect(json).not.toContain(secret);
    // The board itself never changed.
    expect(result.current.board.cards).toEqual([]);
  });

  it("lets a member change their own thumb with its key, and nobody else's", () => {
    const { result, ch, pollId } = opened();
    act(() => ch.deliver("retro:intent", thumb(ME.id, pollId, "keep", KEY_ME)));
    // Someone claiming to be ME without the key changes nothing.
    act(() => ch.deliver("retro:intent", thumb(ME.id, pollId, "move", KEY_OTHER)));
    expect(result.current.room.thumbs.poll).toMatchObject({ keep: 1, move: 0 });
    act(() => ch.deliver("retro:intent", thumb(ME.id, pollId, "move", KEY_ME_2, KEY_ME)));
    expect(result.current.room.thumbs.poll).toMatchObject({ keep: 0, move: 1, voters: 1 });
    // A thumb on another vote, or from outside the room, is dropped.
    act(() => ch.deliver("retro:intent", thumb(OTHER.id, "poll_old", "keep", KEY_OTHER)));
    act(() => ch.deliver("retro:intent", thumb("ghost_0000000000", pollId, "keep", KEY_OTHER)));
    expect(result.current.room.thumbs.poll).toMatchObject({ voters: 1 });
  });

  it("closes the vote with the totals, then clears it off everyone's screen", () => {
    const { result, ch, pollId } = opened();
    act(() => {
      ch.deliver("retro:intent", thumb(ME.id, pollId, "keep", KEY_ME));
      ch.deliver("retro:intent", thumb(OTHER.id, pollId, "keep", KEY_OTHER));
    });
    act(() => result.current.room.thumbs.close());
    flush();
    expect(states().at(-1)!.poll).toEqual({
      id: pollId,
      topic: "Our standups run too long",
      open: false,
      voters: 2,
      keep: 2,
      move: 0,
    });
    // A late thumb doesn't count once it's closed.
    act(() => ch.deliver("retro:intent", thumb(ME.id, pollId, "move", KEY_ME_2, KEY_ME)));
    expect(result.current.room.thumbs.poll).toMatchObject({ keep: 2, move: 0 });
    act(() => result.current.room.thumbs.clear());
    flush();
    expect(result.current.room.thumbs.poll).toBeNull();
    expect(states().at(-1)!.poll).toBeUndefined();
  });

  it("drops the thumb of a member who leaves or is removed", () => {
    const { result, ch, pollId } = opened();
    act(() => {
      ch.deliver("retro:intent", thumb(ME.id, pollId, "keep", KEY_ME));
      ch.deliver("retro:intent", thumb(OTHER.id, pollId, "move", KEY_OTHER));
    });
    act(() => ch.setPresence([HOST, ME]));
    expect(result.current.room.thumbs.poll).toMatchObject({ keep: 1, move: 0, voters: 1 });
    act(() => result.current.room.kick(ME.id));
    expect(result.current.room.thumbs.poll).toMatchObject({ voters: 0 });
  });

  it("keeps a closed vote's totals when a member leaves or is removed", () => {
    const { result, ch, pollId } = opened();
    act(() => {
      ch.deliver("retro:intent", thumb(ME.id, pollId, "keep", KEY_ME));
      ch.deliver("retro:intent", thumb(OTHER.id, pollId, "move", KEY_OTHER));
    });
    act(() => result.current.room.thumbs.close());
    flush();
    const shown = states().at(-1)!.poll;
    expect(shown).toMatchObject({ open: false, keep: 1, move: 1, voters: 2 });
    // Recounting would show the room how the one who left had voted.
    act(() => ch.setPresence([HOST, ME]));
    flush();
    expect(result.current.room.thumbs.poll).toMatchObject({ keep: 1, move: 1, voters: 2 });
    expect(states().at(-1)!.poll).toEqual(shown);
    act(() => result.current.room.kick(ME.id));
    flush();
    expect(states().at(-1)!.poll).toEqual(shown);
  });

  it("starts a fresh vote each time it asks", () => {
    const { result, ch, pollId } = opened();
    act(() => ch.deliver("retro:intent", thumb(ME.id, pollId, "keep", KEY_ME)));
    act(() => result.current.room.thumbs.open("The next topic"));
    const next = result.current.room.thumbs.poll!;
    expect(next.id).not.toBe(pollId);
    expect(next).toMatchObject({ topic: "The next topic", voters: 0, open: true });
  });
});

describe("a participant's thumb", () => {
  function joined() {
    const view = renderHook(() =>
      useRetroRoom({
        code: CODE,
        identity: { id: ME.id, name: ME.name },
        role: "participant",
      })
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    return { ...view, ch };
  }
  const POLL: RoomPoll = { id: "poll_1", topic: "Standups", open: true, voters: 0 };
  const sentThumbs = (ch: ReturnType<typeof fakeRealtime.last>) =>
    (
      ch.sent("retro:intent") as {
        intent: { t: string; lock: string; key?: string; choice: string };
      }[]
    )
      .map((m) => m.intent)
      .filter((i) => i.t === "thumb");

  it("has nothing to vote on until the host opens a vote", () => {
    const { result, ch } = joined();
    act(() => ch.deliver("retro:state", snap(HOST.id)));
    expect(result.current.poll).toBeNull();
    expect(result.current.thumb("keep")).toBe(false);
    expect(sentThumbs(ch)).toEqual([]);
  });

  it("sends a first thumb with a lock, and a change with the key behind it", () => {
    const { result, ch } = joined();
    act(() => ch.deliver("retro:state", snap(HOST.id, POLL)));
    expect(result.current.poll).toEqual(POLL);
    act(() => {
      expect(result.current.thumb("keep")).toBe(true);
    });
    expect(result.current.myThumb).toBe("keep");
    // The same thumb again sends nothing.
    act(() => {
      result.current.thumb("keep");
    });
    act(() => {
      result.current.thumb("move");
    });
    expect(result.current.myThumb).toBe("move");
    const [first, change] = sentThumbs(ch);
    expect(sentThumbs(ch)).toHaveLength(2);
    expect(first).toMatchObject({ choice: "keep", pollId: "poll_1" });
    expect(first.key).toBeUndefined();
    expect(change.choice).toBe("move");
    expect(change.key).toBeDefined();
    expect(lockOf(change.key!)).toBe(first.lock);
    expect(change.lock).not.toBe(first.lock);
  });

  it("forgets its thumb when the host starts another vote, and shows the totals once closed", () => {
    const { result, ch } = joined();
    act(() => ch.deliver("retro:state", snap(HOST.id, POLL)));
    act(() => {
      result.current.thumb("keep");
    });
    act(() =>
      ch.deliver(
        "retro:state",
        snap(HOST.id, { ...POLL, open: false, voters: 1, keep: 1, move: 0 }, 2)
      )
    );
    expect(result.current.poll).toMatchObject({ open: false, keep: 1 });
    expect(result.current.thumb("move")).toBe(false);
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, { ...POLL, id: "poll_2", topic: "Next" }, 3))
    );
    expect(result.current.myThumb).toBeNull();
  });

  it("drops the old host's vote when it takes over the room", () => {
    const { result, ch } = joined();
    act(() => ch.deliver("retro:state", snap(HOST.id, POLL)));
    act(() => {
      result.current.thumb("keep");
    });
    // The host leaves; this member is next in line.
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.promoted).toBe(true);
    expect(result.current.poll).toBeNull();
    expect(result.current.myThumb).toBeNull();
    expect(result.current.thumbs.poll).toBeNull();
  });
});
