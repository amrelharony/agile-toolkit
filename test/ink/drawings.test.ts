/**
 * Ink drawings are data (lib/ink/drawings), drawn by hand in code. These checks
 * keep them honest: every navigation section has its picture, every colour is
 * a theme tone (never a hex), paths are plain path data, and each drawing stays
 * within its size budget, since the section set ships with every tool page.
 */
import { describe, expect, it } from "vitest";
import { SECTIONS } from "@/lib/constants/sections";
import { SECTION_ART, SECTION_TONE } from "@/lib/ink/drawings/sections";
import { PAGE_ART } from "@/lib/ink/drawings/pages";
import { MARKS } from "@/lib/ink/drawings/marks";
import { HOME_HERO } from "@/lib/ink/drawings/scenes/home-hero";
import { NOT_FOUND_SCENE } from "@/lib/ink/drawings/scenes/not-found";
import { ERROR_SCENE } from "@/lib/ink/drawings/scenes/error";
import { INK_TONES, type InkDrawing } from "@/lib/ink/types";

const SPOTS: InkDrawing[] = [...Object.values(SECTION_ART), ...Object.values(PAGE_ART)];
const SCENES: InkDrawing[] = [HOME_HERO, NOT_FOUND_SCENE, ERROR_SCENE];
const ALL: InkDrawing[] = [...SPOTS, ...SCENES, ...Object.values(MARKS)];

const PATH = /^M[\d.\s,MLHVQTCSAZmlhvqtcsaz-]+$/;
const bytes = (d: InkDrawing) =>
  d.strokes.reduce((n, s) => n + s.d.length + (s.fillD?.length ?? 0), 0);

describe("ink drawings", () => {
  it("gives every navigation section a drawing and a tone", () => {
    for (const section of SECTIONS) {
      expect(SECTION_ART[section.id], section.id).toBeDefined();
      expect(SECTION_TONE[section.id], section.id).toBeDefined();
    }
  });

  it("names every drawing uniquely", () => {
    const names = ALL.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(ALL.map((d) => [d.name, d] as const))(
    "%s uses plain path data and theme tones only",
    (_, d) => {
      expect(d.viewBox).toMatch(/^0 0 \d+ \d+$/);
      for (const s of d.strokes) {
        expect(s.d).toMatch(PATH);
        if (s.fillD) expect(s.fillD).toMatch(PATH);
        for (const tone of [s.tone, s.fill]) {
          if (tone) expect(INK_TONES).toContain(tone);
        }
      }
      for (const w of d.washes ?? []) expect(INK_TONES).toContain(w.tone);
      expect(JSON.stringify(d)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  );

  it("keeps spot art small: at most 24 strokes and 2 KB of path data each", () => {
    for (const d of SPOTS) {
      expect(d.viewBox, d.name).toBe("0 0 96 96");
      expect(d.strokes.length, d.name).toBeLessThanOrEqual(24);
      expect(bytes(d), d.name).toBeLessThanOrEqual(2048);
    }
  });

  it("keeps the section set, which every tool page downloads, under 16 KB", () => {
    const total = Object.values(SECTION_ART).reduce((n, d) => n + bytes(d), 0);
    expect(total).toBeLessThanOrEqual(16 * 1024);
  });

  it("keeps each scene under 8 KB of path data", () => {
    for (const d of SCENES) {
      expect(d.viewBox, d.name).toBe("0 0 320 200");
      expect(bytes(d), d.name).toBeLessThanOrEqual(8 * 1024);
    }
  });
});
