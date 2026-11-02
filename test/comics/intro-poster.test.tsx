/**
 * The poster intro: what it shows with the story's art and before it, the timing
 * its CSS keeps to, and where the poster page puts it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Story, StoryCover } from "@/lib/comics/types";

const h = vi.hoisted(() => ({ story: null as Story | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  getReleasedStory: async () => h.story,
  listReleasedWeekly: async () => [],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div data-testid="tool-page-wrapper">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import { PosterIntro } from "@/app/(tools)/comics/components/intro/poster-intro";
import styles from "@/app/(tools)/comics/components/intro/poster-intro.module.css";
import ComicPosterPage from "@/app/(tools)/comics/poster/[n]/page";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { bookEpisode } from "@/lib/comics/book-episodes";
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

const STORY: Story = {
  ep: 12,
  collection: "book",
  title: TITLE,
  lesson: "Write it down before you leave.",
  squadQuestion: "What would we lose if you left today?",
  castNames: ["Amr"],
  themes: ["T08"],
  panels: [1, 2].map((n) => ({
    ...cover(n),
    pathFull: `stories/12/${n}-1536.webp`,
    alt: `Panel ${n}.`,
    dialogue: [],
    signs: [],
  })),
  sharePath: null,
  bookPage: 73,
  releaseAt: "2026-10-26T07:00:00.000Z",
  updatedAt: "2026-10-26T07:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  window.history.replaceState(null, "", "/comics?ep=12");
  h.story = null;
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

/** A shorthand's comma-separated animations: cubic-bezier(…) has commas of its own. */
function splitAnimations(value: string): string[] {
  let depth = 0;
  const parts = [""];
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts.map((part) => part.trim());
}

/**
 * The timing function of each `name` animation in the rules for exactly
 * `selector`, in source order: what's left of it once its name, times and fill
 * are taken out.
 */
function easingsOf(css: string, selector: string, name: string): string[] {
  const found: string[] = [];
  for (const block of Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))) {
    if (block[1].trim() !== selector) continue;
    for (const decl of Array.from(block[2].matchAll(/(?:^|;)\s*animation\s*:\s*([^;]+)/g))) {
      for (const part of splitAnimations(decl[1])) {
        const [first, ...rest] = part.split(/\s+/);
        if (first !== name) continue;
        found.push(rest.filter((t) => !/^-?\d*\.?\d+m?s$/.test(t) && t !== "both").join(" "));
      }
    }
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
      // The windows are decoration: the page underneath describes the panels.
      expect(img.closest('[aria-hidden="true"]')).not.toBeNull();
      // They open by 0.5 s: lazy loading would start too late.
      expect(img).toHaveAttribute("loading", "eager");
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

describe("the poster intro's CSS", () => {
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
      for (const part of splitAnimations(value)) expect(part, part).toMatch(/\bboth$/);
    }
  });

  // A window's own edge follows its band's leading edge only while the two keep
  // the same time: retime one alone and bare art shows ahead of the ink, or ink
  // runs over nothing.
  it.each([".w1", ".w2", ".w3", ".w4", ".bigWindow"])("inks %s in on its band's time", (window) => {
    const reveals = animations.filter((a) => a.selector === window && a.name === "reveal");
    const bands = animations.filter((a) => a.selector === `${window}::after` && a.name === "band");
    expect(reveals.length).toBeGreaterThan(0);
    expect(bands).toHaveLength(reveals.length);
    reveals.forEach((reveal, i) => {
      expect(bands[i].duration, `${window} duration`).toBeCloseTo(reveal.duration, 9);
      expect(bands[i].delay, `${window} delay`).toBeCloseTo(reveal.delay, 9);
    });
    expect(easingsOf(css, `${window}::after`, "band")).toEqual(easingsOf(css, window, "reveal"));
  });

  it("animates its own plain classes only, so never Amr's frames", () => {
    for (const animation of animations) {
      expect(animation.selector).toMatch(/^\.[\w-]+(?:::after)?$/);
    }
  });

  it("keeps everything under Skip, and draws no picture of its own", () => {
    // Skip is z-index 10 in the same stacking context (globals.css), so anything
    // here at 10 or more would cover it.
    for (const [, value] of Array.from(css.matchAll(/z-index\s*:\s*([^;}]+)/g))) {
      expect(Number(value.trim()), `z-index: ${value}`).toBeLessThan(10);
    }
    expect(css).not.toMatch(/background-image|url\(|gradient\(/);
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

describe("the poster page", () => {
  const params = { params: { n: "12" } };

  it("puts the intro beside the page's wrapper, not inside it", async () => {
    render(await ComicPosterPage(params));
    const wrapper = screen.getByTestId("tool-page-wrapper");
    expect(wrapper.contains(dialog())).toBe(false);
    expect(dialog().parentElement).toBe(wrapper.parentElement);
  });

  it("before the art: letters the book's title", async () => {
    render(await ComicPosterPage(params));
    const book = bookEpisode(12)!;
    expect(within(dialog()).getByText(book.title)).toBeInTheDocument();
    expect(dialog().querySelector("img")).toBeNull();
  });

  it("with the art: the story's title and its own panels", async () => {
    h.story = STORY;
    render(await ComicPosterPage(params));
    expect(within(dialog()).getByText(TITLE)).toBeInTheDocument();
    const srcs = Array.from(dialog().querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(srcs).toEqual(STORY.panels.map((p) => panelImageUrl(p.pathSmall)));
  });

  it("offers the intro again, on the page itself", async () => {
    render(await ComicPosterPage(params));
    const replay = await screen.findByRole("button", { name: "Replay intro" });
    expect(screen.getByTestId("tool-page-wrapper")).toContainElement(replay);
  });
});
