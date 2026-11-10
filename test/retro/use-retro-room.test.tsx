import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { HOST_MIGRATION_DELAY_MS } from "@/lib/realtime/host-election";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import type { RoomSnapshot } from "@/app/(tools)/retro/room/protocol";
import { toRoomSnapshot } from "@/app/(tools)/retro/room/snapshot";
import { fakeRealtime, type FakeMember } from "./fake-realtime";

/**
 * The Retro room hook against a fake Realtime channel: who a participant
 * trusts, what the host applies, host election, and that a participant's
 * board never reaches the workspace store.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useRetroRoom, type UseRetroRoomOptions } from "@/app/(tools)/retro/room/use-retro-room";

const CODE = "ABCDEFGHJKMN";
const NOW = Date.parse("2026-10-19T10:00:00.000Z");
const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-19T09:00:00Z" };
const ME: FakeMember = { id: "self_00000000000", name: "Pat", joinedAt: "2026-10-19T09:01:00Z" };
const OTHER: FakeMember = { id: "other_0000000000", name: "Olu", joinedAt: "2026-10-19T09:02:00Z" };
const SPOOF: FakeMember = { id: "spoof_0000000000", name: "Sly", joinedAt: "2026-10-19T09:03:00Z" };

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

function board(overrides: Partial<BoardState> = {}): BoardState {
  return {
    format: retroFormats[0],
    phase: "write",
    cards: [card("c1"), card("c2", { columnKey: "stop" })],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

/** A snapshot as `by` would send it. */
function snap(
  by: string,
  b: BoardState = board(),
  extra: Partial<{ seq: number; votesUsed: Record<string, number>; members: FakeMember[] }> = {}
): RoomSnapshot {
  return JSON.parse(
    JSON.stringify(
      toRoomSnapshot(b, {
        by,
        seq: extra.seq ?? 1,
        endsAt: NOW + VISITOR_LIMITS.hardTtlMs,
        members: (extra.members ?? [HOST, ME, OTHER]).map(({ id, name }) => ({ id, name })),
        votesUsed: extra.votesUsed ?? {},
        timer: { running: b.timerRunning, remaining: b.timerSeconds },
        now: Date.now(),
        hideWhileWriting: false,
        votesPerPerson: 3,
      })
    )
  ) as RoomSnapshot;
}

function addIntent(by: string, text: string, iid: string, columnKey = "start") {
  return { v: 2, by, intent: { t: "card:add", iid, columnKey, text } };
}

function participant(identity: FakeMember = ME) {
  const opts: UseRetroRoomOptions = {
    code: CODE,
    identity: { id: identity.id, name: identity.name },
    role: "participant",
  };
  return renderHook(() => useRetroRoom(opts));
}

function host(initial: BoardState = board()) {
  const onHostUpdate = vi.fn();
  const view = renderHook(() => {
    const [b, setBoard] = useState(initial);
    const room = useRetroRoom({
      code: CODE,
      identity: { id: HOST.id, name: HOST.name },
      role: "host",
      hostBoard: b,
      onHostUpdate: (updater) => {
        onHostUpdate();
        setBoard((prev) => updater(prev));
      },
      startedAt: NOW,
    });
    return { board: b, setBoard, room };
  });
  return { ...view, onHostUpdate };
}

function states(): RoomSnapshot[] {
  return fakeRealtime.last().sent("retro:state") as RoomSnapshot[];
}

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

describe("useRetroRoom: the gate", () => {
  it("opens nothing while the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    const { result } = participant();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
    expect(result.current.status).toBe("unavailable");
  });

  it("joins visitor:retro:<code> with the flag on", () => {
    participant();
    expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1);
    expect(fakeRealtime.last().name).toBe(`visitor:retro:${CODE}`);
  });
});

