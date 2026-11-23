/**
 * The expansion scenes X001–X124 (docs/mascot/expansion-sheets.json): the spec, the
 * small tables the site reads, and the scenes made from them.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import spec from "../../docs/mascot/expansion-sheets.json";
import record from "../../docs/mascot/refined-expansion-release.json";
import context from "../../docs/mascot/context-sheets.json";
import companion from "../../docs/mascot/companion-scenes.json";
import { FRAMES, type FrameId } from "@/components/agent/mascot/mascot-packs";
import { EXPANSION_SHEETS } from "@/components/agent/mascot/engine/expansion-table";
import { EXPANSION_TITLES } from "@/components/agent/mascot/engine/expansion-titles";
import { EVENT_SCENES, HOLD_SCENES, SCENES } from "@/components/agent/mascot/engine/scenes";
import { shippedScene } from "@/components/agent/mascot/engine/sprite-poses";

const FAMILIES = ["reading", "tools", "team", "cast", "guides", "play"];
const RECORD: Record<string, { file: string; sha256: string }> = record.sheets;

/** The beat a sheet ends and holds on: its last, or an earlier one while its last is drawn wrong. */
const lastOf = (s: { last?: number }) => s.last ?? 8;

describe("the expansion spec", () => {
  it("holds X001 to X124 in order, each its own pack x001 to x124", () => {
    expect(spec.sheets.map((s) => s.id)).toEqual(
      Array.from({ length: 124 }, (_, i) => `X${String(i + 1).padStart(3, "0")}`)
    );
    for (const s of spec.sheets) expect(s.pack).toBe(`x${s.id.slice(1)}`);
  });

  it("gives every sheet eight beats, a family, its trigger and loop rules", () => {
    for (const s of spec.sheets) {
      expect(
        s.slots.map((x) => x.id),
        s.id
      ).toEqual(Array.from({ length: 8 }, (_, i) => `${s.pack}.${i + 1}`));
      expect(FAMILIES, s.id).toContain(s.family);
      expect(s.trigger.length, s.id).toBeGreaterThan(10);
      expect(s.loop.length, s.id).toBeGreaterThan(5);
    }
  });

  it("names the very file that was taken in for each sheet, by its hash", () => {
    expect(Object.keys(RECORD).sort()).toEqual(spec.sheets.map((s) => s.id));
    for (const s of spec.sheets) {
      expect(s.sha256, s.id).toBe(RECORD[s.id].sha256);
      expect(s.file, s.id).toBe(RECORD[s.id].file);
    }
  });

  it("ends a sheet early only on an earlier beat, and says why", () => {
    for (const s of spec.sheets as Array<{ id: string; last?: number; last_why?: string }>) {
      if (s.last === undefined) continue;
      expect(s.last, s.id).toBeGreaterThanOrEqual(4);
      expect(s.last, s.id).toBeLessThan(8);
      expect(s.last_why?.length ?? 0, s.id).toBeGreaterThan(10);
    }
  });

  it("shares no pack name with a context or companion sheet", () => {
    const others = new Set([...context.sheets, ...companion.sheets].map((s) => s.pack));
    expect(spec.sheets.filter((s) => others.has(s.pack))).toEqual([]);
  });

  it("is what the site's tables say (scripts/build-expansion-spec.py writes them all)", () => {
    expect(
      EXPANSION_SHEETS.map(({ id, pack, family, last }) => ({ id, pack, family, last }))
    ).toEqual(
      spec.sheets.map((s) => ({
        id: s.id,
        pack: s.pack,
        family: s.family,
        last: (s as { last?: number }).last,
      }))
    );
    expect(EXPANSION_TITLES).toEqual(Object.fromEntries(spec.sheets.map((s) => [s.pack, s.title])));
  });

  it("puts each sheet's beats in its pack's cells in slot order", () => {
    for (const s of spec.sheets) {
      expect(
        s.slots.map((x) => FRAMES[x.id as FrameId]),
        s.id
      ).toEqual(s.slots.map((_, i) => [s.pack, i]));
    }
  });
});

describe("the expansion scenes", () => {
  it("play each sheet's beats in order and hold the last of them, which is also the still", () => {
    for (const s of spec.sheets) {
      const c = SCENES[s.pack];
      const last = lastOf(s as { last?: number });
      expect(c, s.pack).toBeDefined();
      expect(
        c.steps.map((st) => st.f),
        s.pack
      ).toEqual(s.slots.slice(0, last).map((x) => x.id));
      expect(c.steps.at(-1)?.ms, s.pack).toBe(1600);
      expect(c.still, s.pack).toBe(`${s.pack}.${last}`);
      expect(c.loop, s.pack).toBeUndefined();
    }
  });

  it("stand in with a pose that makes no gesture while a pack loads", () => {
    // The review pose's thumbs-up would read as a pass these scenes' rules forbid.
    for (const s of spec.sheets) expect(SCENES[s.pack].fallback, s.pack).not.toBe("review");
    expect(SCENES["x112.filter"].fallback).not.toBe("review");
  });

  it("end the search guide on its fifth beat, the explanatory filter moment", () => {
    expect(SCENES["x112.filter"].steps.map((st) => st.f)).toEqual(
      ["1", "2", "3", "4", "5"].map((n) => `x112.${n}`)
    );
    expect(SCENES["x112.filter"].still).toBe("x112.5");
  });

  it("hold the presentation guide's last pose while a presentation lasts", () => {
    const c = SCENES["x111.present"];
    expect(HOLD_SCENES["x111.present"]).toBe("calm");
    expect(c.loop?.map((st) => st.f)).toEqual(["x111.8"]);
    expect(c.still).toBe("x111.8");
  });
});

