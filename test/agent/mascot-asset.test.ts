// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import {
  FRAMES,
  PACKS,
  PACK_CELL,
  PACK_COLUMNS,
  type PackId,
} from "@/components/agent/mascot/mascot-packs";
import contextSpec from "../../docs/mascot/context-sheets.json";
import companionSpec from "../../docs/mascot/companion-scenes.json";
import expansionSpec from "../../docs/mascot/expansion-sheets.json";
import { SHEET } from "@/components/agent/mascot/engine/sprite-poses";
import { SCENE_THUMBS, THUMB_INDEX } from "@/components/agent/mascot/engine/scene-thumbs";
import { SCENES } from "@/components/agent/mascot/engine/scenes";

const onDisk = (url: string) => path.join(process.cwd(), "public", url);

/** A transparent WebP has a VP8X header: canvas size minus one, 24-bit LE. */
function webpCanvas(bytes: Buffer): { w: number; h: number } {
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("VP8X");
  return { w: bytes.readUIntLE(24, 3) + 1, h: bytes.readUIntLE(27, 3) + 1 };
}

/** The packs of the context sheets S11–S64, which ship as their sheets come back. */
const CONTEXT_PACKS = new Set<string>(contextSpec.sheets.map((s) => s.pack));
const COMPANION_PACKS = new Set<string>(companionSpec.sheets.map((s) => s.pack));
/** The expansion scenes X001–X124: eight frames each, a pack of their own (nothing plays them yet). */
const EXPANSION_PACKS = new Set<string>(expansionSpec.sheets.map((s) => s.pack));

const hashOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);

describe("Amr's sprite sheet", () => {
  const file = onDisk(MASCOT_SPRITE_URL);

  it("is committed under public/ at the URL the sprite loads", () => {
    expect(MASCOT_SPRITE_URL).toMatch(/^\/mascot\/amr\.[0-9a-f]{8}\.webp$/);
    expect(statSync(file).isFile()).toBe(true);
  });

  it("is named after its content, so immutable caching is safe", () => {
    expect(MASCOT_SPRITE_URL).toContain(`amr.${hashOf(readFileSync(file))}.webp`);
  });

  it("is a WebP of the size the poses expect, small enough for every visitor", () => {
    expect(statSync(file).size).toBeLessThan(700 * 1024);
    expect(webpCanvas(readFileSync(file))).toEqual({
      w: SHEET.columns * SHEET.cellW,
      h: SHEET.rows * SHEET.cellH,
    });
  });
});

describe("Amr's lazy packs", () => {
  const packs = Object.entries(PACKS) as [PackId, (typeof PACKS)[PackId]][];

  it.each(packs)("%s is committed at both sizes, named after its bytes", (_id, pack) => {
    for (const [url, size] of [
      [pack.src, pack.bytes],
      [pack.src2x, pack.bytes2x],
    ] as const) {
      const bytes = readFileSync(onDisk(url));
      expect(url).toContain(`.${hashOf(bytes)}.webp`);
      expect(bytes.length).toBe(size);
    }
  });

  it("cells are the live sheet's, with headroom on top for a raised prop", () => {
    expect(PACK_CELL.w).toBe(SHEET.cellW);
    expect(PACK_CELL.h).toBe(SHEET.cellH + PACK_CELL.headroom);
    expect(PACK_CELL.headroom).toBeGreaterThan(0);
  });

  it.each(packs)("%s holds its frames in pack cells, eight to a row", (_id, pack) => {
    const rows = Math.ceil(pack.frames / PACK_COLUMNS);
    expect(webpCanvas(readFileSync(onDisk(pack.src)))).toEqual({
      w: PACK_COLUMNS * PACK_CELL.w,
      h: rows * PACK_CELL.h,
    });
    expect(webpCanvas(readFileSync(onDisk(pack.src2x)))).toEqual({
      w: PACK_COLUMNS * PACK_CELL.w * 2,
      h: rows * PACK_CELL.h * 2,
    });
  });

  it("stays small: the ten core packs together weigh about what the live sheet does", () => {
    const core = packs.filter(
      ([id]) => !CONTEXT_PACKS.has(id) && !COMPANION_PACKS.has(id) && !EXPANSION_PACKS.has(id)
    );
    expect(core).toHaveLength(10);
    const total = core.reduce((sum, [, p]) => sum + p.bytes, 0);
    expect(total).toBeLessThan(700 * 1024);
    for (const [, p] of packs) expect(p.bytes2x).toBeLessThan(400 * 1024);
  });

  it("keeps each context pack small: one loads only on its day, its weather or its moment", () => {
    for (const [id, p] of packs) {
      if (CONTEXT_PACKS.has(id)) expect(p.bytes, id).toBeLessThan(100 * 1024);
    }
  });

  it("keeps each companion scene's pack small too: one loads only for its moment", () => {
    for (const id of Array.from(COMPANION_PACKS)) {
      const p = PACKS[id as PackId];
      expect(p, id).toBeDefined();
      expect(p.bytes, id).toBeLessThan(100 * 1024);
      expect(p.frames, id).toBe(7);
    }
  });

  it("keeps each expansion scene's pack small too, all eight beats in one row", () => {
    expect(EXPANSION_PACKS.size).toBe(124);
    for (const id of Array.from(EXPANSION_PACKS)) {
      const p = PACKS[id as PackId];
      expect(p, id).toBeDefined();
      expect(p.bytes, id).toBeLessThan(100 * 1024);
      expect(p.frames, id).toBe(8);
    }
  });

  it("places every frame in a cell its pack has", () => {
    for (const [id, [pack, index]] of Object.entries(FRAMES)) {
      expect(index, id).toBeLessThan(PACKS[pack].frames);
    }
  });
});

describe("the Scenes tab's thumbnails", () => {
  it("are one small atlas, named after its bytes", () => {
    const bytes = readFileSync(onDisk(SCENE_THUMBS.src));
    expect(SCENE_THUMBS.src).toContain(`.${hashOf(bytes)}.webp`);
    expect(bytes.length).toBe(SCENE_THUMBS.bytes);
    expect(bytes.length).toBeLessThan(400 * 1024);
    expect(webpCanvas(bytes)).toEqual({
      w: SCENE_THUMBS.columns * SCENE_THUMBS.cell.w,
      h: SCENE_THUMBS.rows * SCENE_THUMBS.cell.h,
    });
  });

  it("have a cell for every expansion scene, each in the atlas", () => {
    const cells = SCENE_THUMBS.columns * SCENE_THUMBS.rows;
    for (const s of expansionSpec.sheets) {
      expect(THUMB_INDEX[s.pack], s.pack).toBeGreaterThanOrEqual(0);
      expect(THUMB_INDEX[s.pack], s.pack).toBeLessThan(cells);
    }
    expect(new Set(Object.values(THUMB_INDEX)).size).toBe(Object.keys(THUMB_INDEX).length);
  });

  it("show only scenes the site has, from packs that ship", () => {
    for (const name of Object.keys(THUMB_INDEX)) {
      expect(SCENES[name], name).toBeDefined();
      expect(PACKS[name as PackId], name).toBeDefined();
    }
  });
});

describe("public/mascot", () => {
  it("holds the sheet, the packs and the thumbnails, nothing else: the art sources never ship", () => {
    const expected = [
      MASCOT_SPRITE_URL,
      ...Object.values(PACKS).flatMap((p) => [p.src, p.src2x]),
      SCENE_THUMBS.src,
    ].map((u) => path.basename(u));
    const dir = path.join(process.cwd(), "public", "mascot");
    expect(readdirSync(dir).sort()).toEqual(expected.sort());
  });
});
