import { describe, expect, it } from "vitest";
import {
  allStandupEntries,
  entryFor,
  fromAsyncUpdate,
  isLegacyAsyncUpdate,
  nextPlace,
  notPostedYet,
  postedEntry,
  previousEntry,
  shiftChain,
  standupDigest,
  standupMode,
} from "@/lib/standup/entries";
import type { AsyncUpdate, StandupEntry } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { standupPlaces } from "@/lib/team-time/sun";

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

describe("digest: formats, DRIs, hand-overs and places", () => {
  const SYDNEY = { label: "Sydney", zone: "Australia/Sydney" };
  const LONDON = { label: "London office", zone: "Europe/London" };
  const TORONTO = { label: "Toronto", zone: "America/Toronto" };
  const places = new Map([
    [nameKey("Tom"), TORONTO],
    [nameKey("Lou"), LONDON],
    [nameKey("Sky"), SYDNEY],
  ]);

  it("prints Progress, Plans and Problems, and Problems as the heading only when every update is one", () => {
    const ppp = { format: "ppp" as const };
    const all = standupDigest(
      [
        entry("a", {
          ...ppp,
          yesterday: "Spike",
          today: "Build",
          blockers: "Keys",
          blockerDri: "Bo",
        }),
      ],
      "2026-10-23"
    );
    expect(all).toBe(
      [
        "# Standup — 2026-10-23",
        "",
        "## Problems",
        "- **Alice**: Keys (DRI: Bo)",
        "",
        "## Alice",
        "- **Progress**: Spike",
        "- **Plans**: Build",
        "- **Problems**: Keys (DRI: Bo)",
      ].join("\n")
    );
    const mixed = standupDigest(
      [entry("a", { ...ppp, blockers: "Keys" }), entry("b", { member: "Bo", today: "Tests" })],
      "2026-10-23"
    );
    expect(mixed).toContain("## Blockers\n- **Alice**: Keys");
    expect(mixed).toContain("## Bo\n- **Today**: Tests");
  });

  it("lists hand-overs after the blockers, from the poster's place to the next one", () => {
    const md = standupDigest(
      [
        entry("t", { member: "Tom", today: "Ship", handoff: "Watch the deploy" }),
        entry("l", { member: "Lou", today: "Review", blockers: "Review queue", blockerDri: "Tom" }),
        entry("s", { member: "Sky", today: "Test", handoff: "Build is\non staging" }),
        entry("n", { member: "Nadia", today: "Docs", handoff: "Docs need a look" }),
      ],
      "2026-10-23",
      { places }
    );
    const lines = md.split("\n");
    expect(lines.slice(0, 11)).toEqual([
      "# Standup — 2026-10-23",
      "",
      "## Blockers",
      "- **Lou**: Review queue (DRI: Tom)",
      "",
      "## Hand-overs",
      "- **Tom**, Toronto → Sydney: Watch the deploy",
      "- **Sky**, Sydney → London office: Build is on staging",
      "- **Nadia**: Docs need a look",
      "",
      "## Sky",
    ]);
    // East to west, and anyone with no place after, in their own order.
    const order = lines.filter((l) => l.startsWith("## ") && !/Blockers|Hand-overs/.test(l));
    expect(order).toEqual(["## Sky", "## Lou", "## Tom", "## Nadia"]);
  });

  it("makes the places on one clock one shift, so a hand-over always goes to a later clock", () => {
    // Priya's site and Tom's zone city: two labels, one clock.
    const londonOnly = new Map([
      [nameKey("Priya"), LONDON],
      [nameKey("Tom"), { label: "London", zone: "Europe/London" }],
    ]);
    const one = shiftChain(londonOnly, "2026-10-23");
    expect(one.map((s) => s.label)).toEqual(["London office / London"]);
    expect(nextPlace(one, LONDON)).toBeNull();
    const md = standupDigest(
      [
        entry("p", { member: "Priya", today: "Ship", handoff: "Watch the deploy" }),
        entry("t", { member: "Tom", today: "Review" }),
      ],
      "2026-10-23",
      { places: londonOnly }
    );
    expect(md).toContain("## Hand-overs\n- **Priya**: Watch the deploy");
    expect(md).not.toContain("→");
    // Berlin and Paris share an offset: one shift, after Sydney, before London.
    const BERLIN = { label: "Berlin", zone: "Europe/Berlin" };
    const PARIS = { label: "Paris", zone: "Europe/Paris" };
    const team = new Map([
      [nameKey("Ben"), BERLIN],
      [nameKey("Pia"), PARIS],
      [nameKey("Sky"), SYDNEY],
      [nameKey("Lou"), LONDON],
    ]);
    const chain = shiftChain(team, "2026-10-23");
    expect(chain.map((s) => s.label)).toEqual(["Sydney", "Berlin / Paris", "London office"]);
    expect(chain[1].places).toEqual([BERLIN, PARIS]);
    expect(nextPlace(chain, BERLIN)?.label).toBe("London office");
    expect(nextPlace(chain, PARIS)?.label).toBe("London office");
    expect(nextPlace(chain, SYDNEY)?.label).toBe("Berlin / Paris");
    const routed = standupDigest(
      [
        entry("b", { member: "Ben", handoff: "Over to you" }),
        entry("s", { member: "Sky", handoff: "Build is green" }),
      ],
      "2026-10-23",
      { places: team }
    );
    expect(routed).toContain("- **Ben**, Berlin → London office: Over to you");
    expect(routed).toContain("- **Sky**, Sydney → Berlin / Paris: Build is green");
  });

  it("keeps today's order with fewer than two places known, and the old text without the new fields", () => {
    const one = new Map([[nameKey("Tom"), TORONTO]]);
    const day = [
      entry("b", { member: "Bo", today: "B" }),
      entry("t", { member: "Tom", today: "T" }),
    ];
    expect(standupDigest(day, "2026-10-23", { places: one })).toBe(
      standupDigest(day, "2026-10-23")
    );
    expect(standupDigest(day, "2026-10-23", { places })).toBe(
      standupDigest(day, "2026-10-23").replace(
        "## Bo\n- **Today**: B\n\n## Tom\n- **Today**: T",
        "## Tom\n- **Today**: T\n\n## Bo\n- **Today**: B"
      )
    );
  });

  it("gives the Standup's own example the Team Time example's places, and real rows win", () => {
    const example = [
      entry("example-1", { member: "Lee (iOS)", today: "x" }),
      entry("example-2", { member: "Priya (PM)", today: "y" }),
    ];
    const fromExample = standupPlaces([], [], example);
    expect(fromExample.get(nameKey("Lee (iOS)"))?.label).toBe("Sydney");
    expect(fromExample.get(nameKey("Priya (PM)"))?.label).toBe("London office");
    // A real entry from the same name: no example place.
    const real = standupPlaces([], [], [...example, entry("real-1", { member: "Lee (iOS)" })]);
    expect(real.has(nameKey("Lee (iOS)"))).toBe(false);
    const md = standupDigest(
      [...example.slice(0, 1), entry("example-3", { member: "Priya (PM)", handoff: "Go" })],
      "2026-10-23",
      { places: fromExample }
    );
    expect(md).toContain("- **Priya (PM)**, London office → Sydney: Go");
  });

  it("posts the new fields only when set: the DRI only with a blocker, a classic post as before", () => {
    const base = { member: "Al", date: "2026-10-23", yesterday: "y", today: "t" };
    expect(postedEntry(undefined, base, "async", "id1", 5)).toEqual({
      id: "id1",
      member: "Al",
      date: "2026-10-23",
      yesterday: "y",
      today: "t",
      blockers: "",
      timestamp: 5,
      mode: "async",
    });
    const full = postedEntry(
      undefined,
      { ...base, blockers: "Keys", format: "ppp", dri: " Bo ", handoff: " Over to you " },
      "async",
      "id2",
      5
    );
    expect(full).toMatchObject({ format: "ppp", blockerDri: "Bo", handoff: "Over to you" });
    const noBlocker = postedEntry(
      undefined,
      { ...base, format: "classic", dri: "Bo" },
      "async",
      "id3",
      5
    );
    expect(noBlocker).not.toHaveProperty("blockerDri");
    expect(noBlocker).not.toHaveProperty("format");
  });
});
