import { describe, expect, it } from "vitest";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import {
  FALLBACK_FORMAT_ID,
  boardFromSnapshot,
  readRoomSnapshot,
  resolveRoomFormat,
  roomSignature,
  toRoomSnapshot,
  type SnapshotMeta,
} from "@/app/(tools)/retro/room/snapshot";
import {
  BOARD_CARD_CAP,
  MAX_VOTES_PER_PERSON,
  cardsHidden,
  otherVersionSender,
  type RoomSnapshot,
} from "@/app/(tools)/retro/room/protocol";
import { MAX_VOTES, type BoardState, type RetroCard } from "@/app/(tools)/retro/types";

/**
 * What the host shares (nothing private, no card while cards are hidden)
 * and what a participant accepts (strict shape, caps, no hidden characters,
 * local formats only).
 */

const HOST = "host_00000000000";
const PAT = "pat_000000000000";
const GONE = "gone_00000000000";
const NOW = Date.parse("2026-10-19T10:00:00Z");

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

function hostBoard(overrides: Partial<BoardState> = {}): BoardState {
  return {
    format: retroFormats[0],
    phase: "actions",
    cards: [
      card("c1", {
        votes: 4,
        isActionItem: true,
        assignee: "Sam",
        sentTo: [{ route: "impediment", targetId: "imp-secret-123", at: "2026-10-01T09:00:00Z" }],
        carriedFrom: "retro:2026-09-01T00:00:00.000Z:old-card",
      }),
      card("c2", { columnKey: "stop", groupedWith: null }),
    ],
    userVotes: 2,
    timerSeconds: 120,
    timerRunning: false,
    discussingIndex: 0,
    previousRetroId: "retro:2026-09-01T00:00:00.000Z",
    votesBy: { "Private Person": 3 },
    ...overrides,
  };
}

function meta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    by: HOST,
    seq: 1,
    endsAt: NOW + VISITOR_LIMITS.hardTtlMs,
    members: [
      { id: HOST, name: "Hana" },
      { id: PAT, name: "Pat" },
    ],
    votesUsed: { [PAT]: 2, [GONE]: 3 },
    timer: { running: false, remaining: 120 },
    now: NOW,
    hideWhileWriting: true,
    votesPerPerson: MAX_VOTES,
    ...overrides,
  };
}

/** A snapshot as it would arrive over the wire. */
function wire(snap: RoomSnapshot): unknown {
  return JSON.parse(JSON.stringify(snap));
}

