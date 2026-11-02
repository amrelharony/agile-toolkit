/**
 * The poster intro: what it shows with the story's art and before it, and the
 * timing its CSS keeps to.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { StoryCover } from "@/lib/comics/types";
import { PosterIntro } from "@/app/(tools)/comics/components/intro/poster-intro";
import styles from "@/app/(tools)/comics/components/intro/poster-intro.module.css";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { panelImageUrl } from "@/lib/comics/images";
import { INTRO_SECONDS, OVERLAY_ATTR } from "@/lib/comics/intro";
import { endsAt, sceneAnimations } from "./intro-css";

const SCENE = "src/app/(tools)/comics/components/intro/poster-intro.tsx";
const SCENE_CSS = "src/app/(tools)/comics/components/intro/poster-intro.module.css";

const TITLE = "The Unread Handover";

const cover = (n: number): StoryCover => ({
  pathSmall: `stories/12/${n}-768.webp`,
  width: 1536,
  height: 1024,
});
const FIVE_PANELS = [1, 2, 3, 4, 5].map(cover);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const dialog = () => screen.getByRole("dialog", { name: "Episode 12 intro" });

/** What's left of the overlay's text once the strings it may letter are taken out. */
function leftover(el: Element, allowed: string[]): string {
  let rest = el.textContent ?? "";
  for (const text of [...allowed].sort((a, b) => b.length - a.length)) {
    rest = rest.split(text).join(" ");
  }
  return rest;
}

interface KeyframeStep {
  /** The step's selector, as written: `0%`, `50.1%, 100%`, `to`. */
  steps: string;
  props: Map<string, string>;
}

/** Each @keyframes block in `css`, by name: its steps and what each one sets. */
function keyframesOf(css: string): Map<string, KeyframeStep[]> {
  const found = new Map<string, KeyframeStep[]>();
  const blocks = /@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;
  for (const block of Array.from(css.matchAll(blocks))) {
    const steps = Array.from(block[2].matchAll(/([^{}]+)\{([^{}]*)\}/g), (step) => {
      const props = new Map<string, string>();
      for (const decl of step[2].split(";")) {
        const colon = decl.indexOf(":");
        if (colon > 0) props.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
      }
      return { steps: step[1].trim(), props };
    });
    found.set(block[1], steps);
  }
  return found;
}

/** Inline background images in the overlay: only Amr's sheet should have one. */
function backgrounds(el: Element): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>("*"))
    .map((node) => node.style.backgroundImage)
    .filter(Boolean);
}

