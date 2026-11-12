import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import {
  MAX_POLL_TOPIC_CHARS,
  RETRO_ROOM_PROTOCOL_VERSION,
  RETRO_ROOM_REVISION,
  lockOf,
  readIntentEnv,
  type IntentEnv,
  type RoomSnapshot,
} from "@/app/(tools)/retro/room/protocol";
import { applyIntent, createIntentLedger } from "@/app/(tools)/retro/room/intents";
import {
  applyThumb,
  closeThumbPoll,
  openThumbPoll,
  readRoomPoll,
  thumbTally,
  toRoomPoll,
  withoutVoters,
  type ThumbPoll,
} from "@/app/(tools)/retro/room/thumbs";
import {
  readRoomSnapshot,
  toRoomSnapshot,
  type SnapshotMeta,
} from "@/app/(tools)/retro/room/snapshot";
import { DEFAULT_RETRO_VOTES } from "@/lib/retro/board";
import type { BoardState } from "@/app/(tools)/retro/types";

/**
 * Revision 2 of the retro room's version 2: the Lean Coffee thumbs vote.
 * A thumb is a well-formed intent or nothing; only the voter's key changes
 * their thumb; the snapshot says how many voted while the vote is open and
 * the totals once it's closed, never who; and a snapshot without a poll
 * (a host on the earlier build) or with one this build can't read still
 * reads as a room.
 */

const V = RETRO_ROOM_PROTOCOL_VERSION;
const HOST = "host_00000000000";
const PAT = "pat_000000000000";
const SAM = "sam_000000000000";
const MALLORY = "mallory_00000000";
const KEY_PAT = "patkey_0000000000000";
const KEY_PAT_2 = "patkey_1111111111111";
const KEY_SAM = "samkey_0000000000000";
const NOW = Date.parse("2026-11-12T10:00:00Z");

const env = (by: string, intent: Record<string, unknown>): unknown => ({ v: V, by, intent });
const thumbEnv = (
  by: string,
  pollId: string,
  choice: "keep" | "move",
  key: string,
  previousKey?: string
): IntentEnv =>
  readIntentEnv(
    env(by, {
      t: "thumb",
      iid: `i_${by.slice(0, 4)}_${choice}`,
      pollId,
      choice,
      lock: lockOf(key),
      ...(previousKey ? { key: previousKey } : {}),
    })
  )!;

const seats = { admitted: new Set([PAT, SAM]), removed: new Set<string>() };

function vote(poll: ThumbPoll, e: IntentEnv, ctx = seats): ThumbPoll {
  const r = applyThumb(poll, e, ctx);
  if (!r.ok) throw new Error(r.reason);
  return r.poll;
}

describe("a thumb on the wire", () => {
  it("is read when well formed, a change carrying the key it replaces", () => {
    const first = thumbEnv(PAT, "poll_1", "keep", KEY_PAT);
    expect(first.intent).toEqual({
      t: "thumb",
      iid: "i_pat__keep",
      pollId: "poll_1",
      choice: "keep",
      lock: lockOf(KEY_PAT),
    });
    const change = thumbEnv(PAT, "poll_1", "move", KEY_PAT_2, KEY_PAT);
    expect(change.intent).toMatchObject({ choice: "move", key: KEY_PAT });
  });

  it.each([
    ["a choice that isn't a thumb", { choice: "maybe" }],
    ["a poll id that isn't an id", { pollId: "__proto__" }],
    ["a missing poll id", { pollId: undefined }],
    ["a lock that isn't a lock", { lock: "short" }],
    ["a key that isn't a key", { key: "x" }],
  ])("is refused with %s", (_name, patch) => {
    const intent = {
      t: "thumb",
      iid: "i_1",
      pollId: "poll_1",
      choice: "keep",
      lock: lockOf(KEY_PAT),
      ...patch,
    };
    expect(readIntentEnv(env(PAT, intent))).toBeNull();
  });

  it("never changes the board through the card reducer", () => {
    const board: BoardState = {
      format: retroFormats[0],
      phase: "discuss",
      cards: [],
      userVotes: 0,
      timerSeconds: 0,
      timerRunning: false,
      discussingIndex: 0,
    };
    const res = applyIntent(
      board,
      createIntentLedger(),
      env(PAT, { t: "thumb", iid: "i_1", pollId: "poll_1", choice: "keep", lock: lockOf(KEY_PAT) }),
      { admitted: new Set([PAT]), removed: new Set(), votesPerPerson: DEFAULT_RETRO_VOTES }
    );
    expect(res).toEqual({ ok: false, reason: "not-board" });
  });

  it("speaks revision 2 of version 2", () => {
    expect(V).toBe(2);
    expect(RETRO_ROOM_REVISION).toBe(2);
  });
});

