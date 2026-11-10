import { beforeEach, describe, expect, it } from "vitest";
import { RETRO_COLUMN_PALETTE, retroFormats } from "@/lib/constants/retro-formats";
import { blankRetroBoard } from "@/lib/retro/board";
import { customFormatFrom } from "@/lib/retro/custom-format";
import { SNAPSHOT_IMPORTERS, snapshotValidators } from "@/lib/share/snapshot-import";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import {
  archivedRetroCopy,
  boardBeforeNewRetro,
  carriedOverCard,
  pastRetros,
} from "@/app/(tools)/retro/archive";
import { buildExportJson, retroFileStem } from "@/app/(tools)/retro/helpers";
import { toMarkdown } from "@/app/(tools)/retro/markdown";

/**
 * A custom format (and Votes each) through every path a board takes:
 * Past retros and New Retro's Undo, carrying actions over, the Markdown and
 * JSON exports, share links and "Copy into my browser".
 */

const pulse = customFormatFrom(
  { name: "Team pulse", columns: ["Wins", "Worries", "Ideas"] },
  "custom-pulse0001"
);

function card(id: string, columnKey: string, over: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey,
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...over,
  };
}

const customBoard = (): RetroBoard => ({
  ...blankRetroBoard(pulse, { votesPerPerson: 5 }),
  phase: "actions",
  cards: [
    card("w1", "wins", { votes: 4 }),
    card("i1", "ideas", { votes: 2, isActionItem: true, assignee: "Sam" }),
  ],
});

beforeEach(() => {
  useWorkspaceStore.setState({ retroBoards: [] });
});

describe("Past retros", () => {
  it("keeps the custom format and Votes each on the archived copy and on Undo", () => {
    const before = customBoard();
    const copy = archivedRetroCopy(before, new Date("2026-11-10T10:00:00Z"));
    expect(copy.format).toEqual(pulse);
    expect(copy.votesPerPerson).toBe(5);
    expect(pastRetros([copy, before]).map((b) => b.format.name)).toEqual(["Team pulse"]);

    // A board started since in a built-in format: its cards come back in this one's first column.
    const started = { ...blankRetroBoard(retroFormats[0]), cards: [card("s1", "start")] };
    const back = boardBeforeNewRetro(before, copy, started);
    expect(back.format).toEqual(pulse);
    expect(back.votesPerPerson).toBe(5);
    expect(back.cards.find((c) => c.id === "s1")?.columnKey).toBe("wins");
  });

  it("carries an action over into the same column when the next format has it, else the first", () => {
    const action = card("old", "ideas", { isActionItem: true, assignee: "Sam" });
    const keys = pulse.columns.map((c) => c.key);
    expect(carriedOverCard(action, keys, "n1").columnKey).toBe("ideas");
    const fromBuiltIn = card("old2", "stop", { isActionItem: true });
    expect(carriedOverCard(fromBuiltIn, keys, "n2").columnKey).toBe("wins");
  });
});

describe("exports", () => {
  it("writes the Markdown in the team's own columns, empty ones too", () => {
    const board = { ...customBoard(), cards: [card("w1", "wins", { votes: 4 })] };
    const md = toMarkdown(board, new Date("2026-11-10T10:00:00Z"));
    expect(md).toContain("# Retro — 10 Nov 2026 (Team pulse)");
    expect(md).toContain("## Wins\n\n- Card w1 (4 votes)");
    expect(md).toContain("## Worries\n\nNo cards.");
    expect(md).toContain("## Ideas\n\nNo cards.");
  });

  it("names the file after a custom format's name, and the JSON says the votes each", () => {
    expect(retroFileStem(pulse)).toBe("retro-team-pulse");
    expect(retroFileStem({ id: "custom-x", name: "😀" })).toBe("retro-custom");
    expect(retroFileStem(retroFormats[0])).toBe("retro-start-stop-continue");
    // A live room's participant draws a custom format under the room's id: same name.
    expect(retroFileStem({ id: "room", name: "Team pulse" })).toBe("retro-team-pulse");
    expect(retroFileStem({ id: "room", name: "Retro" })).toBe("retro-custom");
    const json = buildExportJson(customBoard());
    expect(json).toMatchObject({ format: "Team pulse", votesPerPerson: 5 });
    expect(json.columns.map((c) => c.label)).toEqual(["Wins", "Worries", "Ideas"]);
    expect(buildExportJson(blankRetroBoard(retroFormats[0])).votesPerPerson).toBe(3);
  });
});

describe("share links", () => {
  /** What the board's Export puts in a share link, as it arrives. */
  const linkState = (b: RetroBoard) =>
    JSON.parse(JSON.stringify({ format: b.format, cards: b.cards, votesPerPerson: 5 }));

  it("copies a custom-format retro into Past retros with its columns and votes each", () => {
    const undo = SNAPSHOT_IMPORTERS.retro.importState(linkState(customBoard()));
    expect(undo).toBeTypeOf("function");
    const imported = useWorkspaceStore.getState().retroBoards!.find((b) => b.archivedAt)!;
    expect(imported.format).toEqual(pulse);
    expect(imported.votesPerPerson).toBe(5);
    expect(imported.cards.map((c) => [c.id, c.columnKey])).toEqual([
      ["w1", "wins"],
      ["i1", "ideas"],
    ]);
    undo!();
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
  });

  it("never takes a colour from the link that isn't one of the app's, nor an odd vote count", () => {
    const state = linkState(customBoard());
    state.format.columns[0].color = "red; background: url(https://evil.example)";
    state.format.columns[1].color = "#A855F7";
    delete state.format.columns[2].color;
    state.votesPerPerson = 99;
    const read = snapshotValidators.readRetro(state)!;
    expect(read.format.columns.map((c) => c.color)).toEqual([
      RETRO_COLUMN_PALETTE[0],
      "#A855F7",
      RETRO_COLUMN_PALETTE[2],
    ]);
    expect("votesPerPerson" in read).toBe(false);
  });
});
