import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { HOST_MIGRATION_DELAY_MS } from "@/lib/realtime/host-election";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toast } from "@/lib/utils/toast";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import { MEMBER_CARD_CAP, lockOf, type RoomSnapshot } from "@/app/(tools)/retro/room/protocol";
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

import {
  BOARD_TOO_BIG_TO_REVEAL,
  SETTLE_MS,
  useRetroRoom,
  type UseRetroRoomOptions,
} from "@/app/(tools)/retro/room/use-retro-room";

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

/** A snapshot as `by` would send it (cards shown in Write unless `hide`). */
function snap(
  by: string,
  b: BoardState = board(),
  extra: Partial<{
    seq: number;
    votesUsed: Record<string, number>;
    members: FakeMember[];
    hide: boolean;
  }> = {}
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
        hideWhileWriting: extra.hide ?? false,
        votesPerPerson: 3,
      })
    )
  ) as RoomSnapshot;
}

/** The key a test sender holds for a card (by its id), and for its votes on a card. */
const cardKey = (cardId: string) => `ck_${cardId}_0123456789`;
const voteKey = (by: string, cardId: string) => `vk_${by}-${cardId}`;

function addIntent(by: string, text: string, iid: string, columnKey = "start") {
  return { v: 2, by, intent: { t: "card:add", iid, columnKey, text, lock: lockOf(cardKey(iid)) } };
}

/** A delete, vote or take-back as `by`'s own tab would send it, key or lock included. */
function intent(by: string, t: "card:delete" | "vote" | "vote:undo", cardId: string, iid: string) {
  const proof =
    t === "vote"
      ? { lock: lockOf(voteKey(by, cardId)) }
      : { key: t === "vote:undo" ? voteKey(by, cardId) : cardKey(cardId) };
  return { v: 2, by, intent: { t, iid, cardId, ...proof } };
}

