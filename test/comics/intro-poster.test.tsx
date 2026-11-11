/**
 * The poster intro: what it shows with a story's art and without it, the timing
 * its CSS keeps to, and where a book episode's page puts it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Story, StoryCover } from "@/lib/comics/types";

const h = vi.hoisted(() => ({ story: null as Story | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  getReleasedStory: async () => h.story,
  getStoryExtras: async () => ({ quiz: null, tryTool: null }),
  listReleasedWeekly: async () => [],
  listReleasedEps: async () => [],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => null,
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
import ComicStoryPage from "@/app/(tools)/comics/ep/[n]/page";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { bookEpisode } from "@/lib/comics/book-episodes";
import { panelImageUrl } from "@/lib/comics/images";
import { INTRO_ATTR, INTRO_RUN_ATTR, INTRO_SECONDS, OVERLAY_ATTR } from "@/lib/comics/intro";
import { EASE } from "@/lib/motion/tokens";
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
  document.documentElement.removeAttribute(INTRO_ATTR);
  document.documentElement.removeAttribute(INTRO_RUN_ATTR);
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
    // The dialog carries the exit, whose end is what ends the intro.
    expect(dialog()).toHaveClass(styles.overlay);
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

  it("without art, lights the title's window with one empty, decorative light, under the lettering", () => {
    render(<PosterIntro ep={12} title={TITLE} panels={[]} />);
    const window = dialog().querySelector<HTMLElement>(`.${styles.bigWindow}`)!;
    const lights = Array.from(window.querySelectorAll('[data-look="light"]'));
    expect(lights).toHaveLength(1);
    const [light] = lights;
    expect(light.parentElement).toBe(window);
    expect(light).toHaveAttribute("aria-hidden", "true");
    expect(light.textContent).toBe("");
    expect(light).toHaveClass(styles.titleLight);
    expect(light.firstElementChild).toHaveClass(styles.titleStripe);
    // Beside the lettering. The light is positioned, so it would paint over
    // the text whatever the order: the CSS puts it under (see "lays the
    // title's light under its lettering" below).
    expect(light.nextElementSibling).toHaveTextContent(TITLE);
    expect(dialog().querySelectorAll('[data-look="light"]')).toHaveLength(1);
  });

  it("with art, lights nothing: the title stands on the page, in no window", () => {
    render(<PosterIntro ep={12} title={TITLE} panels={FIVE_PANELS} />);
    expect(dialog().querySelector('[data-look="light"]')).toBeNull();
  });

  it.each([
    ["with art", FIVE_PANELS],
    ["without art", []],
  ])("%s, shades the page with one stepped shade, last on it, and no grain", (_, panels) => {
    render(<PosterIntro ep={12} title={TITLE} panels={panels} />);
    const page = dialog().querySelector(`.${styles.page}`)!;
    const shades = Array.from(dialog().querySelectorAll('[data-look="turn"]'));
    expect(shades).toHaveLength(1);
    expect(page.lastElementChild).toBe(shades[0]);
    expect(shades[0]).toHaveClass(styles.liftShade);
    expect(shades[0]).toHaveAttribute("aria-hidden", "true");
    // The grain is the books' alone.
    expect(dialog().querySelector('[data-look="grain"]')).toBeNull();
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

  /** The one animation `selector` runs, leaving out a window's reveal. */
  function only(selector: string) {
    const found = animations.filter((a) => a.selector === selector && a.name !== "reveal");
    expect(found, selector).toHaveLength(1);
    return found[0];
  }

  const squash = (value: string | undefined) => (value ?? "").replace(/\s+/g, "");

  it("crosses the title's window with the stripe only once it has inked in, and rests it before the page lifts", () => {
    const stripe = only(".titleStripe");
    const reveal = animations.find((a) => a.selector === ".bigWindow" && a.name === "reveal")!;
    expect(endsAt(reveal)).toBeCloseTo(0.92, 9);
    expect(stripe.delay).toBeGreaterThanOrEqual(endsAt(reveal));
    expect(endsAt(stripe)).toBeLessThanOrEqual(only(".overlay").delay);
    // Only the track moves, sideways, and it stops on the window.
    for (const step of keyframes.get(stripe.name)!) {
      expect(Array.from(step.props.keys())).toEqual(["transform"]);
      expect(step.props.get("transform")).toMatch(/^translateX\(-?[\d.]+%\)$/);
    }
  });

  /** The top-level rule written for `selector` alone, as written. */
  const ruleOf = (selector: string) => {
    const found = Array.from(
      css.matchAll(new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^}]*)\\}`, "g")),
      (m) => m[1]
    );
    expect(found, selector).toHaveLength(1);
    return found[0];
  };

  // The light is positioned (intro-look.module.css), so without these it would
  // paint over the in-flow lettering whatever the DOM order, and its shade or
  // Night's stripe would sit on the title.
  it("lays the title's light under its lettering, inside the window's own layer", () => {
    const z = /(?:^|;)\s*z-index:\s*(-?\d+)\s*;/.exec(ruleOf(".titleLight"))?.[1];
    expect(Number(z)).toBeLessThan(0);
    // A layer of its own, so the light goes under the title and not under the window's paper.
    expect(ruleOf(".bigWindow")).toMatch(/(?:^|;)\s*isolation:\s*isolate\s*;/);
  });

  it("darkens the page in three flat steps as it lifts away, and is done by the end", () => {
    const shade = only(".liftShade");
    expect(shade.delay).toBeGreaterThanOrEqual(only(".overlay").delay);
    expect(endsAt(shade)).toBeLessThanOrEqual(INTRO_SECONDS.poster);
    expect(easingsOf(css, ".liftShade", shade.name)).toEqual([
      expect.stringMatching(/^steps\(3\b/),
    ]);
    const steps = keyframes.get(shade.name)!;
    expect(steps[0].props.get("opacity")).toBe("0");
    expect(steps.at(-1)!.props.get("opacity")).toBe("0.24");
  });

  it.each([
    [".caption", "pop"],
    [".amrRise", "pop"],
    [".bigWindow", "settle"],
    [".w1", "settle"],
    [".w2", "settle"],
    [".w3", "settle"],
    [".w4", "settle"],
  ] as const)("lands %s on the book's %s spring, in one leg", (selector, spring) => {
    const steps = keyframes.get(only(selector).name)!;
    // From and to alone: a step between them would be a hand-made overshoot.
    expect(steps.map((s) => s.steps)).toEqual(["from", "to"]);
    const [from, to] = steps;
    expect(squash(from.props.get("animation-timing-function"))).toBe(squash(EASE[spring]));
    expect(to.props.has("animation-timing-function")).toBe(false);
  });

  it("inks the page in straight, or bowed where shape() works, on the same time", () => {
    const inks = animations.filter((a) => a.selector === ".page");
    expect(inks.map((a) => a.name)).toEqual(["ink", "ink-bowed"]);
    expect([inks[1].duration, inks[1].delay]).toEqual([inks[0].duration, inks[0].delay]);
  });
});

describe("a book episode's page", () => {
  const params = { params: { n: "12" } };

  it("puts the intro beside the page's wrapper, not inside it", async () => {
    render(await ComicStoryPage(params));
    const wrapper = screen.getByTestId("tool-page-wrapper");
    expect(wrapper.contains(dialog())).toBe(false);
    expect(dialog().parentElement).toBe(wrapper.parentElement);
  });

  // The book's episodes are never put online, so the intro letters the printed
  // title and shows no art, even if the store had a row for the number.
  it("letters the book's title, with no art", async () => {
    h.story = STORY;
    render(await ComicStoryPage(params));
    const book = bookEpisode(12)!;
    expect(within(dialog()).getByText(book.title)).toBeInTheDocument();
    expect(within(dialog()).queryByText(TITLE)).toBeNull();
    expect(
      dialog().querySelector(`img[src="${panelImageUrl(STORY.panels[0].pathSmall)}"]`)
    ).toBeNull();
  });

  it("offers the intro again, on the page itself, and it plays the poster's", async () => {
    render(await ComicStoryPage(params));
    const replay = await screen.findByRole("button", { name: "Replay intro" });
    expect(screen.getByTestId("tool-page-wrapper")).toContainElement(replay);
    fireEvent.click(replay);
    expect(document.documentElement.getAttribute(INTRO_ATTR)).toBe("poster");
    expect(document.activeElement).toBe(
      within(dialog()).getByRole("button", { name: "Skip intro" })
    );
  });
});
