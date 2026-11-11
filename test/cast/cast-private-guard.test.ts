/**
 * The bible's private canon never enters the repo through the cast puppets: no
 * private canon key in any cast file, and no colour in the cast data but the two
 * flat background keys. The guard is proved on a fixture first.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PRIVATE_FIELDS } from "../vip/private-fields";

const ROOT = path.join(__dirname, "../..");
const KEY_HEXES = new Set(["#FF00FF", "#00FF00"]);

/** Cast files that hold data (hex colours there would be canon). */
const DATA_DIRS = ["docs/cast", "src/lib/cast", "src/components/cast"];
/** Cast code, where only canon keys are checked (UI colours are fine there). */
const CODE = ["scripts/cast", "scripts/build-cast-brief.mjs", "scripts/build-cast-rigs.py"];

function walk(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
}

function privateKeys(text: string): string[] {
  return PRIVATE_FIELDS.filter((f) => new RegExp(`["']${f}["']\\s*:`).test(text));
}

function canonHexes(text: string): string[] {
  return (text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter((h) => !KEY_HEXES.has(h.toUpperCase()));
}

describe("the guard itself", () => {
  it("catches a canon key and a canon colour, and passes the flat keys", () => {
    const fixture = `{ "name": "Fixture Fox", "palette": { "fur": "#A65F31" }, "lanyard": "navy", "key": "#FF00FF" }`;
    expect(privateKeys(fixture)).toEqual(["palette", "lanyard"]);
    expect(canonHexes(fixture)).toEqual(["#A65F31"]);
    expect(privateKeys(`the tie, the lanyard and the blank ID card`)).toEqual([]);
    expect(canonHexes(`background #ff00ff or #00FF00`)).toEqual([]);
  });
});

describe("the cast files", () => {
  const data = DATA_DIRS.flatMap(walk);
  const code = CODE.flatMap(walk);

  it("exist where the plan puts them", () => {
    expect(data).toContain(path.join("docs", "cast", "cast-rig.json"));
    expect(code.length).toBeGreaterThan(0);
  });

  it("hold no private canon key", () => {
    for (const f of [...data, ...code]) {
      expect(privateKeys(readFileSync(path.join(ROOT, f), "utf8")), f).toEqual([]);
    }
  });

  it("hold no colour but the two flat background keys", () => {
    for (const f of data) {
      expect(canonHexes(readFileSync(path.join(ROOT, f), "utf8")), f).toEqual([]);
    }
  });
});
