import { describe, expect, it } from "vitest";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import {
  archivedRetroCopy,
  hasRetroContent,
  pastRetros,
  retroActionItems,
  retroArchivesToPrune,
} from "@/app/(tools)/retro/archive";

const card = (id: string, isActionItem = false): RetroCard => ({
  id,
  columnKey: "start",
  text: `card ${id}`,
  votes: 0,
  groupedWith: null,
  isActionItem,
  assignee: isActionItem ? "Sam" : "",
  discussing: false,
});

const board = (over: Partial<RetroBoard> = {}): RetroBoard => ({
  id: "retro:current",
  format: { id: "ssc", name: "Start / Stop / Continue" } as unknown as RetroBoard["format"],
  phase: "actions",
  cards: [card("a"), card("b", true)],
  userVotes: 0,
  timerSeconds: 300,
  timerRunning: true,
  discussingIndex: 0,
  ...over,
});

describe("retro archive", () => {
  it("copies the board to its own id and leaves retro:current to the caller", () => {
    const now = new Date("2026-10-18T09:30:00Z");
    const copy = archivedRetroCopy(board(), now);
    expect(copy.id).toBe("retro:2026-10-18T09:30:00.000Z");
    expect(copy.id).not.toBe("retro:current");
    expect(copy.archivedAt).toBe("2026-10-18T09:30:00.000Z");
    expect(copy.timerRunning).toBe(false);
    expect(copy.cards).toHaveLength(2);
  });

  it("only archives boards with cards", () => {
    expect(hasRetroContent(board())).toBe(true);
    expect(hasRetroContent(board({ cards: [] }))).toBe(false);
    expect(hasRetroContent(null)).toBe(false);
  });

  it("lists past retros newest first, never the current board", () => {
    const boards = [
      board(),
      board({ id: "retro:1", archivedAt: "2026-09-01T00:00:00.000Z" }),
      board({ id: "retro:2", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(pastRetros(boards).map((b) => b.id)).toEqual(["retro:2", "retro:1"]);
  });

  it("prunes the oldest so the archive stays within its limit", () => {
    const boards = [1, 2, 3, 4].map((n) =>
      board({ id: `retro:${n}`, archivedAt: `2026-0${n}-01T00:00:00.000Z` })
    );
    // Room for 3 after adding one: keep the newest 2, drop 2 and 1.
    expect(retroArchivesToPrune(boards, 3)).toEqual(["retro:2", "retro:1"]);
    expect(retroArchivesToPrune(boards, 10)).toEqual([]);
  });

  it("pulls out the action items", () => {
    expect(retroActionItems(board()).map((c) => c.id)).toEqual(["b"]);
  });
});