/** Every source file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.(ts|tsx)$/.test(name) ? [file] : [];
  });
}

/** Each sheet's "Plays on" cell in docs/mascot/expansion-triggers.md, by id. */
function playsOn(): Record<string, string> {
  const doc = readFileSync(join(process.cwd(), "docs", "mascot", "expansion-triggers.md"), "utf-8");
  const cells: Record<string, string> = {};
  for (const m of Array.from(
    doc.matchAll(/^\|\s*(X\d{3}) `x\d{3}`\s*\|[^|]*\|[^|]*\|\s*([^|]*?)\s*\|\s*$/gm)
  )) {
    cells[m[1]] = m[2];
  }
  return cells;
}

describe("where the expansion scenes play", () => {
  it("is recorded for every sheet in docs/mascot/expansion-triggers.md", () => {
    expect(Object.keys(playsOn())).toEqual(spec.sheets.map((s) => s.id));
  });

  it("is only where that record says: no code names a scene it lists as playing on nothing", () => {
    // The scene table and its generated files hold every scene; anywhere else, a
    // named scene is a binding, so its sheet's record must say what it plays on.
    const root = join(process.cwd(), "src");
    const tables = new Set([
      "components/agent/mascot/engine/scenes.ts",
      "components/agent/mascot/engine/expansion-table.ts",
      "components/agent/mascot/engine/expansion-titles.ts",
      "components/agent/mascot/engine/scene-thumbs.ts",
      "components/agent/mascot/mascot-packs.ts",
    ]);
    const record = playsOn();
    const unrecorded: string[] = [];
    for (const file of sources(root)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (tables.has(rel)) continue;
      const text = readFileSync(file, "utf-8");
      for (const m of Array.from(text.matchAll(/["'`](x\d{3})(?:\.[a-z0-9-]+)?["'`]/g))) {
        const id = `X${m[1].slice(1)}`;
        if (!record[id] || record[id] === "—") unrecorded.push(`${rel}: ${m[0]}`);
      }
    }
    expect(unrecorded).toEqual([]);
  });

  it("records what each real-event scene plays on, and each of them ships", () => {
    // EVENT_SCENES sits in the scene table, which the scan above leaves out.
    const record = playsOn();
    for (const [event, name] of Object.entries(EVENT_SCENES)) {
      const id = `X${name.slice(1, 4)}`;
      expect(record[id], `${event}: ${name}`).toBeDefined();
      expect(record[id], `${event}: ${name}`).not.toBe("—");
      expect(shippedScene(name), `${event}: ${name}`).toBeDefined();
    }
  });

  it("cuts a real event's variant short, before the beats that would claim more", () => {
    const variants: Record<string, number> = {
      // Waiting for approval: the pen capped, the page not presented.
      "x016.sent": 7,
      // Kept, maybe counted: the card brought to the slot, never dropped in, no thumbs-up;
      // beat 5, since beat 6 is drawn wrong (AMR-EXPANSION-FIX-1.md).
      "x017.card": 5,
      // A test created hasn't run: the cart back at the start, before it crosses.
      "x095.setup": 6,
    };
    for (const [name, last] of Object.entries(variants)) {
      const pack = name.split(".")[0];
      const c = SCENES[name];
      expect(
        c.steps.map((st) => st.f),
        name
      ).toEqual(SCENES[pack].steps.slice(0, last).map((st) => st.f));
      expect(c.steps.at(-1)?.ms, name).toBe(1600);
      expect(c.still, name).toBe(`${pack}.${last}`);
      expect(c.loop, name).toBeUndefined();
      expect(c.fallback, name).not.toBe("review");
    }
    expect(EVENT_SCENES.guestbook).toBe("x016.sent");
    expect(EVENT_SCENES.feedback).toBe("x017.card");
  });

  it("leaves the presentation and search guides to the visitor's asking", () => {
    const record = playsOn();
    expect(record.X111).toBe("—");
    expect(record.X112).toBe("—");
    const bound = Object.values(EVENT_SCENES).map((s) => s.split(".")[0]);
    expect(bound).not.toContain("x111");
    expect(bound).not.toContain("x112");
  });
});
