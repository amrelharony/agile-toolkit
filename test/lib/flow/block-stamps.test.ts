// @vitest-environment node
/**
 * lib/flow/block-stamps: blocked spells on stories and Kanban cards.
 *
 *   - the flag going on opens a spell, going off (a move into Done too)
 *     closes it; off with no open spell writes nothing;
 *   - a new row created blocked opens one at the write time;
 *   - a write that set its own log is kept as written (an Undo, a note);
 *   - the latest BLOCK_LOG_CAP are kept; examples are never stamped;
 *   - nothing to stamp gives the row back by reference;
 *   - boards card by card; bad stored logs and flow fields cleaned;
 *   - notes on a spell, and an earlier spell for a block from before tracking;
 *   - a leaf: it imports nothing from the rest of lib/flow or lib/kanban.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_LOG_CAP,
  BLOCK_TRACKING_SINCE,
  cleanBlockLog,
  cleanCardFlowFields,
  openSpellIndex,
  stampBoardBlocks,
  stampStoryBlocks,
  withSpellNote,
} from "@/lib/flow/block-stamps";
import { movedCard } from "@/lib/kanban/flow";
import { withStoryBlocked, withStoryStatus } from "@/lib/sprints/story-status";
import type { BlockSpell, HandoffLink, KanbanBoard } from "@/lib/stores/workspace-types";
import { TOOL_LIST_MAX } from "@/lib/stores/workspace-types";
import { card, local, story } from "./fixtures";

const T0 = local("2026-11-23", 9);
const T1 = local("2026-11-24", 10);
const T2 = local("2026-11-25", 11);

const LINK: HandoffLink = { route: "impediment", targetId: "imp_1", at: T1 };

const board = (cards: KanbanBoard["cards"]): KanbanBoard => ({
  id: "kanban:current",
  cards,
  wipLimits: { backlog: 0, ready: 0, in_progress: 3, review: 2, done: 0 },
});

/** A log of `n` closed spells, a day apart. */
const closedSpells = (n: number): BlockSpell[] =>
  Array.from({ length: n }, (_, i) => ({
    from: local(`2026-11-${String(1 + (i % 20)).padStart(2, "0")}`, 9),
    to: local(`2026-11-${String(1 + (i % 20)).padStart(2, "0")}`, 17),
    cause: `cause ${i}`,
  }));

