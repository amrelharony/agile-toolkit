/**
 * The live sheet's refined redraw (docs/mascot/live-sheets.json, L01–L10): every cell
 * of the live sheet the engine shows is filled once, each pose's reduced-motion still
 * and every borrowed cell lands on the slot drawn for it.
 */

import { describe, expect, it } from "vitest";
import spec from "../../docs/mascot/live-sheets.json";
import { POSES, SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { SCENES } from "@/components/agent/mascot/engine/scenes";
import {
  ACT_CLIPS,
  HOLD_CLIPS,
  LIFTED_CLIP,
  TALK_CLIP,
  clipFrames,
} from "@/components/agent/mascot/engine/clips";

type Sheet = (typeof spec.sheets)[number];
const LOOK_ROWS = [9, 10];

/** The sheet and slot that fill a live cell. */
function filler(row: number, col: number): { sheet: Sheet; slot: number } | undefined {
  for (const sheet of spec.sheets) {
    const hit = sheet.cells.find(([r, c]) => r === row && c === col);
    if (hit) return { sheet, slot: hit[2] };
  }
  return undefined;
}

describe("the live sheet's redraw", () => {
  it("is ten eight-slot sheets L01 to L10, each with its own file", () => {
    expect(spec.sheets.map((s) => s.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`)
    );
    for (const s of spec.sheets) {
      expect(s.slots, s.id).toHaveLength(8);
      expect(s.file, s.id).toMatch(new RegExp(`^${s.id}-[a-z-]+\\.png$`));
    }
    expect(spec.grid).toEqual({
      columns: SHEET.columns,
      rows: SHEET.rows,
      cellW: SHEET.cellW,
      cellH: SHEET.cellH,
    });
  });

  it("fills every cell the engine shows exactly once, and no other", () => {
    const need = new Set<string>();
    for (const def of Object.values(POSES)) {
      for (let c = 0; c < def.frames; c++) need.add(`${def.row},${c}`);
    }
    for (const r of LOOK_ROWS) for (let c = 0; c < 8; c++) need.add(`${r},${c}`);
    const have = spec.sheets.flatMap((s) => s.cells.map(([r, c]) => `${r},${c}`));
    expect(new Set(have).size).toBe(have.length);
    expect([...have].sort()).toEqual(Array.from(need).sort());
    for (const s of spec.sheets)
      for (const [, , slot] of s.cells) expect(slot, s.id).toBeGreaterThanOrEqual(1);
  });

  it("puts each pose's reduced-motion still on the slot drawn as its clearest frame", () => {
    // The brief marks those slots "the clearest frame of the sheet" (or a pose that is one on its own).
    for (const [name, def] of Object.entries(POSES)) {
      const hit = filler(def.row, def.still);
      expect(hit, name).toBeDefined();
      const beat = hit!.sheet.slots[hit!.slot - 1];
      if (["failed", "waiting", "running", "review"].includes(name)) {
        expect(beat, name).toContain("the clearest frame of the sheet");
      }
    }
  });

  it("fills every live cell a clip borrows", () => {
    const clips = [
      ...Object.values(ACT_CLIPS),
      ...Object.values(HOLD_CLIPS),
      LIFTED_CLIP,
      TALK_CLIP,
      ...Object.values(SCENES),
    ];
    for (const c of clips) {
      for (const f of clipFrames(c)) {
        const m = /^base:(\d+):(\d+)$/.exec(f);
        if (m) expect(filler(Number(m[1]), Number(m[2])), f).toBeDefined();
      }
    }
  });
});
