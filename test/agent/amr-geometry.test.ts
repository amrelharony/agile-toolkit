import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUTTON_INSET,
  BUTTON_SIDE,
  COMPACT_BELOW_H,
  COMPACT_TOP,
  DOCK_GAP,
  DOCK_INSET,
  FEET_TRIM,
  HEAD_TRIM,
  HIT_SIDE,
  LAUNCHER_PLATE,
  LAUNCHER_PLATE_REM,
  MASCOT_BOX,
  MASCOT_BOX_PHONE,
  PANEL_GAP,
  PANEL_MARGIN,
  PANEL_MIN_H,
  PANEL_SIDE,
  PLATE_H_VAR,
  PLATE_W_VAR,
  SHEET_LAYOUT_MAX_W,
  SIDE_LAYOUT_MAX_H,
  SIDE_PANEL_MAX_W,
  amrCentreInPanel,
  amrEdge,
  amrSide,
  bubbleTail,
  cornerAt,
  dockInsets,
  dockedButtonPos,
  isCompact,
  launcherPlateCss,
  otherSide,
  panelLayout,
  panelOrigin,
  panelTail,
  sheetPos,
  sidePos,
  visibleBox,
  type AmrCorner,
  type AmrLayout,
  type VisibleBox,
} from "@/components/agent/mascot/amr-geometry";
import * as metrics from "@/components/agent/mascot/engine/figure-metrics";
import * as poses from "@/components/agent/mascot/engine/sprite-poses";
import { PHONE_MAX_PX } from "@/lib/layout/breakpoints";
import { readVisibleArea } from "@/lib/layout/use-visible-area";

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
    // ...and the same box in rem, as the plate is lettered: 2.75rem is its floor.
    expect(LAUNCHER_PLATE_REM).toEqual({ w: 6.75, h: 2.75 });
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

/*
 * Phone layouts (chat revamp PR 8, audits phone-sheet-layout,
 * phone-keyboard-covers-composer, owner-chat-clips-when-short): the layout is
 * picked by height first, the sheet fills the visible box under the header and
 * above the keyboard, and Amr docks full size in its bottom corner beside the
 * composer, with a gutter and a footer kept for him.
 */

/** The header's bottom on these phones: --header-h, 3.5rem with no top safe area. */
const HEADER = 56;

interface Screen {
  name: string;
  width: number;
  height: number;
  /** The home indicator's inset. */
  safeBottom?: number;
  /** A keyboard this tall, px. */
  kb?: number;
  sides?: { left: number; right: number };
}

const PHONES: Screen[] = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "375x812", width: 375, height: 812 },
  { name: "375x812 inset 34", width: 375, height: 812, safeBottom: 34 },
  { name: "375x812 inset 34, keyboard 300", width: 375, height: 812, safeBottom: 34, kb: 300 },
  { name: "375x667, keyboard 300", width: 375, height: 667, kb: 300 },
];

/** The visible area the keyboard helper reads on this screen (no pan, no zoom). */
function areaOf(s: Screen) {
  return readVisibleArea({
    clientHeight: s.height,
    viewport: { height: s.height - (s.kb ?? 0), offsetTop: 0, scale: 1 },
    headerBottom: HEADER,
    safeBottom: s.safeBottom ?? 0,
  });
}