describe("useRetroRoom: a participant trusts only the host", () => {
  it("applies the host's snapshot and ignores everyone else's state and control messages", () => {
    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, SPOOF]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id)));
    expect(result.current.status).toBe("live");
    expect(result.current.hostId).toBe(HOST.id);
    expect(result.current.hostName).toBe("Hana");
    expect(result.current.board?.cards.map((c) => c.id)).toEqual(["c1", "c2"]);

    // Another member's snapshot, even one in presence, is ignored...
    act(() =>
      ch.deliver("retro:state", snap(SPOOF.id, board({ cards: [card("evil", { text: "Fake" })] })))
    );
    // ...as is one that names the host but comes from someone else.
    act(() =>
      ch.deliver("retro:state", {
        ...snap(HOST.id, board({ cards: [card("evil2")] })),
        by: SPOOF.id,
      })
    );
    expect(result.current.board?.cards.map((c) => c.id)).toEqual(["c1", "c2"]);

    // Only the host can remove this member or end the room.
    act(() => ch.deliver("retro:kick", { by: SPOOF.id, id: ME.id }));
    act(() => ch.deliver("retro:end", { by: SPOOF.id }));
    expect(result.current.status).toBe("live");

    act(() => ch.deliver("retro:state", snap(HOST.id, board({ phase: "vote" }), { seq: 2 })));
    expect(result.current.board?.phase).toBe("vote");

    act(() => ch.deliver("retro:end", { by: HOST.id }));
    expect(result.current.status).toBe("ended");
    expect(ch.removed).toBe(true);
    // The last board stays in memory for "Save a copy".
    expect(result.current.board?.cards).toHaveLength(2);
  });

  it("holds a first snapshot until its sender shows up in presence", () => {
    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([ME]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id)));
    expect(result.current.status).toBe("connecting");
    expect(result.current.board).toBeNull();
    act(() => ch.setPresence([HOST, ME]));
    expect(result.current.status).toBe("live");
    expect(result.current.hostId).toBe(HOST.id);
  });

  it("leaves when the host removes it, and only then", () => {
    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id)));
    act(() => ch.deliver("retro:kick", { by: HOST.id, id: OTHER.id }));
    expect(result.current.status).toBe("live");
    act(() => ch.deliver("retro:kick", { by: HOST.id, id: ME.id }));
    expect(result.current.status).toBe("kicked");
    expect(ch.removed).toBe(true);
  });

  it("closes at the room's 3-hour limit", () => {
    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id)));
    act(() => vi.advanceTimersByTime(VISITOR_LIMITS.hardTtlMs - 1_000));
    expect(result.current.status).toBe("live");
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.status).toBe("expired");
    expect(ch.removed).toBe(true);
  });
});

describe("useRetroRoom: participant state stays in memory", () => {
  it("never writes the room's board to the workspace store", () => {
    const own = { id: "retro:current", ...board({ cards: [card("mine", { text: "My own" })] }) };
    useWorkspaceStore.setState({ retroBoards: [own] });
    const before = JSON.stringify(useWorkspaceStore.getState().retroBoards);

    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id)));

    let sent = "";
    act(() => {
      sent = result.current.addCard("start", "From the room");
    });
    expect(sent).toBe("sent");
    // The card goes to the host as an intent; nothing changes locally until it answers.
    expect(ch.sent("retro:intent")).toHaveLength(1);
    expect(result.current.board?.cards).toHaveLength(2);

    act(() => ch.deliver("retro:state", snap(HOST.id, board({ phase: "vote" }), { seq: 2 })));
    act(() => {
      result.current.vote("c1");
    });
    expect(result.current.votesLeft).toBe(2);
    act(() => ch.deliver("retro:end", { by: HOST.id }));

    expect(JSON.stringify(useWorkspaceStore.getState().retroBoards)).toBe(before);
  });
});

