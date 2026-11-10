import { describe, expect, it } from "vitest";
import { RETRO_COLUMN_PALETTE, retroFormats } from "@/lib/constants/retro-formats";
import { retroColumnFor } from "@/lib/handoffs/targets/retro-board";
import {
  CUSTOM_COLUMNS_MAX,
  SAVED_CUSTOM_MAX,
  SAVED_CUSTOM_READ_MAX,
  customColumnKeys,
  customFormatFrom,
  isCustomFormatId,
  newCustomFormatId,
  normalizeSavedFormats,
  savedFirst,
  validateCustomFormat,
  withRestoredFormat,
  withSavedFormat,
  type SavedCustomFormat,
} from "@/lib/retro/custom-format";

/** The team's own columns: checking a draft, building the format, the saved list. */

describe("validateCustomFormat", () => {
  it("passes a named format with 2 to 6 differently named columns, trimmed", () => {
    expect(
      validateCustomFormat({ name: "  Team   pulse ", columns: [" Wins ", "Worries"] })
    ).toEqual({ ok: true, values: { name: "Team pulse", columns: ["Wins", "Worries"] } });
    const six = ["A", "B", "C", "D", "E", "F"];
    expect(validateCustomFormat({ name: "Six", columns: six }).ok).toBe(true);
  });

  it("says what's missing instead of filling it in", () => {
    const r = validateCustomFormat({ name: " ", columns: ["Wins", "", "wins"] });
    expect(r).toEqual({
      ok: false,
      errors: {
        name: "Name the format.",
        column1: "Name this column.",
        column2: "Give each column its own name.",
      },
    });
  });

  it("refuses too few or too many columns, and names that are too long", () => {
    expect(validateCustomFormat({ name: "One", columns: ["Only"] })).toMatchObject({
      ok: false,
      errors: { columns: "Give it 2 to 6 columns." },
    });
    expect(
      validateCustomFormat({ name: "Seven", columns: ["A", "B", "C", "D", "E", "F", "G"] })
    ).toMatchObject({ ok: false, errors: { columns: "Give it 2 to 6 columns." } });
    expect(validateCustomFormat({ name: "x".repeat(61), columns: ["A", "y".repeat(41)] })).toEqual({
      ok: false,
      errors: {
        name: "Keep the name to 60 characters.",
        column1: "Keep it to 40 characters.",
      },
    });
  });
});

describe("customFormatFrom", () => {
  it("keys the columns from their names and colours them from the palette, in order", () => {
    const columns = ["Went well", "Went well!", "Café ideas", "😀", "Glad", "Keep"];
    const format = customFormatFrom({ name: "Ours", columns }, "custom-abc");
    expect(format).toMatchObject({
      id: "custom-abc",
      name: "Ours",
      description: "Your own columns: Went well, Went well!, Café ideas, 😀, Glad and Keep.",
    });
    expect(format.columns.map((c) => c.key)).toEqual([
      "went-well",
      "went-well-2",
      "cafe-ideas",
      "column-4",
      "glad",
      "keep",
    ]);
    expect(format.columns.map((c) => c.color)).toEqual(RETRO_COLUMN_PALETTE.slice(0, 6));
    expect(format.columns.every((c) => c.icon === "")).toBe(true);
    // A hand-off still finds the column its tone fits.
    expect(retroColumnFor(format, "appreciation")).toBe("glad");
  });

  it("makes keys no longer than 40 characters, never ending in a dash", () => {
    const [key] = customColumnKeys([`${"a".repeat(39)} b`]);
    expect(key).toBe("a".repeat(39));
  });

  it("gives every custom format an id no built-in format has", () => {
    const id = newCustomFormatId();
    expect(isCustomFormatId(id)).toBe(true);
    expect(newCustomFormatId()).not.toBe(id);
    for (const f of retroFormats) expect(isCustomFormatId(f.id)).toBe(false);
    expect(isCustomFormatId(`custom-${"x".repeat(60)}`)).toBe(false);
  });
});

