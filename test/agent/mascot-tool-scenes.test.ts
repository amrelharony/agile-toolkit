/**
 * Amr's tool table (context/tool-scenes.ts): every row is a real tool, every
 * action one that tool logs (or, for his cheer and dance, one it asks for
 * with cheer()), every scene one its sheet asks for, and opening a tool greets
 * you with its props once those are drawn.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import spec from "../../docs/mascot/context-sheets.json";
import expansion from "../../docs/mascot/expansion-sheets.json";
import * as catalogs from "@/lib/history/event-actions";
import { tools } from "@/lib/constants/tools";
import {
  EMITTED,
  TOOL_SCENES,
  toolActionScenes,
  toolForPath,
  toolPageScenes,
} from "@/lib/agent/mascot/context/tool-scenes";
import { momentsNow, TOOL_PRIORITY } from "@/lib/agent/mascot/context/moments";
import { CHEER_MOMENTS } from "@/lib/agent/mascot/tool-moments";
import { cheerMoment, type CheerReason } from "@/lib/celebrate/cheer";
import { SCENES } from "@/components/agent/mascot/engine/scenes";
import { PACKS } from "@/components/agent/mascot/mascot-packs";

/** Moments nothing logs: the timer watch, the vote rooms and emitted sounds announce them. */
const UNLOGGED = new Set(["timer_finished", ...Array.from(EMITTED)]);
const loggedActions = (t: (typeof TOOL_SCENES)[number]) =>
  Object.keys(t.actions).filter((a) => !UNLOGGED.has(a));

/** The tool sheets S65 on, and the expansion's: the tool lab X025–X056 is the More shelf's. */
const sheetPacks = new Set([...spec.sheets, ...expansion.sheets].map((s) => s.pack));
const packOf = (scene: string) => scene.split(".")[0];
const toolLab = expansion.sheets.filter((s) => s.family === "tools");
const expansionPacks = new Set(expansion.sheets.map((s) => s.pack));

/** Every catalog value in event-actions.ts. */
const catalogued = new Set(
  Object.entries(catalogs)
    .filter(([name, v]) => name.endsWith("_ACTIONS") && v && typeof v === "object")
    .flatMap(([, v]) => Object.values(v as Record<string, string>))
);

function readTree(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out.join("\n");
}

/**
 * A tool's source, to check it really logs an action, with the code it logs
 * through: another tool's client its page opens (DACI is the Decision Log in
 * the DACI form) and the shared prioritization method tool.
 */
