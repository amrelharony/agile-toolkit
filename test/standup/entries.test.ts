import { describe, expect, it } from "vitest";
import {
  allStandupEntries,
  entryFor,
  fromAsyncUpdate,
  isLegacyAsyncUpdate,
  notPostedYet,
  previousEntry,
  standupDigest,
  standupMode,
} from "@/lib/standup/entries";
import type { AsyncUpdate, StandupEntry } from "@/lib/stores/workspace-types";

/** Live and async standups share StandupEntry; old async updates read alongside. */

const entry = (id: string, over: Partial<StandupEntry> = {}): StandupEntry => ({
  id,
  member: "Alice",
  date: "2026-10-23",
  yesterday: "",
  today: "",
  blockers: "",
  timestamp: 1,
  ...over,
});

const update = (id: string, over: Partial<AsyncUpdate> = {}): AsyncUpdate => ({
  id,
  member: "Bo",
  date: "2026-10-23",
  yesterday: "Reviewed PRs",
  today: "Pair on checkout",
  ...over,
});

describe("modes", () => {
  it("reads a missing mode as live", () => {
    expect(standupMode(entry("e"))).toBe("live");
    expect(standupMode(entry("e", { mode: "async" }))).toBe("async");
  });

  it("reads an old async update as an async entry under its id", () => {
    expect(fromAsyncUpdate(update("u", { description: " notes " }))).toEqual({
      id: "u",
      member: "Bo",
      date: "2026-10-23",
      yesterday: "Reviewed PRs",
      today: "Pair on checkout",
      blockers: "",
      timestamp: Date.parse("2026-10-23T12:00:00Z"),
      mode: "async",
      description: "notes",
    });
  });

  it("merges both, an entry with the same id winning over the old update", () => {
    const merged = allStandupEntries(
      [entry("e1"), entry("u1", { mode: "async", today: "Edited" })],
      [update("u1"), update("u2")]
    );
    expect(merged.map((e) => [e.id, e.today])).toEqual([
      ["e1", ""],
      ["u1", "Edited"],
      ["u2", "Pair on checkout"],
    ]);
    expect(isLegacyAsyncUpdate("u2", [entry("u1")], [update("u2")])).toBe(true);
    expect(isLegacyAsyncUpdate("u1", [entry("u1")], [update("u1")])).toBe(false);
    expect(allStandupEntries(undefined, undefined)).toEqual([]);
  });
});

describe("per person", () => {
  const list = [
    entry("a1", { date: "2026-10-21", today: "Spike", timestamp: 1 }),
    entry("a2", { date: "2026-10-22", today: "Build the form", timestamp: 2 }),
    entry("a3", { date: "2026-10-23", today: "Ship it", timestamp: 3 }),
    entry("b1", { member: "Bo", date: "2026-10-22", today: "Tests" }),
  ];

  it("finds one entry per person per day, ignoring case and spaces", () => {
    expect(entryFor(list, " alice ", "2026-10-22")?.id).toBe("a2");
    expect(entryFor(list, "Kim", "2026-10-22")).toBeUndefined();
  });

  it("finds the latest entry before a day, for prefilling yesterday", () => {
    expect(previousEntry(list, "Alice", "2026-10-23")?.today).toBe("Build the form");
    expect(previousEntry(list, "Alice", "2026-10-21")).toBeUndefined();
  });

  it("lists who hasn't posted yet, in roster order", () => {
    expect(notPostedYet(list, ["Bo", "Alice", "Kim", " "], "2026-10-22")).toEqual(["Kim"]);
  });
});

describe("digest", () => {
  it("groups by person with blockers first", () => {
    const md = standupDigest(
      [
        entry("a", { today: "Ship it", blockers: "Waiting on\nkeys" }),
        entry("b", { member: "Bo", yesterday: "Tests", description: "Off Friday" }),
        entry("c", { date: "2026-10-22", today: "Other day" }),
      ],
      "2026-10-23"
    );
    expect(md).toBe(
      [
        "# Standup — 2026-10-23",
        "",
        "## Blockers",
        "- **Alice**: Waiting on keys",
        "",
        "## Alice",
        "- **Today**: Ship it",
        "- **Blockers**: Waiting on keys",
        "",
        "## Bo",
        "- **Yesterday**: Tests",
        "- Off Friday",
      ].join("\n")
    );
    expect(standupDigest([], "2026-10-23")).toBe("# Standup — 2026-10-23\n\nNo updates posted.");
  });
});
