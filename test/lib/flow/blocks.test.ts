/**
 * lib/flow/blocks: the read rule for a blocked spell's end, its overlap
 * with a window and with the item's own cycle, blocks from before tracking,
 * and the tracking-since cut.
 */

import { describe, expect, it } from "vitest";
import type { BlockSpell, KanbanCard, Story } from "@/lib/stores/workspace-types";
import { BLOCK_TRACKING_SINCE } from "@/lib/flow/block-stamps";
import {
  DAY_MS,
  blockedInCycle,
  dayStartMs,
  msToDays,
  overlapMs,
  readSpells,
  spellEnd,
  spellMs,
  spellsOf,
  untrackedBlock,
} from "@/lib/flow/blocks";
import { addDays } from "@/lib/flow";
import { card, local, story } from "./fixtures";

const DAY0 = addDays(BLOCK_TRACKING_SINCE, 2) as string;
const day = (n: number) => addDays(DAY0, n) as string;
const at = (n: number, hour = 12) => local(day(n), hour);
const ms = (iso: string) => Date.parse(iso);
const NOW = ms(at(10));

const blockedStory = (log: BlockSpell[], patch: Partial<Story> = {}): Story =>
  story("s", { status: "in_progress", blocked: true, blockLog: log, ...patch });

describe("spellsOf", () => {
  it("reads a hand-edited log without throwing", () => {
    const row = {
      id: "x",
      blockLog: [{ from: "nope" }, 3, { from: at(1) }] as unknown as BlockSpell[],
    };
    expect(spellsOf(row)).toEqual([{ from: at(1) }]);
    expect(spellsOf({ id: "y" })).toEqual([]);
  });
});

describe("the read rule for a spell's end", () => {
  it("uses `to` when the spell has one", () => {
    const spell = { from: at(1), to: at(2) };
    expect(spellEnd(spell, blockedStory([spell]), NOW)).toBe(ms(at(2)));
  });

  it("ends an open spell at the Done moment when the row is done", () => {
    const spell = { from: at(1) };
    const row = blockedStory([spell], { status: "done", blocked: false, doneAt: at(4) });
    expect(spellEnd(spell, row, NOW)).toBe(ms(at(4)));
    const doneCard: KanbanCard = card("c", {
      column: "done",
      completedAt: at(3),
      blockLog: [spell],
    });
    expect(spellEnd(spell, doneCard, NOW)).toBe(ms(at(3)));
  });

  it("runs an open spell to now while the row is still blocked", () => {
    const spell = { from: at(1) };
    expect(spellEnd(spell, blockedStory([spell]), NOW)).toBe(NOW);
  });

  it("gives an open spell no length when the flag went off without a stamp", () => {
    const spell = { from: at(1) };
    const row = blockedStory([spell], { blocked: false });
    expect(spellEnd(spell, row, NOW)).toBeNull();
    expect(spellMs(spell, row, NOW)).toBe(0);
    expect(readSpells(row, NOW)[0]).toMatchObject({ tracked: false, open: false });
  });

  it("gives an earlier spell without `to` no length: only the last one is open", () => {
    const stale = { from: at(1) };
    const open = { from: at(5) };
    const row = blockedStory([stale, open]);
    const read = readSpells(row, NOW);
    expect(read[0]).toMatchObject({ tracked: false, to: ms(at(1)) });
    expect(read[1]).toMatchObject({ tracked: true, open: true, to: NOW });
  });

  it("never ends a spell before it began", () => {
    const spell = { from: at(5) };
    const row = blockedStory([spell], { status: "done", blocked: false, doneAt: at(3) });
    expect(spellEnd(spell, row, NOW)).toBe(ms(at(5)));
  });
});

describe("time inside a window", () => {
  it("counts only the overlap", () => {
    const spell = { from: at(1, 0), to: at(4, 0) };
    const row = blockedStory([spell], { blocked: false });
    const range = { start: ms(at(2, 0)), end: ms(at(9, 0)) };
    expect(spellMs(spell, row, NOW, range)).toBe(2 * DAY_MS);
    expect(msToDays(spellMs(spell, row, NOW))).toBe(3);
    expect(overlapMs({ start: 0, end: 5 }, { start: 6, end: 9 })).toBe(0);
  });

  it("reads a day's local midnight", () => {
    expect(dayStartMs(day(1))).toBe(new Date(...ymd(day(1))).getTime());
    expect(dayStartMs("not a day")).toBeNull();
  });
});

function ymd(d: string): [number, number, number] {
  const [y, m, dd] = d.split("-").map(Number);
  return [y, m - 1, dd];
}

describe("blocked since before tracking", () => {
  it("is a blocked row with no open spell", () => {
    expect(untrackedBlock(story("a", { blocked: true, status: "in_progress" }))).toBe(true);
    expect(
      untrackedBlock(
        story("b", { blocked: true, status: "in_progress", blockLog: [{ from: at(1), to: at(2) }] })
      )
    ).toBe(true);
    expect(untrackedBlock(blockedStory([{ from: at(1) }]))).toBe(false);
    expect(untrackedBlock(story("c", { blocked: false }))).toBe(false);
    expect(untrackedBlock(story("d", { blocked: true, status: "done" }))).toBe(false);
  });
});

describe("blocked time inside the cycle", () => {
  it("is the spells' overlap with start to done, in elapsed time", () => {
    const row = story("a", {
      status: "done",
      startedAt: at(1, 0),
      doneAt: at(5, 0),
      blockLog: [
        { from: at(0, 0), to: at(2, 0) },
        { from: at(3, 0), to: at(4, 0) },
      ],
    });
    expect(blockedInCycle(row, NOW)).toEqual({ cycleMs: 4 * DAY_MS, blockedMs: 2 * DAY_MS });
  });

  it("counts a same-day item's hours, not a whole day", () => {
    const row = story("a", {
      status: "done",
      startedAt: at(1, 9),
      doneAt: at(1, 11),
      blockLog: [{ from: at(1, 9), to: at(1, 10) }],
    });
    const read = blockedInCycle(row, NOW);
    expect(read).toEqual({ cycleMs: 2 * 3_600_000, blockedMs: 3_600_000 });
  });

  it("is null without both stamps, before it is done, or from before tracking", () => {
    expect(blockedInCycle(story("a", { status: "done", doneAt: at(2) }), NOW)).toBeNull();
    expect(blockedInCycle(story("b", { status: "in_progress", startedAt: at(1) }), NOW)).toBeNull();
    const before = addDays(BLOCK_TRACKING_SINCE, -3) as string;
    expect(
      blockedInCycle(story("c", { status: "done", startedAt: local(before), doneAt: at(2) }), NOW)
    ).toBeNull();
  });

  it("reads a finished card by its completion", () => {
    const c = card("c", {
      column: "done",
      startedAt: at(1, 0),
      completedAt: at(3, 0),
      blockLog: [{ from: at(2, 0) }],
    });
    expect(blockedInCycle(c, NOW)).toEqual({ cycleMs: 2 * DAY_MS, blockedMs: DAY_MS });
  });
});