describe("the poster intro", () => {
  it("is the poster's dialog, named for its episode, with Skip", () => {
    render(<PosterIntro ep={12} title={TITLE} panels={[]} />);
    expect(dialog()).toHaveAttribute(OVERLAY_ATTR, "poster");
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(within(dialog()).getByRole("button", { name: "Skip intro" })).toBeInTheDocument();
  });

  it("with art: the first four panels' own files and Amr's sheet, nothing else drawn", () => {
    render(<PosterIntro ep={12} title={TITLE} panels={FIVE_PANELS} />);
    const srcs = Array.from(dialog().querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(srcs).toEqual(FIVE_PANELS.slice(0, 4).map((p) => panelImageUrl(p.pathSmall)));
    for (const img of Array.from(dialog().querySelectorAll("img"))) {
      expect(img).toHaveAttribute("alt", "");
    }
    const sheets = backgrounds(dialog());
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toContain(MASCOT_SPRITE_URL);
    expect(dialog().querySelector("svg, canvas, video, picture, iframe, object")).toBeNull();
  });

  it("with fewer panels, shows just those: two stacked, three with the first across", () => {
    const { rerender } = render(
      <PosterIntro ep={12} title={TITLE} panels={FIVE_PANELS.slice(0, 3)} />
    );
    const windows = () => Array.from(dialog().querySelectorAll("img"), (img) => img.parentElement!);
    expect(windows()).toHaveLength(3);
    expect(windows()[0]).toHaveClass(styles.wide);
    expect(windows()[1]).not.toHaveClass(styles.wide);
    expect(windows()[0].parentElement).not.toHaveClass(styles.stacked);

    rerender(<PosterIntro ep={12} title={TITLE} panels={FIVE_PANELS.slice(0, 2)} />);
    expect(windows()).toHaveLength(2);
    expect(windows()[0].parentElement).toHaveClass(styles.stacked);
  });

  it("without art: no picture but Amr, and the title in its window", () => {
    render(<PosterIntro ep={12} title={TITLE} panels={[]} />);
    expect(dialog().querySelector("img, svg, canvas, video, picture")).toBeNull();
    const sheets = backgrounds(dialog());
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toContain(MASCOT_SPRITE_URL);
    expect(within(dialog()).getByText(TITLE)).toBeInTheDocument();
  });

  it.each([
    ["with art", FIVE_PANELS],
    ["without art", []],
  ])("%s, letters only the episode and its title", (_, panels) => {
    render(<PosterIntro ep={12} title={TITLE} panels={panels} />);
    expect(within(dialog()).getByText("Episode 12")).toBeInTheDocument();
    expect(within(dialog()).getByText(TITLE)).toBeInTheDocument();
    expect(leftover(dialog(), ["Skip intro", "Episode 12", TITLE]).trim()).toBe("");
    // Lettering, not headings: the page underneath has its own h1.
    expect(within(dialog()).queryAllByRole("heading")).toHaveLength(0);
  });

  it("moves Amr by a wrapper, never by his own frames' element", () => {
    render(<PosterIntro ep={12} title={TITLE} panels={[]} />);
    const amr = dialog().querySelector<HTMLElement>("[data-amr-pose]")!;
    expect(amr).toHaveAttribute("data-amr-pose", "waving");
    expect(amr.className).toBe("intro-amr");
    expect(amr.parentElement?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("can be rendered by the server page: no client code, no hooks", () => {
    const source = readFileSync(path.join(process.cwd(), SCENE), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
  });
});

describe("the poster intro's timing", () => {
  const animations = sceneAnimations(SCENE_CSS);
  const css = readFileSync(path.join(process.cwd(), SCENE_CSS), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  const keyframes = keyframesOf(css);

  it("gives the overlay exactly one animation, the exit, ending with the intro", () => {
    const exit = animations.filter((a) => a.selector === ".overlay");
    expect(exit).toHaveLength(1);
    expect(endsAt(exit[0])).toBeCloseTo(INTRO_SECONDS.poster, 9);
  });

  it("leaves the overlay invisible when the exit ends", () => {
    const exit = animations.find((a) => a.selector === ".overlay")!;
    const last = keyframes.get(exit.name)!.at(-1)!;
    expect(last.steps).toMatch(/(?:^|,\s*)(?:100%|to)$/);
    expect(last.props.get("opacity")).toBe("0");
    expect(last.props.get("visibility")).toBe("hidden");
    expect(css).toMatch(/\.overlay\s*\{[^}]*animation:[^;]*\bboth\s*;/);
  });

  it("ends everything by then, and loops nothing", () => {
    expect(animations.length).toBeGreaterThan(5);
    for (const animation of animations) {
      expect(animation.iterations, animation.selector).not.toBe("infinite");
      expect(endsAt(animation), animation.selector).toBeLessThanOrEqual(INTRO_SECONDS.poster);
    }
  });

  it("holds every child's first frame until its turn, and its last after", () => {
    const values = Array.from(css.matchAll(/(?:^|[;{])\s*animation\s*:\s*([^;]+)/g), (m) => m[1]);
    expect(values.length).toBeGreaterThan(5);
    for (const value of values) {
      let depth = 0;
      const parts = [""];
      for (const char of value) {
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        if (char === "," && depth === 0) parts.push("");
        else parts[parts.length - 1] += char;
      }
      for (const part of parts) expect(part.trim(), part).toMatch(/\bboth$/);
    }
  });

  it("animates only transform, opacity, clip-path and visibility", () => {
    const allowed = new Set([
      "transform",
      "opacity",
      "clip-path",
      "visibility",
      "animation-timing-function",
    ]);
    expect(keyframes.size).toBeGreaterThan(0);
    for (const [name, steps] of Array.from(keyframes)) {
      for (const step of steps) {
        for (const prop of Array.from(step.props.keys())) {
          expect(allowed.has(prop), `${name} ${step.steps}: ${prop}`).toBe(true);
        }
      }
    }
  });

  it("uses only keyframes it defines", () => {
    for (const animation of animations) {
      expect(keyframes.has(animation.name), animation.name).toBe(true);
    }
  });
});