describe("toRoomSnapshot", () => {
  it("strips every private field", () => {
    const snap = toRoomSnapshot(hostBoard(), meta());
    const json = JSON.stringify(snap);
    for (const secret of [
      "sentTo",
      "imp-secret-123",
      "2026-10-01T09:00:00Z",
      "carriedFrom",
      "old-card",
      "votesBy",
      "Private Person",
      "userVotes",
      "previousRetroId",
      "retro:2026-09-01",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(snap.cards[0]).sort()).toEqual(
      [
        "assignee",
        "columnKey",
        "discussing",
        "groupedWith",
        "id",
        "isActionItem",
        "text",
        "votes",
      ].sort()
    );
    expect(snap.formatId).toBe(retroFormats[0].id);
    // The columns travel as keys and labels: no colours or icons.
    expect(snap.columns).toEqual([
      { key: "start", label: "Start" },
      { key: "stop", label: "Stop" },
      { key: "continue", label: "Continue" },
    ]);
    expect(json).not.toContain(retroFormats[0].columns[0].color);
    expect(json).not.toContain(retroFormats[0].columns[0].icon);
    expect(snap.votesPerPerson).toBe(MAX_VOTES);
  });

  it("shares votes only for members still in the room", () => {
    const snap = toRoomSnapshot(hostBoard(), meta());
    expect(snap.votesUsed).toEqual({ [PAT]: 2 });
  });

  it("cleans the host's own text so participants accept it", () => {
    const snap = toRoomSnapshot(
      hostBoard({
        cards: [
          card("a", { text: "Ship ‮daolnwod‬ it\nnow" }),
          card("b", { text: "z".repeat(800) }),
          card("c", { text: "‏" }), // nothing left once cleaned: not shared
        ],
      }),
      meta()
    );
    expect(snap.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(snap.cards[0].text).toBe("Ship daolnwod it now");
    expect(snap.cards[1].text).toHaveLength(VISITOR_LIMITS.maxTextChars);
    expect(readRoomSnapshot(wire(snap))).not.toBeNull();
  });

  it("sends a count per column and the cards' ids instead of the cards while people write", () => {
    const b = hostBoard({
      phase: "write",
      cards: [
        card("w3", { columnKey: "continue", text: "Secret three" }),
        card("w1", { text: "Secret one" }),
        card("w2", { text: "Secret two", groupedWith: "w1" }),
      ],
    });
    const snap = toRoomSnapshot(b, meta());
    expect(cardsHidden(snap)).toBe(true);
    expect(snap.cards).toEqual([]);
    expect(snap.counts).toEqual({ start: 2, stop: 0, continue: 1 });
    // The ids, sorted, so each tab can tell whether its own card landed: no text, column or order.
    expect(snap.ids).toEqual(["w1", "w2", "w3"]);
    const json = JSON.stringify(snap);
    for (const text of ["Secret", "groupedWith"]) expect(json).not.toContain(text);
    expect(readRoomSnapshot(wire(snap))).toEqual(snap);

    // The phase changes: every card's text goes out, and the id list goes.
    const revealed = toRoomSnapshot({ ...b, phase: "vote" }, meta());
    expect(revealed.cards.map((c) => c.text)).toEqual(["Secret three", "Secret one", "Secret two"]);
    expect(revealed.counts).toEqual({});
    expect(revealed.ids).toEqual([]);
  });

  it("neither counts nor lists a hidden card in a column the room doesn't share", () => {
    const b = hostBoard({
      phase: "write",
      cards: [card("in1"), card("stray", { columnKey: "not shared" })],
    });
    const snap = toRoomSnapshot(b, meta());
    expect(snap.counts).toEqual({ start: 1, stop: 0, continue: 0 });
    expect(snap.ids).toEqual(["in1"]);
    expect(readRoomSnapshot(wire(snap))).toEqual(snap);
  });

  it("shares the cards in Write when the host switched hiding off", () => {
    const snap = toRoomSnapshot(hostBoard({ phase: "write" }), meta({ hideWhileWriting: false }));
    expect(cardsHidden(snap)).toBe(false);
    expect(snap.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(snap.counts).toEqual({});
    expect(snap.ids).toEqual([]);
  });

  it("keeps the votes per person within what a room allows", () => {
    expect(toRoomSnapshot(hostBoard(), meta({ votesPerPerson: 0 })).votesPerPerson).toBe(1);
    expect(toRoomSnapshot(hostBoard(), meta({ votesPerPerson: 99 })).votesPerPerson).toBe(
      MAX_VOTES_PER_PERSON
    );
    const one = toRoomSnapshot(hostBoard(), meta({ votesPerPerson: 1 }));
    expect(one.votesUsed).toEqual({ [PAT]: 1 });
  });
});

describe("readRoomSnapshot", () => {
  it("accepts what the host sends, field for field", () => {
    const snap = toRoomSnapshot(hostBoard(), meta());
    const read = readRoomSnapshot(wire(snap));
    expect(read).toEqual(snap);
  });

  it("rejects a payload over the size cap", () => {
    // 200 cards of 500 characters is about 130k characters of JSON.
    const big = toRoomSnapshot(
      hostBoard({
        cards: Array.from({ length: BOARD_CARD_CAP }, (_, i) =>
          card(`c${i}`, { text: "w".repeat(VISITOR_LIMITS.maxTextChars) })
        ),
      }),
      meta()
    );
    expect(JSON.stringify(big).length).toBeGreaterThan(VISITOR_LIMITS.maxPayloadChars);
    expect(readRoomSnapshot(wire(big))).toBeNull();
  });

  it("rejects more cards, columns or members than a room can hold", () => {
    const snap = wire(toRoomSnapshot(hostBoard(), meta())) as Record<string, unknown>;
    const tooManyCards = {
      ...snap,
      cards: Array.from({ length: BOARD_CARD_CAP + 1 }, (_, i) => card(`k${i}`, { text: "x" })),
    };
    expect(readRoomSnapshot(tooManyCards)).toBeNull();
    const tooManyMembers = {
      ...snap,
      members: Array.from({ length: VISITOR_LIMITS.maxMembers + 1 }, (_, i) => ({
        id: `member_${String(i).padStart(9, "0")}`,
        name: `M${i}`,
      })),
    };
    expect(readRoomSnapshot(tooManyMembers)).toBeNull();
    const tooManyColumns = {
      ...snap,
      columns: Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, label: `K${i}` })),
    };
    expect(readRoomSnapshot(tooManyColumns)).toBeNull();
  });

  it("rejects hidden characters, impostors and malformed fields", () => {
    const good = wire(toRoomSnapshot(hostBoard(), meta())) as RoomSnapshot;
    const variants: unknown[] = [
      { ...good, v: 1 }, // a version 1 host
      { ...good, v: 3 },
      { ...good, hostId: PAT }, // the sender isn't the host it names
      { ...good, by: "not-a-member-id" },
      { ...good, phase: "party" },
      { ...good, seq: -1 },
      { ...good, endsAt: Number.NaN },
      { ...good, timer: { running: "yes", remaining: 1, at: NOW } },
      { ...good, timer: { running: true, remaining: 10 ** 9, at: NOW } },
      { ...good, cards: [{ ...good.cards[0], text: "evil ‮ txet" }] },
      { ...good, cards: [{ ...good.cards[0], text: "line\u0000break" }] },
      { ...good, cards: [{ ...good.cards[0], columnKey: "st⁦art" }] },
      { ...good, cards: [{ ...good.cards[0], assignee: "‮Sam" }] },
      { ...good, cards: [{ ...good.cards[0], votes: "many" }] },
      { ...good, cards: [good.cards[0], good.cards[0]] }, // duplicate id
      { ...good, members: [{ id: PAT, name: "Pat‏" }] },
      {
        ...good,
        members: [
          { id: PAT, name: "Pat" },
          { id: PAT, name: "Pat 2" },
        ],
      },
      { ...good, votesUsed: { [PAT]: 4 } },
      { ...good, votesUsed: { [PAT]: 2 }, votesPerPerson: 1 }, // more than the budget it states
      { ...good, votesUsed: { "not-an-id": 1 } },
      { ...good, formatId: "" },
      { ...good, formatId: "f".repeat(65) },
      { ...good, votesPerPerson: 0 },
      { ...good, votesPerPerson: MAX_VOTES_PER_PERSON + 1 },
      { ...good, votesPerPerson: 2.5 },
      { ...good, hideWhileWriting: "yes" },
      { ...good, columns: undefined },
      { ...good, columns: [{ key: "start", label: "St‮art" }] },
      { ...good, columns: [{ key: "start", label: "" }] },
      {
        ...good,
        columns: [
          { key: "start", label: "Start" },
          { key: "start", label: "Again" },
        ],
      },
      { ...good, counts: undefined },
      { ...good, ids: undefined },
      // Counts and ids only while cards are hidden, and cards only while they aren't.
      { ...good, counts: { start: 1 } },
      { ...good, ids: ["c1"] },
      { ...good, phase: "write" },
    ];
    for (const v of variants) expect(readRoomSnapshot(v)).toBeNull();
  });

  it("checks the counts while cards are hidden", () => {
    const hidden = wire(toRoomSnapshot(hostBoard({ phase: "write" }), meta())) as RoomSnapshot;
    expect(readRoomSnapshot(hidden)).not.toBeNull();
    const variants: unknown[] = [
      { ...hidden, counts: { liked: 1 } }, // not one of the columns
      { ...hidden, counts: { start: -1 } },
      { ...hidden, counts: { start: 1.5 } },
      { ...hidden, counts: { start: "2" } },
      { ...hidden, counts: { start: BOARD_CARD_CAP, stop: 1 } }, // more than a board holds
      { ...hidden, counts: [] },
    ];
    for (const v of variants) expect(readRoomSnapshot(v)).toBeNull();
  });

  it("checks the ids while cards are hidden", () => {
    const hidden = wire(toRoomSnapshot(hostBoard({ phase: "write" }), meta())) as RoomSnapshot;
    expect(hidden.ids).toEqual(["c1", "c2"]);
    const variants: unknown[] = [
      { ...hidden, ids: ["c1"] }, // fewer than the counts add up to
      { ...hidden, ids: ["c1", "c2", "c3"] }, // more
      { ...hidden, ids: ["c1", "c1"] }, // twice
      { ...hidden, ids: ["c1", "c‮2"] }, // a hidden character
      { ...hidden, ids: ["c1", ""] },
      { ...hidden, ids: ["c1", "x".repeat(65)] },
      { ...hidden, ids: ["c1", 2] },
      { ...hidden, ids: "c1,c2" },
    ];
    for (const v of variants) expect(readRoomSnapshot(v)).toBeNull();
  });

  it("names the sender of a message from another version, reading nothing else", () => {
    const v1 = { ...(wire(toRoomSnapshot(hostBoard(), meta())) as RoomSnapshot), v: 1 };
    expect(readRoomSnapshot(v1)).toBeNull();
    expect(otherVersionSender(v1)).toBe(HOST);
    expect(otherVersionSender({ v: 3, by: PAT })).toBe(PAT);
    expect(otherVersionSender(toRoomSnapshot(hostBoard(), meta()))).toBeNull();
    expect(otherVersionSender({ v: 1, by: "not-a-member" })).toBeNull();
    expect(otherVersionSender({ v: "1", by: HOST })).toBeNull();
    expect(otherVersionSender(null)).toBeNull();
  });

  it("keeps the card being discussed", () => {
    const snap = toRoomSnapshot(
      hostBoard({ phase: "discuss", cards: [card("d1", { discussing: true })] }),
      meta()
    );
    expect(readRoomSnapshot(wire(snap))?.cards[0].discussing).toBe(true);
  });
});