type Intent = {
  v: number;
  by: string;
  intent: { t: string; iid: string; cardId?: string; lock?: string; key?: string };
};

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

  it("says when the host's state is of another version, and still never applies it", () => {
    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    // A version 1 host (a tab on an older build): refused on its version.
    act(() => ch.deliver("retro:state", { ...snap(HOST.id), v: 1 }));
    expect(result.current.status).toBe("connecting");
    expect(result.current.board).toBeNull();
    expect(result.current.otherVersion).toBe(true);
    // Once the host is on this version too, the room opens.
    act(() => ch.deliver("retro:state", snap(HOST.id)));
    expect(result.current.status).toBe("live");
    expect(result.current.otherVersion).toBe(false);
  });

  it("ignores another version's message from someone not in the room", () => {
    const { result } = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:state", { ...snap(SPOOF.id), v: 1 }));
    expect(result.current.otherVersion).toBe(false);
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

describe("useRetroRoom: a participant's own cards and votes", () => {
  function joined(first: RoomSnapshot) {
    const view = participant();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => ch.deliver("retro:state", first));
    return { ...view, ch };
  }

  it("shows its own cards while the host hides the rest, and deletes them", () => {
    const { result, ch } = joined(snap(HOST.id, board(), { hide: true }));
    expect(result.current.board?.cards).toEqual([]);
    expect(result.current.shownCards).toEqual([]);
    expect(result.current.hiddenCounts).toEqual({ start: 1, stop: 1, continue: 0 });

    let res = "";
    act(() => {
      res = result.current.addCard("start", "My idea");
    });
    expect(res).toBe("sent");
    const id = (ch.sent("retro:intent") as Intent[])[0].intent.iid;
    // On screen at once, from this tab's memory.
    expect(result.current.shownCards?.map((c) => [c.id, c.text])).toEqual([[id, "My idea"]]);
    expect(result.current.ownIds.has(id)).toBe(true);

    // The host counts it: two in Start now, one of them this tab's; the other stays a count.
    const withMine = board({ cards: [...board().cards, card(id, { text: "My idea" })] });
    act(() => ch.deliver("retro:state", snap(HOST.id, withMine, { hide: true, seq: 2 })));
    expect(result.current.shownCards?.map((c) => c.id)).toEqual([id]);
    expect(result.current.hiddenCounts).toEqual({ start: 1, stop: 1, continue: 0 });

    let ok = false;
    act(() => {
      ok = result.current.deleteCard(id);
    });
    expect(ok).toBe(true);
    const [add, del] = ch.sent("retro:intent") as Intent[];
    expect(del).toEqual({
      v: 2,
      by: ME.id,
      intent: { t: "card:delete", iid: expect.any(String), cardId: id, key: expect.any(String) },
    });
    // The add sent only the lock; the delete sends the key behind it.
    expect(JSON.stringify(add)).not.toContain(del.intent.key!);
    expect(lockOf(del.intent.key!)).toBe(add.intent.lock);
    expect(result.current.shownCards).toEqual([]);
    // Someone else's card isn't this tab's to delete.
    act(() => {
      ok = result.current.deleteCard("c1");
    });
    expect(ok).toBe(false);

    // The phase changes: everyone's text arrives.
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ phase: "vote" }), { hide: true, seq: 3 }))
    );
    expect(result.current.hiddenCounts).toBeNull();
    expect(result.current.shownCards?.map((c) => c.text)).toEqual(["Card c1", "Card c2"]);
  });

  it("marks its own cards on a board the host doesn't hide", () => {
    const { result, ch } = joined(snap(HOST.id));
    act(() => {
      result.current.addCard("stop", "Visible to all");
    });
    const id = (ch.sent("retro:intent") as Intent[])[0].intent.iid;
    // Nothing changes on screen until the host's snapshot says so.
    expect(result.current.shownCards?.map((c) => c.id)).toEqual(["c1", "c2"]);
    const withMine = board({ cards: [...board().cards, card(id, { columnKey: "stop" })] });
    act(() => ch.deliver("retro:state", snap(HOST.id, withMine, { seq: 2 })));
    expect(result.current.shownCards?.map((c) => c.id)).toEqual(["c1", "c2", id]);
    expect(Array.from(result.current.ownIds)).toEqual([id]);
  });

  it("drops a card the host never counted, once its request has had time to land", () => {
    // Nothing in Start on the host's board.
    const noStart = board({ cards: [card("c2", { columnKey: "stop" })] });
    const { result, ch } = joined(snap(HOST.id, noStart, { hide: true }));
    act(() => {
      result.current.addCard("start", "Lost on the way");
    });
    // A snapshot sent before the host saw it changes nothing yet.
    act(() => ch.deliver("retro:state", snap(HOST.id, noStart, { hide: true, seq: 2 })));
    expect(result.current.shownCards).toHaveLength(1);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    // Still none in Start: the card never landed.
    act(() => ch.deliver("retro:state", snap(HOST.id, noStart, { hide: true, seq: 3 })));
    expect(result.current.shownCards).toEqual([]);
    expect(result.current.ownIds.size).toBe(0);
  });

  it("drops a card that never landed in a column holding others' cards, by its id", () => {
    const { result, ch } = joined(snap(HOST.id, board(), { hide: true }));
    act(() => {
      result.current.addCard("start", "Dropped by the host");
    });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    // Start still holds one card (someone else's): a count alone can't tell.
    act(() => ch.deliver("retro:state", snap(HOST.id, board(), { hide: true, seq: 2 })));
    expect(result.current.shownCards).toEqual([]);
    expect(result.current.hiddenCounts).toEqual({ start: 1, stop: 1, continue: 0 });
  });

  /** Joined on a hidden board holding one card of this tab's (`id`) beside the others'. */
  function withOwnCard() {
    const view = joined(snap(HOST.id, board(), { hide: true }));
    act(() => {
      view.result.current.addCard("start", "Mine to delete");
    });
    const id = (view.ch.sent("retro:intent") as Intent[])[0].intent.iid;
    const withMine = board({ cards: [...board().cards, card(id, { text: "Mine to delete" })] });
    act(() => view.ch.deliver("retro:state", snap(HOST.id, withMine, { hide: true, seq: 2 })));
    return { ...view, id, withMine };
  }

  it("gives a card back when the host refused its delete", () => {
    const { result, ch, id, withMine } = withOwnCard();
    act(() => {
      result.current.deleteCard(id);
    });
    expect(result.current.shownCards).toEqual([]);
    // Still on the host's board: counted as this tab's, not as someone else's.
    expect(result.current.hiddenCounts).toEqual({ start: 1, stop: 1, continue: 0 });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() => ch.deliver("retro:state", snap(HOST.id, withMine, { hide: true, seq: 3 })));
    expect(result.current.shownCards?.map((c) => c.id)).toEqual([id]);
    expect(result.current.ownIds.has(id)).toBe(true);
    // ...so it can be deleted again.
    let ok = false;
    act(() => {
      ok = result.current.deleteCard(id);
    });
    expect(ok).toBe(true);
  });

  it("adds a deleted card again as a new card on Undo once the delete has landed", () => {
    const { result, ch, id } = withOwnCard();
    act(() => {
      result.current.deleteCard(id);
    });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() => ch.deliver("retro:state", snap(HOST.id, board(), { hide: true, seq: 3 })));
    const sent = ch.sent("retro:intent").length;
    let res = "";
    act(() => {
      res = result.current.undoDelete({ id, columnKey: "start", text: "Mine to delete" });
    });
    expect(res).toBe("sent");
    const again = (ch.sent("retro:intent") as Intent[]).slice(sent);
    expect(again).toHaveLength(1);
    expect(again[0].intent).toMatchObject({ t: "card:add", text: "Mine to delete" });
    expect(again[0].intent.iid).not.toBe(id);
  });

  it("puts a card back on Undo before its delete settled, adding it again only if the delete landed", () => {
    // The delete is refused: Undo only shows the card again.
    const refused = withOwnCard();
    act(() => {
      refused.result.current.deleteCard(refused.id);
    });
    const afterDelete = refused.ch.sent("retro:intent").length;
    act(() => {
      refused.result.current.undoDelete({
        id: refused.id,
        columnKey: "start",
        text: "Mine to delete",
      });
    });
    expect(refused.result.current.shownCards?.map((c) => c.id)).toEqual([refused.id]);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() =>
      refused.ch.deliver("retro:state", snap(HOST.id, refused.withMine, { hide: true, seq: 3 }))
    );
    expect(refused.ch.sent("retro:intent")).toHaveLength(afterDelete);
    expect(refused.result.current.shownCards?.map((c) => c.id)).toEqual([refused.id]);
    refused.unmount();

    // The delete landed: the card goes back to the host as a new one, once.
    fakeRealtime.reset();
    const landed = withOwnCard();
    act(() => {
      landed.result.current.deleteCard(landed.id);
    });
    act(() => {
      landed.result.current.undoDelete({
        id: landed.id,
        columnKey: "start",
        text: "Mine to delete",
      });
    });
    const before = landed.ch.sent("retro:intent").length;
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() => landed.ch.deliver("retro:state", snap(HOST.id, board(), { hide: true, seq: 3 })));
    const readded = (landed.ch.sent("retro:intent") as Intent[]).slice(before);
    expect(readded).toHaveLength(1);
    expect(readded[0].intent).toMatchObject({ t: "card:add", text: "Mine to delete" });
    expect(landed.result.current.shownCards?.map((c) => c.id)).toEqual([readded[0].intent.iid]);
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() => landed.ch.deliver("retro:state", snap(HOST.id, board(), { hide: true, seq: 4 })));
    // Not sent twice.
    expect(landed.ch.sent("retro:intent")).toHaveLength(before + 1);
  });

  it("takes its own vote back, and forgets a vote the host never counted", () => {
    const { result, ch } = joined(snap(HOST.id, board({ phase: "vote" })));
    act(() => {
      result.current.vote("c1");
    });
    expect(result.current.myVotes).toEqual({ c1: 1 });
    expect(result.current.votesLeft).toBe(2);

    let ok = true;
    act(() => {
      ok = result.current.unvote("c2"); // no vote there
    });
    expect(ok).toBe(false);
    act(() => {
      ok = result.current.unvote("c1");
    });
    expect(ok).toBe(true);
    const [cast, back] = ch.sent("retro:intent") as Intent[];
    expect(back).toEqual({
      v: 2,
      by: ME.id,
      intent: { t: "vote:undo", iid: expect.any(String), cardId: "c1", key: expect.any(String) },
    });
    expect(JSON.stringify(cast)).not.toContain(back.intent.key!);
    expect(lockOf(back.intent.key!)).toBe(cast.intent.lock);
    expect(result.current.myVotes).toEqual({});
    expect(result.current.votesLeft).toBe(3);

    act(() => {
      result.current.vote("c2");
    });
    expect(result.current.myVotes).toEqual({ c2: 1 });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ phase: "vote" }), { seq: 2, votesUsed: {} }))
    );
    expect(result.current.myVotes).toEqual({});
    expect(result.current.votesLeft).toBe(3);
  });

  it("adds a card undone before its delete settled again, even when that delete emptied the board", () => {
    const { result, ch } = joined(snap(HOST.id, board({ cards: [] }), { hide: true }));
    act(() => {
      result.current.addCard("start", "My only card");
    });
    const id = (ch.sent("retro:intent") as Intent[])[0].intent.iid;
    const onlyMine = board({ cards: [card(id, { text: "My only card" })] });
    act(() => ch.deliver("retro:state", snap(HOST.id, onlyMine, { hide: true, seq: 2 })));
    act(() => {
      result.current.deleteCard(id);
    });
    act(() => {
      result.current.undoDelete({ id, columnKey: "start", text: "My only card" });
    });
    // The delete landed and emptied the board: that is no clear by the host.
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ cards: [] }), { hide: true, seq: 3 }))
    );
    const before = ch.sent("retro:intent").length;
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ cards: [] }), { hide: true, seq: 4 }))
    );
    const readded = (ch.sent("retro:intent") as Intent[]).slice(before);
    expect(readded.map((s) => [s.intent.t, s.intent.iid === id])).toEqual([["card:add", false]]);
    expect(result.current.shownCards?.map((c) => c.text)).toEqual(["My only card"]);
  });

  it("keeps its card allowance when its own deletes empty the board, not when the host clears it", () => {
    const { result, ch } = joined(snap(HOST.id, board({ cards: [] }), { hide: true }));
    for (let i = 0; i < MEMBER_CARD_CAP; i++) {
      act(() => {
        result.current.addCard("start", `Mine ${i}`);
      });
    }
    const ids = (ch.sent("retro:intent") as Intent[]).map((s) => s.intent.iid);
    const withMine = board({ cards: ids.map((id) => card(id)) });
    act(() => ch.deliver("retro:state", snap(HOST.id, withMine, { hide: true, seq: 2 })));
    for (const id of ids) {
      act(() => {
        result.current.deleteCard(id);
      });
    }
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ cards: [] }), { hide: true, seq: 3 }))
    );
    let res = "";
    act(() => {
      res = result.current.addCard("start", "One more");
    });
    expect(res).toBe("member-cap");

    // The host clears a board with others' cards on it: the allowance starts again.
    act(() => ch.deliver("retro:state", snap(HOST.id, board(), { hide: true, seq: 4 })));
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ cards: [] }), { hide: true, seq: 5 }))
    );
    act(() => {
      res = result.current.addCard("start", "After the clear");
    });
    expect(res).toBe("sent");
  });

  it("gets a vote back in memory when the host never took it back", () => {
    const voted = board({
      phase: "vote",
      cards: [card("c1", { votes: 1 }), card("c2", { columnKey: "stop" })],
    });
    const { result, ch } = joined(snap(HOST.id, board({ phase: "vote" })));
    act(() => {
      result.current.vote("c1");
    });
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, voted, { seq: 2, votesUsed: { [ME.id]: 1 } }))
    );
    act(() => {
      result.current.unvote("c1");
    });
    expect(result.current.myVotes).toEqual({});
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    // The host still counts it: the request never reached it.
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, voted, { seq: 3, votesUsed: { [ME.id]: 1 } }))
    );
    expect(result.current.myVotes).toEqual({ c1: 1 });
    expect(result.current.votesLeft).toBe(2);
    // ...so it can be taken back again, with the same vote's key.
    let ok = false;
    act(() => {
      ok = result.current.unvote("c1");
    });
    expect(ok).toBe(true);
    const sent = ch.sent("retro:intent") as Intent[];
    expect(sent.at(-1)!.intent.key).toBe(sent.at(-2)!.intent.key);
  });

  it("starts again when the host clears the board", () => {
    const { result, ch } = joined(snap(HOST.id, board(), { hide: true }));
    act(() => {
      result.current.addCard("start", "Before the clear");
    });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() =>
      ch.deliver("retro:state", snap(HOST.id, board({ cards: [] }), { hide: true, seq: 2 }))
    );
    expect(result.current.shownCards).toEqual([]);
    expect(result.current.hiddenCounts).toEqual({ start: 0, stop: 0, continue: 0 });
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

  it("applies admitted members' intents to its board and shares a count while cards are hidden", () => {
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
    // The cards keep their request's id: the sender's handle on them.
    expect(result.current.board.cards.map((c) => c.id)).toEqual(["c1", "c2", "i1", "i2"]);
    act(() => vi.advanceTimersByTime(1));
    expect(states().length).toBe(before + 1);
    const latest = states().at(-1)!;
    expect(latest.by).toBe(HOST.id);
    expect(latest.hostId).toBe(HOST.id);
    expect(latest.members.map((m) => m.id)).toEqual([HOST.id, ME.id]);
    // "Hide cards while writing" is on by default: counts, no text, no author.
    expect(latest.hideWhileWriting).toBe(true);
    expect(latest.cards).toEqual([]);
    expect(latest.counts).toEqual({ start: 3, stop: 1, continue: 0 });
    const json = JSON.stringify(latest);
    for (const secret of ["One", "Two", "Card c1"]) expect(json).not.toContain(secret);
    // The host's own screen hides the others' cards too.
    expect(Array.from(result.current.room.hiddenIds ?? []).sort()).toEqual(["i1", "i2"]);
    expect(result.current.room.shownCards?.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(result.current.room.hiddenCounts).toEqual({ start: 2 });

    // The phase changes: every card's text goes out, and nothing is hidden.
    act(() => result.current.setBoard((b) => ({ ...b, phase: "vote" })));
    act(() => vi.advanceTimersByTime(600));
    const revealed = states().at(-1)!;
    expect(revealed.cards.map((c) => c.text)).toEqual(["Card c1", "Card c2", "One", "Two"]);
    expect(JSON.stringify(revealed.cards)).not.toContain(ME.id);
    expect(result.current.room.hiddenIds).toBeNull();
    expect(result.current.room.hiddenCounts).toBeNull();
  });

  it("shares the cards while people write once the host switches hiding off", () => {
    const { result } = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => ch.deliver("retro:intent", addIntent(ME.id, "Seen by all", "s1")));
    act(() => vi.advanceTimersByTime(1_000));
    expect(states().at(-1)!.cards).toEqual([]);

    act(() => result.current.room.setHideWhileWriting(false));
    expect(result.current.room.hideWhileWriting).toBe(false);
    act(() => vi.advanceTimersByTime(600));
    const latest = states().at(-1)!;
    expect(latest.hideWhileWriting).toBe(false);
    expect(latest.cards.map((c) => c.text)).toContain("Seen by all");
    expect(latest.counts).toEqual({});
    expect(result.current.room.hiddenIds).toBeNull();
  });

  it("deletes a card only for the member who added it, in Write", () => {
    const { result } = host();
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => {
      ch.deliver("retro:intent", addIntent(ME.id, "Mine", "m1"));
      ch.deliver("retro:intent", addIntent(OTHER.id, "Olu's", "o1"));
    });
    act(() => {
      ch.deliver("retro:intent", intent(OTHER.id, "card:delete", "m1", "d1")); // not Olu's
      ch.deliver("retro:intent", intent(ME.id, "card:delete", "c1", "d2")); // the host's own
      // Olu saw Pat's add go by and claims to be Pat, but doesn't hold Pat's key.
      ch.deliver("retro:intent", {
        v: 2,
        by: ME.id,
        intent: { t: "card:delete", iid: "d4", cardId: "m1", key: "olu_guessed_key_000" },
      });
    });
    expect(result.current.board.cards.map((c) => c.id)).toEqual(["c1", "c2", "m1", "o1"]);
    act(() => ch.deliver("retro:intent", intent(ME.id, "card:delete", "m1", "d3")));
    expect(result.current.board.cards.map((c) => c.id)).toEqual(["c1", "c2", "o1"]);
    expect(Array.from(result.current.room.hiddenIds ?? [])).toEqual(["o1"]);
    // Its id can't come back as a new card.
    act(() => ch.deliver("retro:intent", addIntent(OTHER.id, "Taking its id", "m1")));
    expect(result.current.board.cards.map((c) => c.id)).toEqual(["c1", "c2", "o1"]);
  });

  it("gives a member's card allowance back on the host's clear, not when its own deletes empty the board", () => {
    const { result } = host(board({ cards: [] }));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    // The per-sender limit lets a burst of 20 through, then 4 a second.
    const deliver = (envs: unknown[]) => {
      for (let i = 0; i < envs.length; i += 10) {
        act(() => {
          for (const env of envs.slice(i, i + 10)) ch.deliver("retro:intent", env);
        });
        act(() => vi.advanceTimersByTime(3_000));
      }
    };
    const ids = Array.from({ length: MEMBER_CARD_CAP }, (_, i) => `a${i}`);
    deliver(ids.map((id) => addIntent(ME.id, `Card ${id}`, id)));
    expect(result.current.board.cards).toHaveLength(MEMBER_CARD_CAP);
    deliver(ids.map((id, i) => intent(ME.id, "card:delete", id, `d${i}`)));
    expect(result.current.board.cards).toEqual([]);
    // Deleting its own cards gave nothing back.
    deliver([addIntent(ME.id, "One more", "more1")]);
    expect(result.current.board.cards).toEqual([]);

    // The host's own Clear Board does.
    act(() => result.current.setBoard((b) => ({ ...b, cards: [card("h1")] })));
    act(() => result.current.setBoard((b) => ({ ...b, cards: [] })));
    deliver([addIntent(ME.id, "After the clear", "more2")]);
    expect(result.current.board.cards.map((c) => c.text)).toEqual(["After the clear"]);
  });

  it("takes a vote back only for the member who cast it", () => {
    const { result } = host(board({ phase: "vote" }));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => {
      ch.deliver("retro:intent", intent(ME.id, "vote", "c1", "v1"));
      ch.deliver("retro:intent", intent(ME.id, "vote", "c1", "v2"));
      ch.deliver("retro:intent", intent(OTHER.id, "vote:undo", "c1", "u1")); // Olu never voted
      // Olu, in Pat's name, replaying the lock Pat's vote carried.
      ch.deliver("retro:intent", {
        v: 2,
        by: ME.id,
        intent: { t: "vote:undo", iid: "u3", cardId: "c1", key: lockOf(voteKey(ME.id, "c1")) },
      });
    });
    expect(result.current.board.cards[0].votes).toBe(2);
    act(() => ch.deliver("retro:intent", intent(ME.id, "vote:undo", "c1", "u2")));
    expect(result.current.board.cards[0].votes).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    const latest = states().at(-1)!;
    expect(latest.votesUsed).toEqual({ [ME.id]: 1 });
    // Who voted where never travels.
    expect(JSON.stringify(latest.cards)).not.toContain(ME.id);
  });

  it("gives everyone the board's Votes each, and sends a new budget at once", () => {
    const { result } = host(board({ phase: "vote", votesPerPerson: 5 }));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => vi.advanceTimersByTime(1_000));
    expect(states().at(-1)!.votesPerPerson).toBe(5);
    expect(result.current.room.votesPerPerson).toBe(5);

    act(() => {
      for (let i = 1; i <= 6; i++) ch.deliver("retro:intent", intent(ME.id, "vote", "c1", `v${i}`));
    });
    // Five land; the sixth is past the budget.
    expect(result.current.board.cards[0].votes).toBe(5);

    const before = states().length;
    act(() => result.current.setBoard((b) => ({ ...b, votesPerPerson: 8 })));
    act(() => vi.advanceTimersByTime(600));
    expect(states().length).toBeGreaterThan(before);
    expect(states().at(-1)!).toMatchObject({ votesPerPerson: 8, votesUsed: { [ME.id]: 5 } });
    act(() => ch.deliver("retro:intent", intent(ME.id, "vote", "c1", "v7")));
    expect(result.current.board.cards[0].votes).toBe(6);
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

  it("warns while cards are hidden when the board will be too big to share at Vote, and still shares the counts", () => {
    vi.mocked(toast.error).mockClear();
    const long = "w".repeat(VISITOR_LIMITS.maxTextChars);
    const big = board({
      cards: Array.from({ length: 190 }, (_, i) => card(`h${i}`, { text: long })),
    });
    const { result } = host(big);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    act(() => vi.advanceTimersByTime(1_000));
    // Told now, while there is time to shorten cards, not when Vote is refused.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(BOARD_TOO_BIG_TO_REVEAL);
    // The counts still go out, so everyone stays in step meanwhile.
    expect(states().at(-1)!.counts.start).toBe(190);

    act(() => result.current.setBoard((b) => ({ ...b, cards: b.cards.slice(0, 50) })));
    act(() => vi.advanceTimersByTime(600));
    act(() => result.current.setBoard((b) => ({ ...b, phase: "vote" })));
    act(() => vi.advanceTimersByTime(600));
    expect(states().at(-1)!.cards).toHaveLength(50);
    expect(toast.error).toHaveBeenCalledTimes(1);
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

  it("a new host from a revealed board keeps its own votes, and knows nobody else's", () => {
    const voted = board({
      phase: "vote",
      cards: [card("c1", { votes: 1 }), card("c2", { columnKey: "stop", votes: 1 })],
    });
    const view = participant(ME);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id, board({ phase: "vote" }))));
    act(() => {
      view.result.current.vote("c1");
    });
    act(() =>
      ch.deliver(
        "retro:state",
        snap(HOST.id, voted, { seq: 2, votesUsed: { [ME.id]: 1, [OTHER.id]: 1 } })
      )
    );
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(view.result.current.promoted).toBe(true);
    expect(view.result.current.myVotes).toEqual({ c1: 1 });

    // Olu's vote from before is the old host's secret: it can't be taken back now.
    act(() => ch.deliver("retro:intent", intent(OTHER.id, "vote:undo", "c2", "late1")));
    expect(view.result.current.board?.cards.map((c) => c.votes)).toEqual([1, 1]);
    let ok = false;
    act(() => {
      ok = view.result.current.unvote("c1");
    });
    expect(ok).toBe(true);
    expect(view.result.current.board?.cards.map((c) => c.votes)).toEqual([0, 1]);
    expect(view.result.current.votesLeft).toBe(3);
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

describe("useRetroRoom: the host leaves while cards are hidden", () => {
  function hiddenRoom(identity: FakeMember, first: BoardState = board()) {
    const view = participant(identity);
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME, OTHER]);
    });
    act(() => ch.deliver("retro:state", snap(HOST.id, first, { hide: true, seq: 7 })));
    return { ...view, ch };
  }

  it("says nothing was lost when nobody had written a card", () => {
    const empty = board({ cards: [] });
    // The member who takes over...
    const elected = hiddenRoom(ME, empty);
    act(() => elected.ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(elected.result.current.promoted).toBe(true);
    expect(elected.result.current.cardsLost).toBe(false);
    elected.unmount();

    // ...and everyone else.
    fakeRealtime.reset();
    const other = hiddenRoom(OTHER, empty);
    act(() => other.ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    act(() => other.ch.deliver("retro:state", snap(ME.id, empty, { hide: true, seq: 8 })));
    expect(other.result.current.hostId).toBe(ME.id);
    expect(other.result.current.cardsLost).toBe(false);
    expect(other.result.current.unsharedCards).toEqual([]);
  });

  it("the new host says nothing was lost when the only hidden cards were its own", () => {
    const { result, ch } = hiddenRoom(ME, board({ cards: [] }));
    act(() => {
      result.current.addCard("start", "Only mine");
    });
    const mine = (ch.sent("retro:intent") as Intent[])[0].intent.iid;
    const onlyMine = board({ cards: [card(mine, { text: "Only mine" })] });
    act(() => ch.deliver("retro:state", snap(HOST.id, onlyMine, { hide: true, seq: 8 })));
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.promoted).toBe(true);
    expect(result.current.cardsLost).toBe(false);
    expect(result.current.board?.cards.map((c) => c.text)).toEqual(["Only mine"]);
  });

  it("the new host stays in Write and starts again from its own cards", () => {
    const { result, ch } = hiddenRoom(ME);
    act(() => {
      result.current.addCard("stop", "Kept by me");
    });
    const mine = (ch.sent("retro:intent") as Intent[])[0].intent.iid;
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.promoted).toBe(true);
    expect(result.current.cardsLost).toBe(true);
    expect(result.current.board?.phase).toBe("write");
    // The old host's cards (c1, c2) were never shared: they're gone.
    expect(result.current.board?.cards.map((c) => [c.id, c.text])).toEqual([[mine, "Kept by me"]]);
    expect(result.current.ownIds.has(mine)).toBe(true);
    expect(result.current.hideWhileWriting).toBe(true);

    act(() => vi.advanceTimersByTime(600));
    expect(states().at(-1)!).toMatchObject({
      by: ME.id,
      phase: "write",
      hideWhileWriting: true,
      cards: [],
      counts: { start: 0, stop: 1, continue: 0 },
    });

    // Olu adds again; the new host's screen hides it like everyone's.
    act(() => ch.deliver("retro:intent", addIntent(OTHER.id, "Again", "o2")));
    expect(result.current.shownCards?.map((c) => c.id)).toEqual([mine]);
    expect(result.current.hiddenCounts).toEqual({ start: 1 });

    let ok = false;
    act(() => {
      ok = result.current.deleteCard(mine);
    });
    expect(ok).toBe(true);
    expect(result.current.board?.cards.map((c) => c.id)).toEqual(["o2"]);

    // Moving on to Vote ends the notice.
    act(() => result.current.setPhase("vote"));
    expect(result.current.cardsLost).toBe(false);
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
  });

  it("everyone else is told to add theirs again, and can", () => {
    const { result, ch } = hiddenRoom(OTHER);
    act(() => {
      result.current.addCard("start", "Olu's idea");
    });
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.hostId).toBe(ME.id);
    const fresh = board({ cards: [card("p1", { columnKey: "stop" })] });
    act(() => ch.deliver("retro:state", snap(ME.id, fresh, { hide: true, seq: 8 })));
    expect(result.current.cardsLost).toBe(true);
    expect(result.current.shownCards).toEqual([]);
    expect(result.current.ownIds.size).toBe(0);
    expect(result.current.unsharedCards.map((c) => c.text)).toEqual(["Olu's idea"]);

    const before = ch.sent("retro:intent").length;
    let res = "";
    act(() => {
      res = result.current.addAgain(result.current.unsharedCards[0].id);
    });
    expect(res).toBe("sent");
    expect(ch.sent("retro:intent")).toHaveLength(before + 1);
    expect(result.current.unsharedCards).toEqual([]);
    expect(result.current.shownCards?.map((c) => c.text)).toEqual(["Olu's idea"]);

    act(() =>
      ch.deliver("retro:state", snap(ME.id, board({ phase: "vote" }), { hide: true, seq: 9 }))
    );
    expect(result.current.cardsLost).toBe(false);
  });
});
