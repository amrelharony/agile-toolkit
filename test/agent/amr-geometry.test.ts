import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUTTON_INSET,
  BUTTON_SIDE,
  FEET_TRIM,
  HEAD_TRIM,
  HIT_SIDE,
  LAUNCHER_PLATE,
  MASCOT_BOX,
  MASCOT_BOX_PHONE,
  PANEL_GAP,
  PANEL_MARGIN,
  PANEL_MIN_H,
  PANEL_SIDE,
  amrCentreInPanel,
  amrEdge,
  amrSide,
  bubbleTail,
  cornerAt,
  otherSide,
  panelOrigin,
  panelTail,
  type AmrCorner,
} from "@/components/agent/mascot/amr-geometry";
import * as metrics from "@/components/agent/mascot/engine/figure-metrics";
import * as poses from "@/components/agent/mascot/engine/sprite-poses";

/**
 * Amr's geometry (chat revamp PR 1): the sizes that place him and his panel,
 * moved out of mascot-assistant.tsx unchanged, and the pure helpers the comic
 * tails will read. The panel's tail points at the real Amr beside it, from the
 * edge facing him, at his centre line: 58 px in from the panel's edge on his
 * side for the desktop figure, 40 px for a phone's (audit panel-not-tied-to-amr).
 */

const CORNERS: AmrCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
const SCREENS = [
  { name: "desktop", phone: false, box: { w: 132, h: 143 }, at: 58 },
  { name: "phone", phone: true, box: { w: 96, h: 104 }, at: 40 },
];
const FIGURE_STATES = [
  { name: "figure", figure: true, dragging: false, shows: true },
  { name: "launcher", figure: false, dragging: false, shows: false },
  { name: "dragging", figure: true, dragging: true, shows: false },
  { name: "launcher while dragging", figure: false, dragging: true, shows: false },
];

const ROOT = path.resolve(__dirname, "../..");
const MASCOT = path.join(ROOT, "src/components/agent/mascot");

