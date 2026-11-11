/**
 * The public half of the cast puppet spec (docs/cast/cast-rig.json): one entry per
 * colleague of the bible, each in one batch, each asking ChatGPT for exactly the
 * images its body needs.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CAST } from "@/lib/vip/cast.generated";

const spec = JSON.parse(
  readFileSync(path.join(__dirname, "../../docs/cast/cast-rig.json"), "utf8")
);

const IMAGES = ["master", "parts", "parts2", "face", "face2", "arms"];
const MORE_PARTS = ["AAW-05", "AAW-18", "AAW-22", "AAW-24"];

describe("cast-rig.json", () => {
  it("has one entry per colleague, in the bible's order and names", () => {
    expect(spec.characters.map((c: { id: string }) => c.id)).toEqual(CAST.map((c) => c.id));
    expect(spec.characters.map((c: { name: string }) => c.name)).toEqual(CAST.map((c) => c.name));
  });

  it("puts every colleague in exactly one batch of six", () => {
    const all = Object.values(spec.batches as Record<string, string[]>).flat();
    expect(Object.keys(spec.batches)).toEqual(["A", "B", "C", "D", "E"]);
    for (const ids of Object.values(spec.batches as Record<string, string[]>))
      expect(ids).toHaveLength(6);
    expect([...all].sort()).toEqual(spec.characters.map((c: { id: string }) => c.id).sort());
  });

  it("makes the pilot one of each body family", () => {
    const fam = (id: string) => spec.characters.find((c: { id: string }) => c.id === id).family;
    const pilot = spec.batches.A.map(fam);
    expect(new Set(pilot).size).toBe(6);
  });

  it("asks each character for exactly the images its body needs", () => {
    for (const c of spec.characters) {
      expect(c.images[0]).toBe("master");
      for (const img of c.images) expect(IMAGES).toContain(img);
      expect(new Set(c.images).size).toBe(c.images.length);
      const fam = spec.families[c.family];
      expect(fam, c.family).toBeTruthy();
      expect(c.images.includes("arms")).toBe(fam.arms !== null);
      expect(c.images.includes("parts2")).toBe(MORE_PARTS.includes(c.id));
      expect(c.images.includes("face2")).toBe(c.id === "AAW-01");
      if (c.key) expect(Object.keys(spec.keys)).toContain(c.key);
    }
  });

  it("adds up to 124 images: 27, 24, 25, 24 and 24 by batch", () => {
    const count = (ids: string[]) =>
      ids.reduce(
        (n, id) => n + spec.characters.find((c: { id: string }) => c.id === id).images.length,
        0
      );
    expect(Object.values(spec.batches as Record<string, string[]>).map(count)).toEqual([
      27, 24, 25, 24, 24,
    ]);
  });

  it("keeps only the two flat keys, and budgets the rigs with more parts as complex", () => {
    expect(spec.keys).toEqual({ magenta: "#FF00FF", green: "#00FF00" });
    expect([...spec.budgets.complex].sort()).toEqual(MORE_PARTS);
  });

  it("lists each character's pieces once, pupils in pairs, more pieces only with image 2B", () => {
    for (const c of spec.characters) {
      const all = [...c.parts, ...(c.parts2 ?? [])];
      expect(new Set(all).size, c.id).toBe(all.length);
      expect(c.parts.includes("pupil-r"), c.id).toBe(c.parts.includes("pupil-l"));
      expect(Boolean(c.parts2), c.id).toBe(c.images.includes("parts2"));
      expect(
        all.some((p: string) => p === "head" || p === "torso"),
        c.id
      ).toBe(true);
      expect(
        all.every((p: string) => /^[a-z][a-z0-9-]*$/.test(p)),
        c.id
      ).toBe(true);
      expect(all, c.id).not.toContain("lanyard");
    }
  });

  it("shows ChatGPT only tolerances that exist", () => {
    for (const k of spec.shown_to_chatgpt) expect(spec.tolerances).toHaveProperty(k);
  });
});
