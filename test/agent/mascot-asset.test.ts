// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { SHEET } from "@/components/agent/mascot/engine/sprite-poses";

describe("Amr's sprite sheet", () => {
  const file = path.join(process.cwd(), "public", MASCOT_SPRITE_URL);

  it("is committed under public/ at the URL the sprite loads", () => {
    expect(MASCOT_SPRITE_URL).toMatch(/^\/mascot\/amr\.[0-9a-f]{8}\.webp$/);
    expect(statSync(file).isFile()).toBe(true);
  });

  it("is named after its content, so immutable caching is safe", () => {
    const bytes = readFileSync(file);
    const prefix = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    expect(MASCOT_SPRITE_URL).toContain(`amr.${prefix}.webp`);
  });

  it("is a WebP of the size the poses expect, small enough for every visitor", () => {
    expect(statSync(file).size).toBeLessThan(700 * 1024);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // A transparent sheet has a VP8X header: canvas size minus one, 24-bit LE.
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("VP8X");
    expect(bytes.readUIntLE(24, 3) + 1).toBe(SHEET.columns * SHEET.cellW);
    expect(bytes.readUIntLE(27, 3) + 1).toBe(SHEET.rows * SHEET.cellH);
  });

  it("is the only file in public/mascot: the pack's photo boards never ship", () => {
    const dir = path.join(process.cwd(), "public", "mascot");
    expect(readdirSync(dir)).toEqual([path.basename(MASCOT_SPRITE_URL)]);
  });
});