/** The module specifiers a source file imports or re-exports from, type-only ones included. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  // [^;] spans lines, so a multi-line import is one match.
  const re = /^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm;
  const found: string[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) found.push(m[1]);
  return found;
}

describe("the constants moved out of mascot-assistant.tsx", () => {
  it("keep their values", () => {
    expect(BUTTON_INSET).toBe(4);
    expect(MASCOT_BOX).toEqual({ w: 132, h: 143 });
    expect(MASCOT_BOX_PHONE).toEqual({ w: 96, h: 104 });
    // The "Ask Amr" plate: its 44 px floor, wide enough for the lettering.
    expect(LAUNCHER_PLATE).toEqual({ w: 108, h: 44 });
    expect(FEET_TRIM).toBe(208 - 202);
    expect(HEAD_TRIM).toBe(16);
    expect(HIT_SIDE).toBe(0.28);
    expect(PANEL_GAP).toBe(6);
    expect(PANEL_MIN_H).toBe(160);
    expect(PANEL_MARGIN).toBe(8);
  });

  it("names the side offsets that were literals: the button's 8 px, the panel's 16 px", () => {
    expect(BUTTON_SIDE).toBe(8);
    expect(PANEL_SIDE).toBe(16);
  });

  it("are the ones mascot-assistant.tsx places him with (it declares none of its own)", () => {
    const src = readFileSync(path.join(MASCOT, "mascot-assistant.tsx"), "utf8");
    for (const name of [
      "BUTTON_INSET",
      "BUTTON_SIDE",
      "MASCOT_BOX",
      "MASCOT_BOX_PHONE",
      "LAUNCHER_PLATE",
      "FEET_TRIM",
      "HEAD_TRIM",
      "HIT_SIDE",
      "PANEL_GAP",
      "PANEL_SIDE",
      "PANEL_MIN_H",
      "PANEL_MARGIN",
    ]) {
      expect(src, name).not.toMatch(new RegExp(`\\bconst ${name}\\b`));
    }
    expect(src).toMatch(/from "\.\/amr-geometry"/);
    // The side offsets go through the names, not literals.
    expect(src).toContain("sideOffset(c, BUTTON_SIDE)");
    expect(src).toContain("sideOffset(c, PANEL_SIDE)");
    expect(src).not.toMatch(/sideOffset\(c, \d+\)/);
  });
});

describe("figure-metrics", () => {
  it("holds the sheet's cell and the figure's rows, and sprite-poses re-exports them", () => {
    expect(metrics.SHEET).toEqual({ columns: 8, rows: 11, cellW: 192, cellH: 208 });
    expect(metrics.FIGURE_TOP).toBe(25);
    expect(metrics.FIGURE_BOTTOM).toBe(202);
    expect(poses.SHEET).toBe(metrics.SHEET);
    expect(poses.FIGURE_TOP).toBe(metrics.FIGURE_TOP);
    expect(poses.FIGURE_BOTTOM).toBe(metrics.FIGURE_BOTTOM);
  });

  it("imports nothing, and amr-geometry imports only it", () => {
    expect(importsOf(path.join(MASCOT, "engine/figure-metrics.ts"))).toEqual([]);
    expect(importsOf(path.join(MASCOT, "amr-geometry.ts"))).toEqual(["./engine/figure-metrics"]);
  });

  it("the import reader sees type-only, multi-line and re-exporting imports", () => {
    const seen = importsOf(path.join(MASCOT, "engine/sprite-poses.ts"));
    expect(seen).toContain("@/lib/agent/mascot/store"); // import type { … }
    expect(seen).toContain("./clips"); // a multi-line import
    expect(seen).toContain("./figure-metrics"); // export { … } from
  });
});

describe("amrSide, amrEdge, cornerAt and otherSide", () => {
  it("read his side and edge from the corner", () => {
    expect(CORNERS.map(amrSide)).toEqual(["left", "right", "left", "right"]);
    expect(CORNERS.map(amrEdge)).toEqual(["top", "top", "bottom", "bottom"]);
  });

  it("steps aside to the other side of the same edge, and back", () => {
    expect(CORNERS.map(otherSide)).toEqual(["topRight", "topLeft", "bottomRight", "bottomLeft"]);
    for (const c of CORNERS) expect(otherSide(otherSide(c))).toBe(c);
  });

  it("turns the store's placement (a side and an edge) back into his corner", () => {
    for (const c of CORNERS) expect(cornerAt({ side: amrSide(c), edge: amrEdge(c) })).toBe(c);
    expect(cornerAt({ side: "left", edge: "bottom" })).toBe("bottomLeft");
  });
});

describe("panelTail", () => {
  for (const c of CORNERS) {
    for (const s of SCREENS) {
      for (const f of FIGURE_STATES) {
        it(`${c}, ${s.name}, ${f.name}: ${f.shows ? `the ${amrEdge(c) === "top" ? "top" : "bottom"} edge at ${s.at} px from the ${amrSide(c)}` : "hidden"}`, () => {
          const tail = panelTail(c, { phone: s.phone, figure: f.figure, dragging: f.dragging });
          if (!f.shows) {
            expect(tail).toBeNull();
            return;
          }
          expect(tail).toEqual({
            // The panel sits above him in a bottom corner and below him in a top one.
            tail: c.startsWith("top") ? "up" : "down",
            from: c.endsWith("Left") ? "left" : "right",
            at: s.at,
          });
        });
      }
    }
  }

  it("points at his centre line: his button's side offset plus half his box, less the panel's", () => {
    for (const s of SCREENS) {
      const centreFromScreenSide = BUTTON_SIDE + s.box.w / 2;
      expect(amrCentreInPanel(s.phone, true)).toBe(centreFromScreenSide - PANEL_SIDE);
      expect(amrCentreInPanel(s.phone, true)).toBe(s.at);
      // ...which is on his figure, inside the span that takes his clicks.
      expect(centreFromScreenSide).toBeGreaterThan(BUTTON_SIDE + s.box.w * HIT_SIDE);
      expect(centreFromScreenSide).toBeLessThan(BUTTON_SIDE + s.box.w * (1 - HIT_SIDE));
    }
    // The launcher plate's centre, for the entrance when it stands in for him.
    expect(amrCentreInPanel(false, false)).toBe(BUTTON_SIDE + LAUNCHER_PLATE.w / 2 - PANEL_SIDE);
    expect(amrCentreInPanel(true, false)).toBe(46);
  });

  it("follows him when he steps aside: the flipped corner mirrors the tail", () => {
    for (const corner of CORNERS) {
      const placed = otherSide(corner);
      for (const s of SCREENS) {
        const state = { phone: s.phone, figure: true, dragging: false };
        const home = panelTail(corner, state)!;
        const flipped = panelTail(placed, state)!;
        expect(flipped.tail, `${corner} → ${placed}`).toBe(home.tail);
        expect(flipped.at).toBe(home.at);
        expect(flipped.from).toBe(home.from === "left" ? "right" : "left");
        expect(flipped.from).toBe(amrSide(placed));
      }
    }
  });
});

describe("bubbleTail", () => {
  for (const c of CORNERS) {
    const side = c.endsWith("Left") ? "left" : "right";
    const edge = c.startsWith("top") ? "top" : "bottom";
    it(`${c}, desktop: on the edge facing him (${side}), counted from his edge (${edge})`, () => {
      expect(bubbleTail(c, false)).toEqual({ tail: side, from: edge });
    });
    it(`${c}, phone: pointing ${edge === "top" ? "up" : "down"} at him, from his side (${side})`, () => {
      expect(bubbleTail(c, true)).toEqual({ tail: edge === "top" ? "up" : "down", from: side });
    });
  }

  it("only names ends the balloon's CSS counts from for that tail", () => {
    for (const c of CORNERS) {
      for (const phone of [false, true]) {
        const { tail, from } = bubbleTail(c, phone);
        const ends = tail === "left" || tail === "right" ? ["top", "bottom"] : ["left", "right"];
        expect(ends, `${c} ${phone ? "phone" : "desktop"}`).toContain(from);
      }
    }
  });

  it("follows him when he steps aside", () => {
    expect(bubbleTail(otherSide("bottomRight"), false)).toEqual({ tail: "left", from: "bottom" });
    expect(bubbleTail(otherSide("bottomRight"), true)).toEqual({ tail: "down", from: "left" });
    expect(bubbleTail(otherSide("topLeft"), true)).toEqual({ tail: "up", from: "right" });
  });
});

describe("panelOrigin", () => {
  for (const c of CORNERS) {
    for (const s of SCREENS) {
      for (const figure of [true, false]) {
        const at = figure ? s.at : 46;
        it(`${c}, ${s.name}, ${figure ? "figure" : "launcher"}: the edge facing him, ${at} px in`, () => {
          const x = c.endsWith("Left") ? `${at}px` : `calc(100% - ${at}px)`;
          const y = c.startsWith("top") ? "0%" : "100%";
          expect(panelOrigin(c, { phone: s.phone, figure })).toBe(`${x} ${y}`);
        });
      }
    }
  }

  it("grows from where the tail meets the panel when the tail shows", () => {
    for (const c of CORNERS) {
      for (const s of SCREENS) {
        const tail = panelTail(c, { phone: s.phone, figure: true, dragging: false })!;
        const origin = panelOrigin(c, { phone: s.phone, figure: true });
        expect(origin).toContain(`${tail.at}px`);
        expect(origin.endsWith(tail.tail === "up" ? " 0%" : " 100%")).toBe(true);
        expect(origin.startsWith("calc(100%")).toBe(tail.from === "right");
      }
    }
  });

  it("mirrors with the flipped corner", () => {
    expect(panelOrigin(otherSide("bottomRight"), { phone: false, figure: true })).toBe("58px 100%");
    expect(panelOrigin(otherSide("topLeft"), { phone: true, figure: true })).toBe(
      "calc(100% - 40px) 0%"
    );
  });
});
