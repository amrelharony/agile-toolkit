// @vitest-environment node
/**
 * public/cast holds exactly the atlases the generated rigs name: each named
 * after its bytes (so the /cast immutable caching is safe), its 2x exactly
 * twice its 1x, and within the budgets in docs/cast/cast-rig.json. Nothing is
 * shipped yet, so the folder may be empty or absent and the per-rig checks
 * have nothing to check; the folder, ignore and caching rules hold already.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config.mjs";
import spec from "../../docs/cast/cast-rig.json";
import { RIGS } from "@/lib/cast/rigs.generated";

const DIR = path.join(process.cwd(), "public", "cast");
const NAME = /^\/cast\/aaw-(0[1-9]|[12][0-9]|30)(@2x)?\.[0-9a-f]{8}\.webp$/;
const rigs = Object.values(RIGS);

const hashOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);
const onDisk = (url: string) => path.join(process.cwd(), "public", url);

/** A transparent WebP has a VP8X header: canvas size minus one, 24-bit LE. */
function webpCanvas(bytes: Buffer): { w: number; h: number } {
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("VP8X");
  return { w: bytes.readUIntLE(24, 3) + 1, h: bytes.readUIntLE(27, 3) + 1 };
}

describe("public/cast", () => {
  it("holds the generated rigs' atlases and nothing else (empty or absent while none ships)", () => {
    const expected = rigs.flatMap((r) => [r.atlas.x1, r.atlas.x2]).map((u) => path.basename(u));
    const found = existsSync(DIR) ? readdirSync(DIR) : [];
    expect(found.sort()).toEqual(expected.sort());
    expect(found.length).toBeLessThanOrEqual(60);
  });

  it("is ignored by git except for the atlases", () => {
    const ignore = readFileSync(path.join(process.cwd(), ".gitignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    expect(ignore).toContain("/public/cast/*");
    const exceptions = ignore.filter((l) => l.startsWith("!/public/cast/"));
    expect(exceptions).toEqual(["!/public/cast/aaw-*.webp"]);
  });

  it("is served with immutable caching, like /mascot", async () => {
    const rules = await nextConfig.headers!();
    const cache = (source: string) =>
      rules.find((r) => r.source === source)?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cache("/cast/:path*")).toBe("public, max-age=31536000, immutable");
    expect(cache("/cast/:path*")).toBe(cache("/mascot/:path*"));
  });
});

describe.skipIf(rigs.length === 0)("each shipped rig's atlas", () => {
  it.each(rigs.map((r) => [r.id, r] as const))(
    "%s is committed at both sizes, named after its bytes",
    (_id, rig) => {
      for (const [url, size] of [
        [rig.atlas.x1, rig.atlas.bytes1],
        [rig.atlas.x2, rig.atlas.bytes2],
      ] as const) {
        expect(url).toMatch(NAME);
        expect(url).toContain(`aaw-${rig.id.slice(4)}`);
        const bytes = readFileSync(onDisk(url));
        expect(url).toContain(`.${hashOf(bytes)}.webp`);
        expect(bytes.length).toBe(size);
      }
    }
  );

  it.each(rigs.map((r) => [r.id, r] as const))("%s has a 2x exactly twice its 1x", (_id, rig) => {
    const one = webpCanvas(readFileSync(onDisk(rig.atlas.x1)));
    const two = webpCanvas(readFileSync(onDisk(rig.atlas.x2)));
    expect(two).toEqual({ w: one.w * 2, h: one.h * 2 });
  });

  it.each(rigs.map((r) => [r.id, r] as const))("%s is within its budget", (_id, rig) => {
    const complex = (spec.budgets.complex as string[]).includes(rig.id);
    const kb1 = complex ? spec.budgets.atlas_complex_1x_kb : spec.budgets.atlas_1x_kb;
    const kb2 = complex ? spec.budgets.atlas_complex_2x_kb : spec.budgets.atlas_2x_kb;
    expect(rig.atlas.bytes1).toBeLessThanOrEqual(kb1 * 1024);
    expect(rig.atlas.bytes2).toBeLessThanOrEqual(kb2 * 1024);
  });
});