function boxOf(s: Screen): VisibleBox {
  return visibleBox(s, areaOf(s), s.sides);
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The sheet on screen, from its offsets. */
function sheetRect(s: Screen, compact: boolean): Rect {
  const area = areaOf(s);
  const pos = sheetPos(boxOf(s), { compact, viewTop: area.viewTop });
  return {
    left: pos.left,
    top: pos.top,
    right: s.width - pos.right,
    bottom: s.height - pos.bottom,
  };
}

/** The docked figure's hit span on screen: his button at MASCOT_BOX_PHONE, from its offsets. */
function dockedHit(c: AmrCorner, s: Screen, box: Parameters<typeof dockedButtonPos>[1]): Rect {
  const pos = dockedButtonPos(c, box);
  const { w, h } = MASCOT_BOX_PHONE;
  const scale = h / metrics.SHEET.cellH;
  const left = pos.left ?? s.width - pos.right! - w;
  const top = s.height - pos.bottom - h;
  return {
    left: left + w * HIT_SIDE,
    right: left + w * (1 - HIT_SIDE),
    top: top + metrics.FIGURE_TOP * scale,
    bottom: top + metrics.FIGURE_BOTTOM * scale,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("panelLayout: height first (when wider than tall), then width", () => {
  const cases: [number, number, AmrLayout][] = [
    [320, 568, "sheet"],
    [360, 640, "sheet"],
    [375, 667, "sheet"],
    [375, 812, "sheet"],
    [639, 900, "sheet"],
    [639, 501, "sheet"],
    [640, 900, "float"],
    [768, 1024, "float"],
    [1440, 900, "float"],
    [1440, 501, "float"],
    [812, 375, "side"],
    [568, 320, "side"],
    [844, 390, "side"],
    [639, 500, "side"],
    [1440, 500, "side"],
    [640, 360, "side"],
    [320, 256, "side"],
    [501, 500, "side"],
    // A short phone held upright: its layout height is the screen less the
    // browser's bars (Safari on a 320x568, Samsung Internet on a 360x640) or
    // a page zoom (a 375x667 at 125%). It keeps the sheet.
    [320, 480, "sheet"],
    [320, 460, "sheet"],
    [360, 464, "sheet"],
    [300, 442, "sheet"],
    [500, 500, "sheet"],
  ];
  for (const [width, height, layout] of cases) {
    it(`${width}x${height}: ${layout}`, () => {
      expect(panelLayout({ width, height })).toBe(layout);
    });
  }

  it("draws its lines at 500 px tall and at phone width", () => {
    expect(SIDE_LAYOUT_MAX_H).toBe(500);
    expect(SHEET_LAYOUT_MAX_W).toBe(PHONE_MAX_PX);
  });
});

describe("visibleBox", () => {
  it("runs from under the header to above the home indicator, in line with his button at the sides", () => {
    expect(boxOf({ name: "", width: 375, height: 812, safeBottom: 34 })).toEqual({
      top: 64,
      right: 8,
      bottom: 42,
      left: 8,
      width: 359,
      height: 706,
    });
    expect(boxOf({ name: "", width: 320, height: 568 })).toEqual({
      top: 64,
      right: 8,
      bottom: 8,
      left: 8,
      width: 304,
      height: 496,
    });
    expect(BUTTON_SIDE).toBe(8);
  });

  it("stops above a keyboard", () => {
    const box = boxOf({ name: "", width: 375, height: 812, safeBottom: 34, kb: 300 });
    expect(box.bottom).toBe(308);
    expect(box.height).toBe(812 - 64 - 308);
  });

  it("keeps clear of a landscape notch on either side, as his button does", () => {
    const box = boxOf({ name: "", width: 812, height: 375, sides: { left: 44, right: 0 } });
    expect(box.left).toBe(BUTTON_SIDE + 44);
    expect(box.right).toBe(BUTTON_SIDE);
    expect(box.width).toBe(812 - 52 - 8);
  });

  it("is never negative in size", () => {
    expect(visibleBox({ width: 10, height: 40 }, { top: 64, bottom: 8 })).toMatchObject({
      width: 0,
      height: 0,
    });
  });
});

describe("isCompact", () => {
  it("whenever the keyboard is up", () => {
    expect(isCompact(true, { height: 700 })).toBe(true);
    const s = { name: "", width: 375, height: 812, safeBottom: 34, kb: 300 };
    expect(isCompact(areaOf(s).keyboardUp, boxOf(s))).toBe(true);
  });

  it(`when the visible box is under ${COMPACT_BELOW_H} px tall`, () => {
    expect(COMPACT_BELOW_H).toBe(360);
    expect(isCompact(false, { height: 359.5 })).toBe(true);
    expect(isCompact(false, { height: 360 })).toBe(false);
    // Landscape phones are always compact: 303 and 248 px of room.
    for (const [width, height] of [
      [812, 375],
      [568, 320],
    ]) {
      const s = { name: "", width, height };
      expect(isCompact(false, boxOf(s)), `${width}x${height}`).toBe(true);
    }
  });

  it("not on an upright phone with no keyboard", () => {
    for (const s of PHONES.filter((p) => !p.kb)) {
      expect(isCompact(areaOf(s).keyboardUp, boxOf(s)), s.name).toBe(false);
    }
  });
});

describe("sheetPos", () => {
  for (const s of PHONES) {
    it(`${s.name}: fills the visible box, under the header and above the keyboard or home indicator`, () => {
      const box = boxOf(s);
      expect(sheetPos(box, { compact: false, viewTop: 0 })).toEqual({
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
      });
      const r = sheetRect(s, false);
      expect(r.top).toBeGreaterThanOrEqual(HEADER + 8);
      expect(s.height - r.bottom).toBeGreaterThanOrEqual((s.kb ?? 0) + 8);
      expect(s.height - r.bottom).toBeGreaterThanOrEqual((s.safeBottom ?? 0) + 8);
    });
  }

  it("compact: from just below the top of what can be seen, over the site header", () => {
    expect(COMPACT_TOP).toBe(4);
    const box = boxOf({ name: "", width: 375, height: 812, kb: 300 });
    expect(sheetPos(box, { compact: true, viewTop: 0 }).top).toBe(4);
    // iOS panned the page 180 px down to the field.
    expect(sheetPos(box, { compact: true, viewTop: 180 }).top).toBe(184);
    // Only the top moves.
    expect(sheetPos(box, { compact: true, viewTop: 0 })).toMatchObject({
      right: 8,
      bottom: 308,
      left: 8,
    });
  });
});

describe("dockedButtonPos", () => {
  const scale = MASCOT_BOX_PHONE.h / metrics.SHEET.cellH;

  for (const s of PHONES) {
    for (const c of CORNERS) {
      it(`${s.name}, ${c}: the sheet's bottom ${amrSide(c)} corner, full phone size, inside the sheet`, () => {
        const box = boxOf(s);
        const pos = dockedButtonPos(c, box);
        const side = amrSide(c);
        expect(pos.position).toBe("fixed");
        expect(pos.bottom).toBeCloseTo(box.bottom + DOCK_INSET - FEET_TRIM * scale, 6);
        expect(pos[side]).toBeCloseTo(box[side] + DOCK_INSET - MASCOT_BOX_PHONE.w * HIT_SIDE, 6);
        expect(pos[side === "left" ? "right" : "left"]).toBeUndefined();

        // His figure stands DOCK_INSET inside the sheet's bottom corner...
        const compact = isCompact(areaOf(s).keyboardUp, box);
        const sheet = sheetRect(s, compact);
        const hit = dockedHit(c, s, box);
        expect(hit.bottom).toBeCloseTo(sheet.bottom - DOCK_INSET, 6);
        if (side === "left") expect(hit.left).toBeCloseTo(sheet.left + DOCK_INSET, 6);
        else expect(hit.right).toBeCloseTo(sheet.right - DOCK_INSET, 6);
        // ...and the whole figure is on the sheet, whatever the keyboard leaves of it.
        expect(hit.top).toBeGreaterThanOrEqual(sheet.top);
        expect(hit.left).toBeGreaterThanOrEqual(sheet.left);
        expect(hit.right).toBeLessThanOrEqual(sheet.right);
      });
    }
  }

  it("docks a top corner at the bottom too, on the same side", () => {
    const box = boxOf(PHONES[1]);
    expect(dockedButtonPos("topRight", box)).toEqual(dockedButtonPos("bottomRight", box));
    expect(dockedButtonPos("topLeft", box)).toEqual(dockedButtonPos("bottomLeft", box));
  });

  it("rides the keyboard with the visible box, or stays put at its rest", () => {
    const s = { name: "", width: 375, height: 812, safeBottom: 34, kb: 300 };
    const area = areaOf(s);
    const box = boxOf(s);
    expect(dockedButtonPos("bottomRight", box).bottom).toBeCloseTo(308 + DOCK_INSET - 3, 6);
    const rest = dockedButtonPos("bottomRight", { ...box, bottom: area.restBottom });
    expect(rest.bottom).toBeCloseTo(42 + DOCK_INSET - 3, 6);
    expect(rest.right).toBe(dockedButtonPos("bottomRight", box).right);
  });

  it("follows the flipped corner", () => {
    const box = boxOf(PHONES[0]);
    expect(dockedButtonPos(otherSide("bottomRight"), box)).toEqual(
      dockedButtonPos("bottomLeft", box)
    );
  });

  for (const s of PHONES) {
    for (const c of CORNERS) {
      it(`${s.name}, ${c}: the launcher plate, standing in for him, docks DOCK_INSET inside the corner, never off the screen`, () => {
        const box = boxOf(s);
        const pos = dockedButtonPos(c, box, false);
        const side = amrSide(c);
        expect(pos.bottom).toBe(box.bottom + DOCK_INSET);
        expect(pos[side]).toBe(box[side] + DOCK_INSET);
        expect(pos[side]).toBeGreaterThanOrEqual(BUTTON_SIDE + DOCK_INSET);
        expect(pos[side === "left" ? "right" : "left"]).toBeUndefined();
        // Its inner edge stays in the plate's gutter, DOCK_GAP clear of the views.
        const { gutter } = dockInsets(c, false);
        expect(pos[side]! + LAUNCHER_PLATE.w + DOCK_GAP).toBeLessThanOrEqual(box[side] + gutter);
      });
    }
  }
});

describe("dockInsets", () => {
  const scale = MASCOT_BOX_PHONE.h / metrics.SHEET.cellH;
  const hitWidth = MASCOT_BOX_PHONE.w * (1 - 2 * HIT_SIDE);
  const figureHeight = (metrics.FIGURE_BOTTOM - metrics.FIGURE_TOP) * scale;

  it("a gutter on his side as wide as his figure plus 8 px, and a footer as tall as him", () => {
    expect(DOCK_INSET).toBe(BUTTON_INSET);
    expect(DOCK_GAP).toBe(8);
    for (const c of CORNERS) {
      const d = dockInsets(c);
      expect(d.side).toBe(amrSide(c));
      expect(d.gutter).toBe(55);
      expect(d.gutter).toBeGreaterThanOrEqual(DOCK_INSET + hitWidth + DOCK_GAP);
      expect(d.footer).toBe(93);
      expect(d.footer).toBeGreaterThanOrEqual(DOCK_INSET + figureHeight);
    }
  });

  it("follows the flipped corner", () => {
    expect(dockInsets(otherSide("bottomRight")).side).toBe("left");
  });

  it("writes the plate's size as CSS that grows with it: floor, rem box, drawn size", () => {
    expect(PLATE_W_VAR).toBe("--amr-plate-w");
    expect(PLATE_H_VAR).toBe("--amr-plate-h");
    expect(launcherPlateCss("w")).toBe("max(108px, 6.75rem, var(--amr-plate-w, 0px))");
    expect(launcherPlateCss("h")).toBe("max(44px, 2.75rem, var(--amr-plate-h, 0px))");
  });

  it("keeps the launcher plate's room while it stands in for him", () => {
    for (const c of CORNERS) {
      const d = dockInsets(c, false);
      expect(d.side).toBe(amrSide(c));
      expect(d.gutter).toBe(120);
      expect(d.gutter).toBeGreaterThanOrEqual(DOCK_INSET + LAUNCHER_PLATE.w + DOCK_GAP);
      expect(d.footer).toBe(48);
      expect(d.footer).toBeGreaterThanOrEqual(DOCK_INSET + LAUNCHER_PLATE.h);
    }
  });

  for (const s of PHONES) {
    for (const c of ["bottomLeft", "bottomRight"] as const) {
      it(`${s.name}, ${c}: Send at the gutter's edge is never under him, and the footer holds him`, () => {
        const box = boxOf(s);
        const compact = isCompact(areaOf(s).keyboardUp, box);
        const sheet = sheetRect(s, compact);
        const { gutter, footer } = dockInsets(c);
        const hit = dockedHit(c, s, box);
        // A 44 px Send at the end of the composer's row, on his side, past the gutter.
        const edge = amrSide(c) === "right" ? sheet.right - gutter : sheet.left + gutter;
        const send: Rect = {
          left: amrSide(c) === "right" ? edge - 44 : edge,
          right: amrSide(c) === "right" ? edge : edge + 44,
          top: sheet.bottom - 8 - 44,
          bottom: sheet.bottom - 8,
        };
        expect(overlaps(send, hit)).toBe(false);
        const cx = (send.left + send.right) / 2;
        const cy = (send.top + send.bottom) / 2;
        const onHim = cx >= hit.left && cx <= hit.right && cy >= hit.top && cy <= hit.bottom;
        expect(onHim).toBe(false);
        // DOCK_GAP between him and the gutter's edge.
        const gap = amrSide(c) === "right" ? hit.left - edge : edge - hit.right;
        expect(gap).toBeGreaterThanOrEqual(DOCK_GAP);
        // He stands within the footer's height, never over the log above it.
        expect(hit.top).toBeGreaterThanOrEqual(sheet.bottom - footer);
        // Room is left for the composer beside him.
        expect(sheet.right - sheet.left - gutter).toBeGreaterThan(200);
      });
    }
  }
});

describe("sidePos", () => {
  const LANDSCAPE = { name: "812x375", width: 812, height: 375 };
  const SMALL = { name: "568x320", width: 568, height: 320 };

  for (const c of CORNERS) {
    it(`812x375, ${c}: top to bottom beside his desktop figure, ${SIDE_PANEL_MAX_W} px wide`, () => {
      const box = boxOf(LANDSCAPE);
      const top = { compact: isCompact(false, box), viewTop: 0 };
      expect(top.compact).toBe(true);
      const pos = sidePos(c, box, { phone: false, figure: true }, top);
      const side = amrSide(c);
      expect(pos.top).toBe(COMPACT_TOP);
      expect(pos.bottom).toBe(8);
      expect(pos.width).toBe(SIDE_PANEL_MAX_W);
      expect(pos[side]).toBeCloseTo(8 + MASCOT_BOX.w * (1 - HIT_SIDE) + PANEL_GAP, 6);
      expect(pos[side === "left" ? "right" : "left"]).toBeUndefined();
    });
  }

  it("568x320: beside his phone figure", () => {
    const box = boxOf(SMALL);
    const pos = sidePos(
      "bottomLeft",
      box,
      { phone: true, figure: true },
      {
        compact: true,
        viewTop: 0,
      }
    );
    expect(pos.left).toBeCloseTo(8 + MASCOT_BOX_PHONE.w * (1 - HIT_SIDE) + PANEL_GAP, 6);
    expect(pos.width).toBe(SIDE_PANEL_MAX_W);
  });

  it("clears the launcher plate when that stands in for him", () => {
    const pos = sidePos(
      "bottomRight",
      boxOf(SMALL),
      { phone: true, figure: false },
      {
        compact: true,
        viewTop: 0,
      }
    );
    expect(pos.right).toBe(8 + LAUNCHER_PLATE.w + PANEL_GAP);
  });

  it("clears the plate as drawn when larger text grows it, never less than its floor", () => {
    const box = boxOf(SMALL);
    const top = { compact: true, viewTop: 0 };
    const fig = { phone: true, figure: false };
    const floor = sidePos("bottomRight", box, fig, top);
    // At 200% text the plate is about 190 px wide: the panel starts past it, narrower by as much.
    const wide = sidePos("bottomRight", box, { ...fig, plateW: 190 }, top);
    expect(wide.right).toBe(box.right + 190 + PANEL_GAP);
    expect(wide.width).toBe(Math.min(SIDE_PANEL_MAX_W, box.width - 190 - PANEL_GAP));
    expect(SMALL.width - wide.right! - wide.width).toBeGreaterThanOrEqual(box.left);
    const left = sidePos("topLeft", box, { ...fig, plateW: 190 }, top);
    expect(left.left).toBe(box.left + 190 + PANEL_GAP);
    // Smaller readings (jsdom's 0, a plate mid-load) keep LAUNCHER_PLATE.
    for (const plateW of [0, 50, LAUNCHER_PLATE.w]) {
      expect(sidePos("bottomRight", box, { ...fig, plateW }, top)).toEqual(floor);
    }
    expect(floor.right).toBe(box.right + LAUNCHER_PLATE.w + PANEL_GAP);
    // His figure's reach never reads the plate.
    expect(sidePos("bottomRight", box, { phone: true, figure: true, plateW: 190 }, top)).toEqual(
      sidePos("bottomRight", box, { phone: true, figure: true }, top)
    );
  });

  it("stays PANEL_GAP clear of his figure, and never runs past the box's far side", () => {
    for (const s of [LANDSCAPE, SMALL, { name: "320x480", width: 320, height: 480 }]) {
      for (const phone of [false, true]) {
        const box = boxOf(s);
        const w = (phone ? MASCOT_BOX_PHONE : MASCOT_BOX).w;
        const pos = sidePos(
          "bottomRight",
          box,
          { phone, figure: true },
          {
            compact: true,
            viewTop: 0,
          }
        );
        // His figure's inner edge, from the screen's right: his button's offset plus the hit span.
        const figureEdge = box.right + w * (1 - HIT_SIDE);
        expect(pos.right! - figureEdge).toBeCloseTo(PANEL_GAP, 6);
        const panelLeft = s.width - pos.right! - pos.width;
        expect(panelLeft).toBeGreaterThanOrEqual(box.left - 1e-9);
      }
    }
    // A narrow short screen: the room past him, not the cap.
    const narrow = sidePos(
      "bottomRight",
      boxOf({ name: "", width: 320, height: 480 }),
      { phone: true, figure: true },
      { compact: true, viewTop: 0 }
    );
    expect(narrow.width).toBeCloseTo(304 - MASCOT_BOX_PHONE.w * (1 - HIT_SIDE) - PANEL_GAP, 6);
  });

  it("keeps clear of a landscape notch on his side", () => {
    const box = boxOf({ ...LANDSCAPE, sides: { left: 0, right: 44 } });
    const pos = sidePos(
      "topRight",
      box,
      { phone: false, figure: true },
      {
        compact: true,
        viewTop: 0,
      }
    );
    expect(pos.right).toBeCloseTo(52 + MASCOT_BOX.w * (1 - HIT_SIDE) + PANEL_GAP, 6);
  });

  it("starts under the header when there's room (not compact), and above a keyboard at the bottom", () => {
    const tall = boxOf({ name: "", width: 1440, height: 500 });
    expect(isCompact(false, tall)).toBe(false);
    expect(
      sidePos("bottomRight", tall, { phone: false, figure: true }, { compact: false, viewTop: 0 })
        .top
    ).toBe(64);
    const typing = boxOf({ ...LANDSCAPE, kb: 200 });
    expect(
      sidePos("bottomRight", typing, { phone: false, figure: true }, { compact: true, viewTop: 0 })
        .bottom
    ).toBe(208);
  });
});