function toolSource(toolId: string): string {
  const src = join(process.cwd(), "src");
  const own = readTree(join(src, "app", "(tools)", toolId));
  const parts = [own];
  for (const m of Array.from(own.matchAll(/from "@\/app\/\(tools\)\/([a-z0-9-]+)\//g))) {
    if (m[1] !== toolId) parts.push(readTree(join(src, "app", "(tools)", m[1])));
  }
  if (own.includes("@/components/prioritization/")) {
    parts.push(readTree(join(src, "components", "prioritization")));
  }
  return parts.join("\n");
}

const CHEERS: ReadonlySet<string> = new Set(Object.values(CHEER_MOMENTS));
const REASONS: readonly CheerReason[] = ["result", "agreed", "done", "milestone"];

/**
 * The cheer moments a source announces: each `cheer(tool, reason)` call
 * (lib/celebrate/cheer.ts) gives the one its reason leads to, and a call with
 * no reason the default "done"'s. A reason chosen at run time may be any.
 */
function cheerMomentsIn(source: string): Set<string> {
  const out = new Set<string>();
  for (const [, args] of Array.from(source.matchAll(/\bcheer\(([^()]*)\)/g))) {
    const reason = args
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)[1];
    const literal = REASONS.find((r) => reason === `"${r}"`);
    if (reason === undefined || reason === "undefined") out.add(cheerMoment("done"));
    else if (literal) out.add(cheerMoment(literal));
    else for (const m of Array.from(CHEERS)) out.add(m);
  }
  return out;
}

describe("the tool table", () => {
  it("lists each tool once, and only tools the site has at /<id>", () => {
    const ids = TOOL_SCENES.map((t) => t.toolId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const tool = tools.find((t) => t.id === id);
      expect(tool, id).toBeDefined();
      expect(tool!.path, id).toBe(`/${id}`);
    }
  });

  it("covers the 50 tool sheets, each sheet's pack in some row", () => {
    const toolSheets = spec.sheets.filter((s) => s.group.startsWith("tools-"));
    expect(toolSheets).toHaveLength(50);
    const used = new Set(
      TOOL_SCENES.flatMap((t) => [...t.open, ...Object.values(t.actions).flat()]).map(packOf)
    );
    expect(toolSheets.filter((s) => !used.has(s.pack)).map((s) => s.sheet)).toEqual([]);
  });

  // It reads every listed tool's source, which can take several seconds on a
  // loaded runner (CI's shards, or the full suite with several workers).
  it("names only actions in the catalog, each one its tool logs", { timeout: 20_000 }, () => {
    const notCatalogued: string[] = [];
    const notLogged: string[] = [];
    for (const t of TOOL_SCENES) {
      const source = toolSource(t.toolId);
      for (const action of loggedActions(t)) {
        if (!catalogued.has(action)) notCatalogued.push(`${t.toolId}: ${action}`);
        const key = action.toUpperCase();
        if (!source.includes(`.${key}`) && !source.includes(`"${action}"`)) {
          notLogged.push(`${t.toolId}: ${action}`);
        }
      }
    }
    expect(notCatalogued).toEqual([]);
    expect(notLogged).toEqual([]);
  });

  it("reads which of Amr's celebrations a tool's cheer() call asks for", () => {
    expect(cheerMomentsIn('cheer("picker");')).toEqual(new Set([CHEER_MOMENTS.cheer]));
    expect(cheerMomentsIn('cheer("quick-vote", "agreed")')).toEqual(new Set([CHEER_MOMENTS.cheer]));
    expect(cheerMomentsIn('cheer(\n  TOOL_ID,\n  "milestone",\n  { sound: true }\n)')).toEqual(
      new Set([CHEER_MOMENTS.dance])
    );
    expect(cheerMomentsIn("cheer(TOOL_ID, reason)")).toEqual(CHEERS);
    expect(cheerMomentsIn('import { cheer } from "@/lib/celebrate/cheer"; cheerful(1)')).toEqual(
      new Set()
    );
  });

  it("gives Amr's cheer or dance a scene only in a tool whose cheer() asks for it", () => {
    // Emitted, so the logged-action check above leaves them to this one.
    for (const m of Array.from(CHEERS)) expect(EMITTED.has(m), m).toBe(true);
    const unasked: string[] = [];
    for (const t of TOOL_SCENES) {
      const named = Object.keys(t.actions).filter((a) => CHEERS.has(a));
      if (named.length === 0) continue;
      const asked = cheerMomentsIn(toolSource(t.toolId));
      for (const m of named) if (!asked.has(m)) unasked.push(`${t.toolId}: ${m}`);
    }
    expect(unasked).toEqual([]);
  });

  it("names scenes from the sheets, and every one already built exists", () => {
    for (const t of TOOL_SCENES) {
      for (const scene of toolPageScenes(`/${t.toolId}`)) {
        expect(sheetPacks.has(packOf(scene)), `${t.toolId}: ${scene}`).toBe(true);
        if (packOf(scene) in PACKS) expect(SCENES[scene], `${t.toolId}: ${scene}`).toBeDefined();
      }
    }
  });

  it("gives each tool sheet's tool a greeting with its own props", () => {
    for (const s of spec.sheets.filter((x) => x.group.startsWith("tools-"))) {
      const row = TOOL_SCENES.find((t) => t.open.some((o) => packOf(o) === s.pack));
      expect(row, `${s.sheet} (${s.pack})`).toBeDefined();
    }
  });

  it("greets on each More-shelf tool with its own tool-lab sheet, X025 to X056", () => {
    expect(toolLab.map((s) => s.id)).toEqual(
      Array.from({ length: 32 }, (_, i) => `X${String(i + 25).padStart(3, "0")}`)
    );
    for (const s of toolLab) {
      expect(
        TOOL_SCENES.some((t) => t.open.some((o) => packOf(o) === s.pack)),
        s.id
      ).toBe(true);
      // The sheet's own tool, and its first open scene: the once-a-day greeting.
      const row = TOOL_SCENES.find((t) => `/${t.toolId}` === s.routes[0]);
      expect(row, `${s.id} ${s.routes[0]}`).toBeDefined();
      expect(packOf(row!.open[0] ?? ""), s.id).toBe(s.pack);
      // Nowhere else: another tool's page doesn't stand for this one's event.
      const elsewhere = TOOL_SCENES.filter(
        (t) => t !== row && toolPageScenes(`/${t.toolId}`).some((x) => packOf(x) === s.pack)
      );
      expect(
        elsewhere.map((t) => t.toolId),
        s.id
      ).toEqual([]);
    }
  });

  it("cuts a tool-lab variant short, its sheet's beats in order up to the beat it holds", () => {
    const named = new Set(TOOL_SCENES.flatMap((t) => toolPageScenes(`/${t.toolId}`)));
    for (const name of Array.from(named)) {
      if (!expansionPacks.has(packOf(name)) || name === packOf(name)) continue;
      const pack = packOf(name);
      const full = SCENES[pack].steps.map((st) => st.f);
      const steps = SCENES[name].steps;
      expect(steps.length, name).toBeLessThan(full.length);
      expect(
        steps.map((st) => st.f),
        name
      ).toEqual(full.slice(0, steps.length));
      expect(steps.at(-1)?.ms, name).toBe(1600);
      expect(SCENES[name].still, name).toBe(steps.at(-1)?.f);
      expect(SCENES[name].loop, name).toBeUndefined();
      expect(SCENES[name].fallback, name).not.toBe("review");
    }
  });
});

describe("finding a tool's scenes", () => {
  it("knows the tool from its page and the pages below it", () => {
    expect(toolForPath("/impediments")?.toolId).toBe("impediments");
    expect(toolForPath("/impediments/abc")?.toolId).toBe("impediments");
    expect(toolForPath("/")).toBeUndefined();
    expect(toolForPath("/comics")).toBeUndefined();
  });

  it("looks actions up by tool, so the same verb can mean different things", () => {
    expect(toolActionScenes("impediments", "impediment_raised")).toEqual(["blocker.raised"]);
    expect(toolActionScenes("impediments", "impediment_resolved")).toEqual(["blocker.cleared"]);
    expect(toolActionScenes("retro", "impediment_raised")).toEqual([]);
    expect(toolActionScenes("no-such-tool", "card_added")).toEqual([]);
  });

  it("loads everything the page may play: its greeting and its moments", () => {
    const scenes = toolPageScenes("/impediments");
    expect(scenes).toEqual(expect.arrayContaining(["blocker.raised", "blocker.cleared"]));
    expect(new Set(scenes).size).toBe(scenes.length);
    expect(toolPageScenes("/")).toEqual([]);
  });

  it("greets on a tool's page ahead of the weather and the hour", () => {
    const moments = momentsNow({
      now: new Date(2026, 10, 3, 9, 0),
      weather: null,
      path: "/impediments",
      weekend: [5, 6],
    });
    const tool = moments.find((m) => m.id === "tool:impediments");
    expect(tool?.priority).toBe(TOOL_PRIORITY);
    expect(tool?.scenes).toEqual(toolForPath("/impediments")!.open);
    const coffee = moments.findIndex((m) => m.id === "coffee");
    expect(moments.indexOf(tool!)).toBeLessThan(coffee);
  });

  it("adds no moment for a tool whose scenes are only its actions", () => {
    const moments = momentsNow({
      now: new Date(2026, 10, 3, 9, 0),
      weather: null,
      path: "/retro",
      weekend: [5, 6],
    });
    expect(moments.some((m) => m.id.startsWith("tool:"))).toBe(false);
  });
});