describe("constants", () => {
  it("caps the log at the shared list cap and starts tracking on a local day", () => {
    expect(BLOCK_LOG_CAP).toBe(TOOL_LIST_MAX.blockLog);
    expect(BLOCK_LOG_CAP).toBe(20);
    expect(BLOCK_TRACKING_SINCE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("stampStoryBlocks", () => {
  it("opens a spell when the flag goes on and closes it when it goes off", () => {
    const prev = story("a", { status: "in_progress" });
    const blocked = stampStoryBlocks(withStoryBlocked(prev, true), prev, T0);
    expect(blocked.blockLog).toEqual([{ from: T0 }]);
    const unblocked = stampStoryBlocks(withStoryBlocked(blocked, false), blocked, T1);
    expect(unblocked.blocked).toBeUndefined();
    expect(unblocked.blockLog).toEqual([{ from: T0, to: T1 }]);
    // Blocked again: a second spell, the first kept.
    const again = stampStoryBlocks(withStoryBlocked(unblocked, true), unblocked, T2);
    expect(again.blockLog).toEqual([{ from: T0, to: T1 }, { from: T2 }]);
  });

  it("closes the open spell on a move into Done, which drops the flag", () => {
    const prev = story("a", {
      status: "in_progress",
      blocked: true,
      blockLog: [{ from: T0, cause: "Waiting on the API" }],
    });
    const done = withStoryStatus(prev, "done", T1);
    expect(done.blocked).toBeUndefined();
    expect(stampStoryBlocks(done, prev, T1).blockLog).toEqual([
      { from: T0, cause: "Waiting on the API", to: T1 },
    ]);
  });

  it("closes only the open spell, the last without an end", () => {
    const prev = story("a", {
      blocked: true,
      blockLog: [{ from: T0, to: T1 }, { from: T2 }],
    });
    const at = local("2026-11-26", 9);
    expect(stampStoryBlocks(withStoryBlocked(prev, false), prev, at).blockLog).toEqual([
      { from: T0, to: T1 },
      { from: T2, to: at },
    ]);
  });

  it("writes nothing when the flag goes off with no open spell (blocked before tracking)", () => {
    const prev = story("a", { blocked: true });
    const next = withStoryBlocked(prev, false);
    expect(stampStoryBlocks(next, prev, T1)).toBe(next);
    const closed = story("b", { blocked: true, blockLog: [{ from: T0, to: T1 }] });
    const off = withStoryBlocked(closed, false);
    expect(stampStoryBlocks(off, closed, T2)).toBe(off);
  });

  it("never ends a spell before it starts", () => {
    const prev = story("a", { blocked: true, blockLog: [{ from: T1 }] });
    expect(stampStoryBlocks(withStoryBlocked(prev, false), prev, T0).blockLog).toEqual([
      { from: T1, to: T1 },
    ]);
  });

  it("opens a spell at the write time for a new story created blocked", () => {
    const created = story("a", { blocked: true, createdAt: "2026-11-01" });
    expect(stampStoryBlocks(created, undefined, T0).blockLog).toEqual([{ from: T0 }]);
    const open = story("b");
    expect(stampStoryBlocks(open, undefined, T0)).toBe(open);
  });

  it("keeps a log the write set itself: an Undo, a note, a backfill", () => {
    // A new row with any log: kept as written, even an empty one.
    const backfill = story("a", { blocked: true, blockLog: [{ from: T0, earlier: true }] });
    expect(stampStoryBlocks(backfill, undefined, T2)).toBe(backfill);
    const empty = story("b", { blocked: true, blockLog: [] });
    expect(stampStoryBlocks(empty, undefined, T2)).toBe(empty);
    // An Undo putting the open spell back while the flag comes back on.
    const stored = story("c", { blockLog: [{ from: T0, to: T1 }] });
    const undo = story("c", { blocked: true, blockLog: [{ from: T0 }] });
    expect(stampStoryBlocks(undo, stored, T2)).toBe(undo);
    // An Undo taking the log away altogether.
    const bare = story("c");
    expect(stampStoryBlocks(bare, stored, T2)).toBe(bare);
  });

  it("reads no log and an empty one as the same log", () => {
    const prev = story("a", { blockLog: [] });
    expect(stampStoryBlocks(story("a", { blocked: true }), prev, T0).blockLog).toEqual([
      { from: T0 },
    ]);
  });

  it("reads the same log with its keys in another order as the same log", () => {
    // Read back from jsonb (keys shortest first) and validated by zod (schema order).
    const stored = story("a", {
      blockLog: [
        {
          to: T1,
          from: T0,
          cause: "Waiting on legal",
          sentTo: [{ at: T1, route: "impediment", targetId: "imp_1" } as HandoffLink],
        },
      ],
    });
    const patched = {
      ...stored,
      blocked: true,
      blockLog: [{ from: T0, to: T1, cause: "Waiting on legal", sentTo: [LINK] }],
    };
    expect(Object.keys(patched.blockLog[0])).not.toEqual(Object.keys(stored.blockLog![0]));
    expect(stampStoryBlocks(patched, stored, T2).blockLog).toEqual([
      { from: T0, to: T1, cause: "Waiting on legal", sentTo: [LINK] },
      { from: T2 },
    ]);
    // And off again: the spell it opened is closed.
    const reopened = stampStoryBlocks(patched, stored, T2);
    const reread = {
      ...reopened,
      blockLog: reopened.blockLog!.map(({ from, to, cause, sentTo }) =>
        to ? { to, from, cause, sentTo } : { from }
      ),
    };
    const at = local("2026-11-26", 9);
    expect(stampStoryBlocks(withStoryBlocked(reopened, false), reread, at).blockLog).toEqual([
      { from: T0, to: T1, cause: "Waiting on legal", sentTo: [LINK] },
      { from: T2, to: at },
    ]);
  });

  it("stamps a story blocked, noted, unblocked and blocked again over the transports", () => {
    const start = story("st1", { status: "in_progress" });
    const blocked = stampStoryBlocks(withStoryBlocked(start, true), start, T0);
    const noted = withSpellNote(blocked, { cause: "Waiting on legal" }, { at: T0 })!;
    const unblocked = stampStoryBlocks(withStoryBlocked(noted, false), noted, T1);
    // Closing the spell writes `to` after the note: {from, cause, to}.
    expect(Object.keys(unblocked.blockLog![0])).toEqual(["from", "cause", "to"]);
    // An agent's patch, validated in schema order: {from, to, cause}.
    const patch = {
      ...unblocked,
      blocked: true,
      blockLog: [{ from: T0, to: T1, cause: "Waiting on legal" }],
    };
    expect(stampStoryBlocks(patch, unblocked, T2).blockLog).toEqual([
      { from: T0, to: T1, cause: "Waiting on legal" },
      { from: T2 },
    ]);
  });

  it("gives the story back by reference when nothing changes", () => {
    const prev = story("a", { blocked: true, blockLog: [{ from: T0 }] });
    const next = { ...prev, title: "Renamed" };
    expect(stampStoryBlocks(next, prev, T1)).toBe(next);
    const plain = story("b");
    const edit = { ...plain, owner: "Sam" };
    expect(stampStoryBlocks(edit, plain, T1)).toBe(edit);
  });

  it("keeps only the latest BLOCK_LOG_CAP spells", () => {
    const full = closedSpells(BLOCK_LOG_CAP);
    const prev = story("a", { blockLog: full });
    const out = stampStoryBlocks(withStoryBlocked(prev, true), prev, T2).blockLog!;
    expect(out).toHaveLength(BLOCK_LOG_CAP);
    expect(out[0]).toEqual(full[1]);
    expect(out[BLOCK_LOG_CAP - 1]).toEqual({ from: T2 });
    // A log the write set itself is cut to the cap too.
    const long = story("b", { blockLog: closedSpells(BLOCK_LOG_CAP + 3) });
    expect(stampStoryBlocks(long, undefined, T2).blockLog).toHaveLength(BLOCK_LOG_CAP);
  });

  it("never stamps an example story", () => {
    const prev = story("example-s1");
    const next = withStoryBlocked(prev, true);
    expect(stampStoryBlocks(next, prev, T0)).toBe(next);
    const created = story("example-s2", { blocked: true });
    expect(stampStoryBlocks(created, undefined, T0)).toBe(created);
  });

  it("stamps the current time by default", () => {
    const prev = story("a");
    const [spell] = stampStoryBlocks(withStoryBlocked(prev, true), prev).blockLog!;
    expect(Date.parse(spell.from)).toBeGreaterThan(Date.parse("2026-01-01"));
  });
});

describe("stampBoardBlocks", () => {
  it("stamps card by card, matched by id, leaving the others as they are", () => {
    const a = card("a", { column: "in_progress" });
    const b = card("b", { column: "review" });
    const prev = board([a, b]);
    const next = board([{ ...a, blocked: true }, b]);
    const out = stampBoardBlocks(next, prev, T0);
    expect(out).not.toBe(next);
    expect(out.cards[0].blockLog).toEqual([{ from: T0 }]);
    expect(out.cards[1]).toBe(b);
    expect(out.wipLimits).toBe(next.wipLimits);
  });

  it("closes a card's spell on a move into Done", () => {
    const a = card("a", { column: "review", blocked: true, blockLog: [{ from: T0 }] });
    const prev = board([a]);
    const done = movedCard(a, "done", T1);
    expect(done.blocked).toBeUndefined();
    expect(stampBoardBlocks(board([done]), prev, T1).cards[0].blockLog).toEqual([
      { from: T0, to: T1 },
    ]);
  });

  it("opens a spell for a new card added blocked, and for a new board's blocked cards", () => {
    const prev = board([card("a")]);
    const added = card("b", { blocked: true, createdAt: "2026-11-01" });
    expect(stampBoardBlocks(board([card("a"), added]), prev, T0).cards[1].blockLog).toEqual([
      { from: T0 },
    ]);
    const fresh = stampBoardBlocks(board([card("c", { blocked: true }), card("d")]), undefined, T0);
    expect(fresh.cards[0].blockLog).toEqual([{ from: T0 }]);
    expect(fresh.cards[1].blockLog).toBeUndefined();
  });

  it("stamps a card the board CRUD cleaned, whose spell's keys come back in another order", () => {
    const stored = card("a", {
      column: "in_progress",
      blockLog: [{ from: T0, cause: "Flaky build", to: T1 }],
    });
    const cleaned = cleanCardFlowFields({ ...stored, blocked: true });
    expect(Object.keys(cleaned.blockLog![0])).toEqual(["from", "to", "cause"]);
    expect(stampBoardBlocks(board([cleaned]), board([stored]), T2).cards[0].blockLog).toEqual([
      { from: T0, to: T1, cause: "Flaky build" },
      { from: T2 },
    ]);
  });

  it("gives the board back by reference when no card is stamped", () => {
    const prev = board([card("a", { blocked: true, blockLog: [{ from: T0 }] })]);
    const next = board([{ ...prev.cards[0], title: "Renamed" }]);
    expect(stampBoardBlocks(next, prev, T1)).toBe(next);
  });

  it("never stamps an example card, and reads a board without a card list as it is", () => {
    const prev = board([card("example-c1")]);
    const next = board([{ ...prev.cards[0], blocked: true }]);
    expect(stampBoardBlocks(next, prev, T0)).toBe(next);
    const broken = { id: "kanban:current", cards: "nope" } as unknown as KanbanBoard;
    expect(stampBoardBlocks(broken, prev, T0)).toBe(broken);
    // A stored board whose cards aren't a list: every card reads as new.
    const stored = { ...prev, cards: null } as unknown as KanbanBoard;
    const blocked = board([card("a", { blocked: true })]);
    expect(stampBoardBlocks(blocked, stored, T0).cards[0].blockLog).toEqual([{ from: T0 }]);
  });
});

describe("openSpellIndex", () => {
  it("finds the last spell without an end", () => {
    expect(openSpellIndex([{ from: T0 }, { from: T1, to: T2 }])).toBe(0);
    expect(openSpellIndex([{ from: T0 }, { from: T1 }])).toBe(1);
    expect(openSpellIndex([{ from: T0, to: T1 }])).toBe(-1);
    expect(openSpellIndex([])).toBe(-1);
    expect(openSpellIndex(undefined)).toBe(-1);
  });
});

describe("cleanBlockLog", () => {
  it("reads only what is a spell, the way cardHistory reads moves", () => {
    expect(cleanBlockLog(undefined)).toBeUndefined();
    expect(cleanBlockLog("nope")).toBeUndefined();
    expect(cleanBlockLog([])).toBeUndefined();
    expect(
      cleanBlockLog([null, 3, "x", [T0], {}, { from: "soon" }, { from: 12 }, { from: T0 }])
    ).toEqual([{ from: T0 }]);
  });

  it("removes an end before the start, or one that isn't a time, and keeps the spell", () => {
    expect(
      cleanBlockLog([
        { from: T1, to: T0 },
        { from: T1, to: "later" },
        { from: T0, to: T1 },
      ])
    ).toEqual([{ from: T1 }, { from: T1 }, { from: T0, to: T1 }]);
    // A plain local day reads as its local midnight.
    expect(cleanBlockLog([{ from: "2026-11-23", to: T0 }])).toEqual([
      { from: "2026-11-23", to: T0 },
    ]);
  });

  it("cuts the cause and the cluster, checks the side and drops unknown keys", () => {
    const [spell] = cleanBlockLog([
      {
        from: T0,
        cause: `  ${"c".repeat(250)}  `,
        cluster: "k".repeat(80),
        side: "sideways",
        earlier: "yes",
        extra: 1,
      },
    ])!;
    expect(spell).toEqual({ from: T0, cause: "c".repeat(200), cluster: "k".repeat(60) });
    expect(cleanBlockLog([{ from: T0, cause: "   ", side: "external", earlier: true }])).toEqual([
      { from: T0, side: "external", earlier: true },
    ]);
  });

  it("keeps only valid hand-off links, the first one per route", () => {
    const [spell] = cleanBlockLog([
      {
        from: T0,
        sentTo: [
          LINK,
          { route: "impediment", targetId: "imp_2", at: T2 },
          { route: "nowhere", targetId: "x", at: T1 },
          { route: "kanban", targetId: "", at: T1 },
          { route: "risk", targetId: "risk_1" },
          "impediment",
          { route: "retro-topic", targetId: "c1", at: T1, extra: true },
        ],
      },
    ])!;
    expect(spell.sentTo).toEqual([LINK, { route: "retro-topic", targetId: "c1", at: T1 }]);
    expect(cleanBlockLog([{ from: T0, sentTo: [{ route: "x" }] }])).toEqual([{ from: T0 }]);
  });

  it("keeps the latest BLOCK_LOG_CAP", () => {
    const long = closedSpells(BLOCK_LOG_CAP + 5);
    const out = cleanBlockLog(long)!;
    expect(out).toHaveLength(BLOCK_LOG_CAP);
    expect(out[0]).toEqual(long[5]);
  });
});

describe("cleanCardFlowFields", () => {
  it("removes a work type or demand that isn't one, and cleans the log", () => {
    const raw = {
      ...card("a"),
      workType: "chore",
      demand: "value",
      blockLog: [{ from: T0, side: "inside" }, { nope: true }],
    } as unknown as Parameters<typeof cleanCardFlowFields>[0];
    const out = cleanCardFlowFields(raw);
    expect(out).toEqual({ ...card("a"), demand: "value", blockLog: [{ from: T0 }] });
    expect("workType" in out).toBe(false);
    const bad = { ...card("b"), demand: "failure!", blockLog: "x" } as unknown as Parameters<
      typeof cleanCardFlowFields
    >[0];
    const cleaned = cleanCardFlowFields(bad);
    expect("demand" in cleaned).toBe(false);
    expect("blockLog" in cleaned).toBe(false);
  });

  it("removes an empty log, and gives a clean card back by reference", () => {
    expect("blockLog" in cleanCardFlowFields({ ...card("a"), blockLog: [] })).toBe(false);
    const clean = card("b", {
      workType: "defect",
      demand: "failure",
      blockLog: [{ from: T0, to: T1, cluster: "Another team", side: "external" }],
    });
    expect(cleanCardFlowFields(clean)).toBe(clean);
    const plain = card("c");
    expect(cleanCardFlowFields(plain)).toBe(plain);
  });

  it("cleans a story's flow fields the same way", () => {
    const raw = { ...story("a"), workType: "defect", demand: 7 } as unknown as Parameters<
      typeof cleanCardFlowFields
    >[0];
    expect(cleanCardFlowFields(raw)).toEqual({ ...story("a"), workType: "defect" });
  });
});

describe("withSpellNote", () => {
  const blocked = story("a", {
    blocked: true,
    blockLog: [{ from: T0, to: T1, cause: "Review queue" }, { from: T2 }],
  });

  it("writes on the open spell by default", () => {
    const out = withSpellNote(
      blocked,
      {
        cause: "  Waiting on the vendor  ",
        cluster: "A vendor or outside service",
        side: "external",
      },
      { at: T2 }
    )!;
    expect(out.blockLog).toEqual([
      { from: T0, to: T1, cause: "Review queue" },
      {
        from: T2,
        cause: "Waiting on the vendor",
        cluster: "A vendor or outside service",
        side: "external",
      },
    ]);
    expect(out.blocked).toBe(true);
  });

  it("writes on the spell starting at spellFrom, and clears with an empty field", () => {
    const out = withSpellNote(blocked, { cause: "", side: "internal" }, { spellFrom: T0 })!;
    expect(out.blockLog![0]).toEqual({ from: T0, to: T1, side: "internal" });
    const cleared = withSpellNote(out, { side: null }, { spellFrom: T0 })!;
    expect(cleared.blockLog![0]).toEqual({ from: T0, to: T1 });
  });

  it("replaces the links, valid ones only and one per route", () => {
    const other: HandoffLink = { route: "impediment", targetId: "imp_9", at: T2 };
    const out = withSpellNote(blocked, { sentTo: [LINK, other] })!;
    expect(out.blockLog![1].sentTo).toEqual([LINK]);
    const none = withSpellNote(out, { sentTo: [] })!;
    expect("sentTo" in none.blockLog![1]).toBe(false);
  });

  it("cuts the cause and the cluster to their caps", () => {
    const out = withSpellNote(blocked, { cause: "x".repeat(300), cluster: "y".repeat(90) })!;
    expect(out.blockLog![1]).toEqual({ from: T2, cause: "x".repeat(200), cluster: "y".repeat(60) });
  });

  it("opens an earlier spell on a row blocked since before tracking", () => {
    const row = story("b", { blocked: true });
    const out = withSpellNote(row, { cluster: "Another team" }, { at: T1 })!;
    expect(out.blockLog).toEqual([{ from: T1, earlier: true, cluster: "Another team" }]);
    // The store keeps it as written: the log differs from the stored one.
    expect(stampStoryBlocks(out, row, T2)).toBe(out);
    const closed = story("c", { blocked: true, blockLog: [{ from: T0, to: T1 }] });
    expect(withSpellNote(closed, { cause: "Again" }, { at: T2 })!.blockLog).toEqual([
      { from: T0, to: T1 },
      { from: T2, earlier: true, cause: "Again" },
    ]);
  });

  it("is null when no spell matches", () => {
    expect(withSpellNote(story("d"), { cause: "x" })).toBeNull();
    expect(
      withSpellNote(story("e", { blockLog: [{ from: T0, to: T1 }] }), { cause: "x" })
    ).toBeNull();
    expect(withSpellNote(blocked, { cause: "x" }, { spellFrom: T1 })).toBeNull();
  });

  it("gives the row back by reference when the note changes nothing", () => {
    expect(withSpellNote(blocked, { cause: "Review queue" }, { spellFrom: T0 })).toBe(blocked);
    expect(withSpellNote(blocked, {})).toBe(blocked);
    expect(withSpellNote(blocked, { cause: "" })).toBe(blocked);
    // A spell read back from jsonb, its keys and its links' keys in another order.
    const reread = story("b", {
      blocked: true,
      blockLog: [
        {
          from: T0,
          cause: "Review queue",
          sentTo: [{ at: T1, route: "impediment", targetId: "imp_1" } as HandoffLink],
        },
      ],
    });
    expect(withSpellNote(reread, { cause: "Review queue", sentTo: [LINK] })).toBe(reread);
  });

  it("works on a Kanban card too", () => {
    const c = card("a", { blocked: true, blockLog: [{ from: T0 }] });
    expect(withSpellNote(c, { cause: "Flaky build" })!.blockLog).toEqual([
      { from: T0, cause: "Flaky build" },
    ]);
  });
});

describe("a leaf module", () => {
  it("imports only the workspace types and isExampleId", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/flow/block-stamps.ts"), "utf8");
    const specs = Array.from(src.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map(
      (m) => m[1]
    );
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(["@/lib/stores/workspace-types", "@/lib/utils/example-id"]).toContain(spec);
    }
  });
});