describe("boardFromSnapshot", () => {
  it("uses the participant's own copy of a known format", () => {
    const snap = readRoomSnapshot(wire(toRoomSnapshot(hostBoard(), meta())))!;
    const board = boardFromSnapshot(snap);
    expect(board.format).toBe(retroFormats[0]);
    expect(board.phase).toBe("actions");
    expect(board.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(board.timerSeconds).toBe(120);
  });

  it("falls back to the host's column labels for a format id it doesn't know", () => {
    const snap = readRoomSnapshot({
      ...(wire(toRoomSnapshot(hostBoard(), meta())) as RoomSnapshot),
      formatId: "url(javascript:alert(1))",
      columns: [
        { key: "ideas", label: "Ideas" },
        { key: "worries", label: "Worries" },
        { key: "empty", label: "Nothing yet" },
      ],
      cards: [card("x1", { columnKey: "ideas" }), card("x2", { columnKey: "worries" })],
    })!;
    expect(snap).not.toBeNull();
    const board = boardFromSnapshot(snap);
    expect(board.format.id).toBe(FALLBACK_FORMAT_ID);
    // Every column, empty ones too, in the host's order and words.
    expect(board.format.columns.map((c) => c.key)).toEqual(["ideas", "worries", "empty"]);
    expect(board.format.columns.map((c) => c.label)).toEqual(["Ideas", "Worries", "Nothing yet"]);
    // Colours come from the local palette, icons are empty: nothing from the peer.
    for (const col of board.format.columns) {
      expect(col.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(col.icon).toBe("");
    }
    expect(JSON.stringify(board)).not.toContain("javascript");
    expect(board.cards).toHaveLength(2);
  });

  it("has no cards while they are hidden", () => {
    const snap = readRoomSnapshot(wire(toRoomSnapshot(hostBoard({ phase: "write" }), meta())))!;
    const board = boardFromSnapshot(snap);
    expect(board.phase).toBe("write");
    expect(board.cards).toEqual([]);
  });

  it("drops cards outside a known format's columns", () => {
    const snap = readRoomSnapshot({
      ...(wire(toRoomSnapshot(hostBoard(), meta())) as RoomSnapshot),
      cards: [card("ok"), card("stray", { columnKey: "not-a-column" })],
    })!;
    expect(boardFromSnapshot(snap).cards.map((c) => c.id)).toEqual(["ok"]);
  });

  it("keeps groups one level deep, in one column, without cycles", () => {
    const snap = readRoomSnapshot({
      ...(wire(toRoomSnapshot(hostBoard(), meta())) as RoomSnapshot),
      cards: [
        card("a", { groupedWith: "b" }),
        card("b", { groupedWith: "a" }),
        card("p"),
        card("child", { groupedWith: "p" }),
        card("other-col", { columnKey: "stop", groupedWith: "p" }),
        card("orphan", { groupedWith: "missing" }),
      ],
    })!;
    const byId = Object.fromEntries(boardFromSnapshot(snap).cards.map((c) => [c.id, c]));
    expect(byId.a.groupedWith).toBeNull();
    expect(byId.b.groupedWith).toBeNull();
    expect(byId.child.groupedWith).toBe("p");
    expect(byId["other-col"].groupedWith).toBeNull();
    expect(byId.orphan.groupedWith).toBeNull();
  });

  it("names columns after the cards when the host sent none, and has none for no cards", () => {
    expect(resolveRoomFormat("unknown", []).columns).toEqual([]);
    const named = resolveRoomFormat(
      "unknown",
      [],
      [
        { ...card("a"), columnKey: "ideas" },
        { ...card("b"), columnKey: "ideas" },
        { ...card("c"), columnKey: "risks" },
      ]
    );
    expect(named.columns.map((c) => [c.key, c.label])).toEqual([
      ["ideas", "ideas"],
      ["risks", "risks"],
    ]);
  });
});

describe("roomSignature", () => {
  it("ignores the running timer's tick but not start, pause or a reset", () => {
    const running = hostBoard({ timerRunning: true, timerSeconds: 100 });
    const ticked = { ...running, timerSeconds: 99 };
    expect(roomSignature(ticked)).toBe(roomSignature(running));
    expect(roomSignature({ ...running, timerRunning: false })).not.toBe(roomSignature(running));
    const paused = hostBoard({ timerSeconds: 100 });
    expect(roomSignature({ ...paused, timerSeconds: 300 })).not.toBe(roomSignature(paused));
  });

  it("changes with cards, votes, phase and the hiding setting", () => {
    const b = hostBoard();
    expect(roomSignature({ ...b, phase: "vote" })).not.toBe(roomSignature(b));
    expect(
      roomSignature({ ...b, cards: b.cards.map((c) => ({ ...c, votes: c.votes + 1 })) })
    ).not.toBe(roomSignature(b));
    expect(roomSignature(b, true)).not.toBe(roomSignature(b, false));
  });
});
