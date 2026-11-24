/**
 * Only a fixed list of canon fields reaches Meet the Cast. Checked twice: on a
 * committed fixture full of marked private values (the real canon stays out of
 * the repo), and on the module that's actually committed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CAST_FIELDS,
  HOOK_FIELDS,
  pickCast,
  renderCastModule,
} from "../../scripts/cast-whitelist.mjs";
import { CAST } from "@/lib/vip/cast.generated";
import { castAnchor, filterCast, hookTargets } from "@/lib/vip/cast";
import { PRIVATE_FIELDS } from "./private-fields";

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/canon-fixture.json"), "utf8")
);

const CARD_KEYS = [...CAST_FIELDS, "relationship_hooks"].sort();
const HOOK_KEYS = [...HOOK_FIELDS].sort();

describe("pickCast", () => {
  const cards = pickCast(fixture);

  it("keeps the listed fields, in the bible's own words", () => {
    expect(cards[0]).toEqual({
      id: "AAW-91",
      name: "Fixture Fox",
      human_want: "Public want of the fox.",
      strength: "Public strength of the fox.",
      overused_strength: "Public overuse of the fox.",
      relationship_hooks: [
        {
          with: "Fixture Owl or Fixture Hen",
          collision: "Public collision.",
          advance: "Public advance.",
        },
      ],
    });
  });

  it("keeps nothing private, a field added later included", () => {
    expect(JSON.stringify(cards)).not.toContain("PRIVATE");
    expect(renderCastModule(cards)).not.toContain("PRIVATE");
    for (const field of PRIVATE_FIELDS) {
      expect(renderCastModule(cards)).not.toContain(`"${field}"`);
    }
  });

  it("gives a hook with no advance a blank one", () => {
    expect(cards[1].relationship_hooks[0].advance).toBe("");
  });

  it("refuses a canon with no cast or a card with a field missing", () => {
    expect(() => pickCast({})).toThrow(/no cast list/);
    expect(() => pickCast({ cast: [{ id: "AAW-1", name: "No text" }] })).toThrow(/human_want/);
  });

  it("writes a server-only module", () => {
    expect(renderCastModule(cards)).toContain('import "server-only"');
  });
});

describe("the committed cast", () => {
  it("has the 30 colleagues", () => {
    expect(CAST).toHaveLength(30);
    expect(new Set(CAST.map((c) => c.id)).size).toBe(30);
    expect(new Set(CAST.map((c) => c.name)).size).toBe(30);
  });

  it("carries the listed fields and no others", () => {
    for (const card of CAST) {
      expect(Object.keys(card).sort(), card.id).toEqual(CARD_KEYS);
      for (const hook of card.relationship_hooks) {
        expect(Object.keys(hook).sort(), card.id).toEqual(HOOK_KEYS);
      }
    }
    const source = readFileSync(path.join(process.cwd(), "src/lib/vip/cast.generated.ts"), "utf8");
    for (const field of PRIVATE_FIELDS) expect(source).not.toMatch(new RegExp(`\\b${field}:`));
  });

  it("uses current names only", () => {
    const names = CAST.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Dependable Beaver",
        "Zombie Backlog",
        "Agile Sticky",
        "Meeting Monkey",
      ])
    );
    const text = JSON.stringify(CAST);
    for (const retired of [
      "Definition-of-Done Beaver",
      "DoD Beaver",
      "Tired Zombie",
      "Retired Zombie",
      "Sticky Note",
      "Legacy Dinosaur",
      "Legacy Mode Dinosaur",
    ]) {
      expect(text, retired).not.toContain(retired);
    }
  });

  it("links every relationship to at least one card", () => {
    for (const card of CAST) {
      expect(card.relationship_hooks.length, card.id).toBeGreaterThan(0);
      for (const hook of card.relationship_hooks) {
        expect(hookTargets(hook, CAST).length, `${card.name} → ${hook.with}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("card helpers", () => {
  it("links both names of a choice", () => {
    const badger = CAST.find((c) => c.name === "Assurance Badger")!;
    const targets = hookTargets(badger.relationship_hooks[0], CAST).map((c) => c.name);
    expect(targets).toEqual(["Automation Raccoon", "Overengineering Octopus"]);
  });

  it("filters by name, ignoring case and spaces", () => {
    expect(filterCast(CAST, "  beaver ").map((c) => c.name)).toEqual(["Dependable Beaver"]);
    expect(filterCast(CAST, "")).toHaveLength(30);
    expect(filterCast(CAST, "nobody")).toEqual([]);
    // By name only: searching the bible's words isn't the point of the filter.
    expect(filterCast(CAST, "colleagues")).toEqual([]);
  });

  it("anchors stay stable and lower-case", () => {
    expect(castAnchor("AAW-04")).toBe("cast-aaw-04");
  });
});