describe("the saved list", () => {
  const saved = (id: string, name = id, columns = ["A", "B"]): SavedCustomFormat => ({
    id: `custom-${id}`,
    name,
    columns,
  });

  it("keeps only valid entries, each id once, at most 24 read back", () => {
    const raw = [
      saved("a"),
      saved("a", "Twin"),
      { id: "start-stop-continue", name: "Not custom", columns: ["A", "B"] },
      { id: "custom-b", name: "", columns: ["A", "B"] },
      { id: "custom-c", name: "Bad", columns: ["A", 7] },
      { id: "custom-d", name: "One", columns: ["A"] },
      "junk",
      null,
      saved("e", "  Spaced  name ", [" A ", "B"]),
    ];
    expect(normalizeSavedFormats(raw)).toEqual([saved("a"), saved("e", "Spaced name")]);
    expect(normalizeSavedFormats("nope")).toEqual([]);
    // Undo of a delete can leave one past the 12 saving keeps: it isn't cut on read.
    expect(SAVED_CUSTOM_READ_MAX).toBe(24);
    const over = Array.from({ length: SAVED_CUSTOM_MAX + 1 }, (_, i) => saved(`n${i}`));
    expect(normalizeSavedFormats(over)).toHaveLength(SAVED_CUSTOM_MAX + 1);
    const many = Array.from({ length: 30 }, (_, i) => saved(`n${i}`));
    expect(normalizeSavedFormats(many)).toHaveLength(SAVED_CUSTOM_READ_MAX);
  });

  it("puts a new format first, and moves a twin up under its old id", () => {
    const list = [saved("a", "Alpha"), saved("b", "Beta")];
    const added = withSavedFormat(list, { name: "Gamma", columns: ["X", "Y"] }, () => "custom-g");
    expect(added.id).toBe("custom-g");
    expect(added.list.map((f) => f.id)).toEqual(["custom-g", "custom-a", "custom-b"]);
    expect(added.dropped).toEqual([]);

    const again = withSavedFormat(added.list, { name: "beta", columns: ["a", "b"] }, () => {
      throw new Error("a twin keeps its id");
    });
    expect(again.id).toBe("custom-b");
    expect(again.list.map((f) => f.id)).toEqual(["custom-b", "custom-g", "custom-a"]);
    expect(again.list[0]).toEqual({ id: "custom-b", name: "beta", columns: ["a", "b"] });
  });

  it("drops the one used longest ago past the limit, and says which", () => {
    const full = Array.from({ length: SAVED_CUSTOM_MAX }, (_, i) => saved(`n${i}`, `N${i}`));
    const next = withSavedFormat(full, { name: "New", columns: ["A", "B"] }, () => "custom-new");
    expect(next.list).toHaveLength(SAVED_CUSTOM_MAX);
    expect(next.list[0].id).toBe("custom-new");
    expect(next.dropped).toEqual([full[SAVED_CUSTOM_MAX - 1]]);
    // A list one past the limit (after an Undo) gives back to 12, naming both.
    const over = [...full, saved("x", "X")];
    expect(withSavedFormat(over, { name: "New", columns: ["A", "B"] }).dropped).toEqual([
      full[SAVED_CUSTOM_MAX - 1],
      saved("x", "X"),
    ]);
  });

  it("moves a picked format to the front", () => {
    const list = [saved("a"), saved("b"), saved("c")];
    expect(savedFirst(list, "custom-c").map((f) => f.id)).toEqual([
      "custom-c",
      "custom-a",
      "custom-b",
    ]);
    expect(savedFirst(list, "custom-zz")).toEqual(list);
  });

  it("puts a deleted format back where it was, whatever came in since", () => {
    const [a, b, c] = [saved("a"), saved("b"), saved("c")];
    const before = [a, b, c];
    const ids = (l: SavedCustomFormat[]) => l.map((f) => f.id.slice(7));
    expect(ids(withRestoredFormat([a, c], b, before))).toEqual(["a", "b", "c"]);
    // A format saved in front meanwhile stays in front, and nothing drops off.
    const full = Array.from({ length: SAVED_CUSTOM_MAX }, (_, i) => saved(`n${i}`));
    const back = withRestoredFormat([saved("new"), a, c, ...full.slice(3)], b, before);
    expect(ids(back).slice(0, 4)).toEqual(["new", "a", "b", "c"]);
    expect(back).toHaveLength(SAVED_CUSTOM_MAX + 1);
    // The last one goes back at the end; one already back stays put.
    expect(ids(withRestoredFormat([a, b], c, before))).toEqual(["a", "b", "c"]);
    expect(withRestoredFormat(before, b, before)).toEqual(before);
  });

  it("allows as many columns as the picker offers", () => {
    expect(CUSTOM_COLUMNS_MAX).toBe(6);
  });
});