describe("the host's thumbs vote", () => {
  const open = () => openThumbPoll("poll_1", "Our standups run too long");

  it("opens on a clean topic, with nobody's thumb yet", () => {
    expect(open()).toEqual({
      id: "poll_1",
      topic: "Our standups run too long",
      open: true,
      votes: {},
    });
    expect(openThumbPoll("poll_2", "  ").topic).toBe("This topic");
    expect(openThumbPoll("poll_3", "x".repeat(900)).topic.length).toBeLessThanOrEqual(
      MAX_POLL_TOPIC_CHARS
    );
  });

  it("counts one thumb a member, and lets the voter change theirs with the key", () => {
    let poll = vote(open(), thumbEnv(PAT, "poll_1", "keep", KEY_PAT));
    poll = vote(poll, thumbEnv(SAM, "poll_1", "move", KEY_SAM));
    expect(thumbTally(poll)).toEqual({ keep: 1, move: 1, voters: 2 });
    poll = vote(poll, thumbEnv(PAT, "poll_1", "move", KEY_PAT_2, KEY_PAT));
    expect(thumbTally(poll)).toEqual({ keep: 0, move: 2, voters: 2 });
    // The new lock is the one a further change needs.
    expect(applyThumb(poll, thumbEnv(PAT, "poll_1", "keep", KEY_PAT, KEY_PAT), seats)).toEqual({
      ok: false,
      reason: "not-yours",
    });
  });

  it("refuses a change without the voter's key, so nobody changes another's thumb", () => {
    const poll = vote(open(), thumbEnv(PAT, "poll_1", "keep", KEY_PAT));
    expect(applyThumb(poll, thumbEnv(PAT, "poll_1", "move", "mallorykey_00000000"), seats)).toEqual(
      { ok: false, reason: "not-yours" }
    );
    expect(
      applyThumb(poll, thumbEnv(PAT, "poll_1", "move", KEY_PAT_2, "mallorykey_00000000"), seats)
    ).toEqual({ ok: false, reason: "not-yours" });
    expect(thumbTally(poll)).toEqual({ keep: 1, move: 0, voters: 1 });
  });

  it("refuses thumbs on no vote, another vote, a closed vote, or from outside the room", () => {
    const e = thumbEnv(PAT, "poll_1", "keep", KEY_PAT);
    expect(applyThumb(null, e, seats)).toEqual({ ok: false, reason: "no-poll" });
    expect(applyThumb(openThumbPoll("poll_9", "Other"), e, seats)).toEqual({
      ok: false,
      reason: "no-poll",
    });
    expect(applyThumb(closeThumbPoll(open()), e, seats)).toEqual({ ok: false, reason: "closed" });
    expect(applyThumb(open(), thumbEnv(MALLORY, "poll_1", "move", KEY_SAM), seats)).toEqual({
      ok: false,
      reason: "not-admitted",
    });
    expect(applyThumb(open(), e, { admitted: seats.admitted, removed: new Set([PAT]) })).toEqual({
      ok: false,
      reason: "removed",
    });
  });

  it("lets a promoted host change its own thumb without a key", () => {
    const local = { ...seats, admitted: new Set([PAT, HOST]), local: true };
    let poll = vote(open(), thumbEnv(HOST, "poll_1", "keep", KEY_PAT), local);
    poll = vote(poll, thumbEnv(HOST, "poll_1", "move", KEY_SAM), local);
    expect(thumbTally(poll)).toEqual({ keep: 0, move: 1, voters: 1 });
  });

  it("never mutates the poll it was given", () => {
    const before = open();
    const frozen = JSON.stringify(before);
    vote(before, thumbEnv(PAT, "poll_1", "keep", KEY_PAT));
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("keeps a member id like __proto__ as data", () => {
    const proto = "__proto__";
    const poll: ThumbPoll = {
      ...open(),
      votes: Object.fromEntries([[proto, { choice: "keep", lock: lockOf(KEY_PAT) }]]),
    };
    expect(thumbTally(poll).voters).toBe(1);
    expect(Object.getPrototypeOf(poll.votes)).toBe(Object.prototype);
  });

  it("drops the thumbs of members who left", () => {
    let poll = vote(open(), thumbEnv(PAT, "poll_1", "keep", KEY_PAT));
    poll = vote(poll, thumbEnv(SAM, "poll_1", "move", KEY_SAM));
    const after = withoutVoters(poll, (id) => id === SAM);
    expect(thumbTally(after)).toEqual({ keep: 1, move: 0, voters: 1 });
    // Nobody left: the same poll, so nothing re-renders or re-sends.
    expect(withoutVoters(after, () => false)).toBe(after);
  });
});

describe("the poll as the room shares it", () => {
  const voted = () => {
    let poll = openThumbPoll("poll_1", "Standups");
    poll = vote(poll, thumbEnv(PAT, "poll_1", "keep", KEY_PAT));
    return vote(poll, thumbEnv(SAM, "poll_1", "keep", KEY_SAM));
  };

  it("says only how many voted while open, and the totals once closed, never who", () => {
    expect(toRoomPoll(voted())).toEqual({ id: "poll_1", topic: "Standups", open: true, voters: 2 });
    const closed = toRoomPoll(closeThumbPoll(voted()));
    expect(closed).toEqual({
      id: "poll_1",
      topic: "Standups",
      open: false,
      voters: 2,
      keep: 2,
      move: 0,
    });
    const json = JSON.stringify(closed);
    for (const secret of [PAT, SAM, lockOf(KEY_PAT)]) expect(json).not.toContain(secret);
  });

  it("is read back field by field", () => {
    const open = toRoomPoll(voted());
    const closed = toRoomPoll(closeThumbPoll(voted()));
    expect(readRoomPoll(JSON.parse(JSON.stringify(open)))).toEqual(open);
    expect(readRoomPoll({ ...closed, extra: "ignored" })).toEqual(closed);
  });

  it.each([
    ["totals on an open vote", { open: true, voters: 1, keep: 1, move: 0 }],
    ["totals that don't add up", { open: false, voters: 3, keep: 1, move: 1 }],
    ["a closed vote without totals", { open: false, voters: 0 }],
    ["more voters than a room holds", { open: true, voters: VISITOR_LIMITS.maxMembers + 1 }],
    ["a fractional count", { open: true, voters: 1.5 }],
    ["a bad id", { id: "not an id!", open: true, voters: 0 }],
    ["hidden characters in the topic", { topic: "Stand‮ups", open: true, voters: 0 }],
    ["an empty topic", { topic: "", open: true, voters: 0 }],
  ])("is refused with %s", (_name, patch) => {
    expect(readRoomPoll({ id: "poll_1", topic: "Standups", ...patch })).toBeNull();
  });
});

describe("the snapshot's poll", () => {
  const board: BoardState = {
    format: retroFormats.find((f) => f.id === "lean-coffee") ?? retroFormats[0],
    phase: "discuss",
    cards: [],
    userVotes: 0,
    timerSeconds: 0,
    timerRunning: false,
    discussingIndex: 0,
  };
  const meta = (over: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
    by: HOST,
    seq: 1,
    endsAt: NOW + VISITOR_LIMITS.hardTtlMs,
    members: [
      { id: HOST, name: "Hana" },
      { id: PAT, name: "Pat" },
    ],
    votesUsed: {},
    timer: { running: false, remaining: 0 },
    now: NOW,
    hideWhileWriting: false,
    votesPerPerson: DEFAULT_RETRO_VOTES,
    ...over,
  });
  const wire = (snap: RoomSnapshot) => JSON.parse(JSON.stringify(snap)) as Record<string, unknown>;

  it("rides on the snapshot while a vote runs, and round-trips", () => {
    const poll = toRoomPoll(openThumbPoll("poll_1", "Standups"));
    const snap = toRoomSnapshot(board, meta({ poll }));
    expect(snap.poll).toEqual(poll);
    expect(readRoomSnapshot(wire(snap))?.poll).toEqual(poll);
  });

  it("is absent with no vote, as from a host on the earlier build", () => {
    const snap = toRoomSnapshot(board, meta({ poll: null }));
    expect("poll" in snap).toBe(false);
    const read = readRoomSnapshot(wire(snap));
    expect(read).not.toBeNull();
    expect(read?.poll).toBeUndefined();
  });

  it("is dropped when this build can't read it, and the room still reads", () => {
    const snap = wire(toRoomSnapshot(board, meta()));
    const read = readRoomSnapshot({ ...snap, poll: { id: "poll_1", kind: "stars", open: 7 } });
    expect(read).not.toBeNull();
    expect(read?.poll).toBeUndefined();
  });
});