describe("useRetroRoom: the host", () => {
  it("never applies inbound state", () => {
    const { result, onHostUpdate } = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    const hijack = board({ cards: [card("hijack")] });
    act(() => ch.deliver("retro:state", snap(ME.id, hijack)));
    act(() => ch.deliver("retro:state", snap(HOST.id, hijack))); // claims to be the host
    expect(onHostUpdate).not.toHaveBeenCalled();
    expect(result.current.board.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
    act(() => ch.deliver("retro:end", { by: HOST.id }));
    expect(result.current.room.status).toBe("live");
  });

  it("applies admitted members' intents to its board and shares the result, throttled", () => {
    const { result } = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => vi.advanceTimersByTime(1_000));
    const before = states().length;
    expect(before).toBeGreaterThan(0);

    act(() => {
      ch.deliver("retro:intent", addIntent(ME.id, "One", "i1"));
      ch.deliver("retro:intent", addIntent(ME.id, "Two", "i2"));
      ch.deliver("retro:intent", addIntent(ME.id, "Two", "i2")); // duplicate
      ch.deliver("retro:intent", addIntent(OTHER.id, "Not here", "i3")); // not in presence
    });
    expect(result.current.board.cards.map((c) => c.text)).toEqual([
      "Card c1",
      "Card c2",
      "One",
      "Two",
    ]);
    act(() => vi.advanceTimersByTime(1));
    expect(states().length).toBe(before + 1);
    const latest = states().at(-1)!;
    expect(latest.by).toBe(HOST.id);
    expect(latest.hostId).toBe(HOST.id);
    expect(latest.cards.map((c) => c.text)).toContain("Two");
    expect(latest.members.map((m) => m.id)).toEqual([HOST.id, ME.id]);
  });

  it("drops a removed member's intents and tells them to leave", () => {
    const { result } = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => result.current.room.kick(ME.id));
    expect(ch.sent("retro:kick")).toEqual([{ by: HOST.id, id: ME.id }]);
    expect(result.current.room.removedIds.has(ME.id)).toBe(true);
    act(() => ch.deliver("retro:intent", addIntent(ME.id, "Sneaky", "k1")));
    expect(result.current.board.cards).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1_000));
    expect(
      states()
        .at(-1)!
        .members.map((m) => m.id)
    ).toEqual([HOST.id]);
  });

  it("doesn't broadcast the timer's tick, but does start and pause", () => {
    const { result } = host(board({ timerRunning: true, timerSeconds: 100 }));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => vi.advanceTimersByTime(1_000));
    const before = states().length;
    for (let i = 0; i < 10; i++) {
      act(() => {
        result.current.setBoard((b) => ({ ...b, timerSeconds: b.timerSeconds - 1 }));
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(states().length).toBe(before);
    act(() => result.current.setBoard((b) => ({ ...b, timerRunning: false })));
    act(() => vi.advanceTimersByTime(600));
    expect(states().length).toBe(before + 1);
    expect(states().at(-1)!.timer).toMatchObject({ running: false, remaining: 90 });
  });

  it("re-sends on a new member and every 30 s", () => {
    host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST]);
    });
    act(() => vi.advanceTimersByTime(1_000));
    const before = states().length;
    act(() => ch.setPresence([HOST, ME]));
    act(() => vi.advanceTimersByTime(600));
    expect(states().length).toBe(before + 1);
    act(() => vi.advanceTimersByTime(VISITOR_LIMITS.keepaliveMs));
    expect(states().length).toBe(before + 2);
  });

  it("asks after 30 idle minutes, then ends the room", () => {
    const { result } = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => vi.advanceTimersByTime(VISITOR_LIMITS.idleMs + 30_000));
    expect(result.current.room.idlePrompt).toBe(true);
    act(() => result.current.room.keepOpen());
    expect(result.current.room.idlePrompt).toBe(false);

    act(() => vi.advanceTimersByTime(VISITOR_LIMITS.idleMs + 30_000));
    expect(result.current.room.idlePrompt).toBe(true);
    act(() => vi.advanceTimersByTime(VISITOR_LIMITS.idleGraceMs - 1));
    expect(result.current.room.status).not.toBe("ended");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.room.status).toBe("ended");
    expect(result.current.room.endReason).toBe("idle");
    expect(ch.sent("retro:end")).toEqual([{ by: HOST.id }]);
    // Ending the room keeps the host's board.
    expect(result.current.board.cards).toHaveLength(2);
  });
});

describe("useRetroRoom: host election", () => {
  function joinedParticipant(identity: FakeMember, votesUsed: Record<string, number> = {}) {
    const view = participant(identity);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id, board(), { seq: 7, votesUsed })));
    return { ...view, ch };
  }

  it("takes over, in memory, when it is the earliest member left", () => {
    const { result, ch } = joinedParticipant(ME, { [ME.id]: 1 });
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS - 1));
    expect(result.current.isHost).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isHost).toBe(true);
    expect(result.current.promoted).toBe(true);
    expect(result.current.hostId).toBe(ME.id);
    expect(result.current.board?.cards.map((c) => c.id)).toEqual(["c1", "c2"]);

    act(() => vi.advanceTimersByTime(600));
    const latest = states().at(-1)!;
    expect(latest).toMatchObject({ by: ME.id, hostId: ME.id });
    expect(latest.seq).toBeGreaterThan(7);
    expect(latest.votesUsed).toEqual({ [ME.id]: 1 });

    // The new host applies the others' intents to its in-memory board.
    act(() => ch.deliver("retro:intent", addIntent(OTHER.id, "Carry on", "e1")));
    expect(result.current.board?.cards.map((c) => c.text)).toContain("Carry on");
    // ...and still writes nothing to the workspace.
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
  });

  it("follows the elected member when it isn't the earliest", () => {
    const { result, ch } = joinedParticipant(OTHER);
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.isHost).toBe(false);
    expect(result.current.hostId).toBe(ME.id);

    act(() => ch.deliver("retro:state", snap(ME.id, board({ phase: "vote" }), { seq: 8 })));
    expect(result.current.board?.phase).toBe("vote");
    // The departed host's id no longer carries any weight.
    act(() => ch.deliver("retro:state", snap(HOST.id, board({ phase: "actions" }), { seq: 9 })));
    expect(result.current.board?.phase).toBe("vote");
  });

  it("accepts the elected member's snapshot before its own timer fires", () => {
    const { result, ch } = joinedParticipant(OTHER);
    act(() => ch.setPresence([ME, OTHER]));
    act(() => ch.deliver("retro:state", snap(ME.id, board({ phase: "discuss" }), { seq: 8 })));
    expect(result.current.board?.phase).toBe("discuss");
    // A member who wouldn't win the election is still ignored.
    act(() => ch.deliver("retro:state", snap(SPOOF.id, board({ phase: "actions" }), { seq: 9 })));
    expect(result.current.board?.phase).toBe("discuss");
  });
});
