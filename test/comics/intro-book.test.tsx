/**
 * The book's intro at /comics: what it shows with this week's story and
 * without, the timing its CSS keeps, and where the gallery page puts it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { StoryCover, StorySummary } from "@/lib/comics/types";

const h = vi.hoisted(() => ({
  summaries: [] as StorySummary[],
  listCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  listReleasedWeekly: async () => {
    h.listCalls += 1;
    return h.summaries;
  },
  listStoryTotals: async () => new Map(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div data-testid="tool-page-wrapper">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import ComicsPage from "@/app/(tools)/comics/page";
import { BookIntro } from "@/app/(tools)/comics/components/intro/book-intro";
import styles from "@/app/(tools)/comics/components/intro/book-intro.module.css";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { COVER_INTRO_URL } from "@/lib/book/art";
import { panelImageUrl } from "@/lib/comics/images";
import { INTRO_ATTR, INTRO_RUN_ATTR, INTRO_SECONDS, OVERLAY_ATTR } from "@/lib/comics/intro";
import { endsAt, sceneAnimations } from "./intro-css";

const SCENE = "src/app/(tools)/comics/components/intro/book-intro";
const CSS_FILE = `${SCENE}.module.css`;

const COVER: StoryCover = { pathSmall: "stories/30/one-768.webp", width: 1536, height: 1024 };
const TITLE = "The Unread Handover";

/** Every string the scene may letter, Skip included (the shared part's). */
const ALLOWED = [
  "Skip intro",
  "Agile at Work",
  "Workplace comics by Amr Elharony",
  "This week's story",
];

const summary = (ep: number, title: string, cover: StoryCover | null = COVER): StorySummary => ({
  ep,
  title,
  lesson: `Lesson of ${title}`,
  castNames: ["Amr"],
  themes: ["T01"],
  cover,
  releaseAt: "2026-10-26T07:00:00.000Z",
  updatedAt: "2026-10-26T07:00:00.000Z",
});

function overlay(): HTMLElement {
  return screen.getByRole("dialog", { name: "Agile at Work intro" });
}

/** The overlay's words once every allowed string is taken out. */
function leftoverText(el: HTMLElement, extra: readonly string[] = []): string {
  let text = el.textContent ?? "";
  for (const allowed of [...extra, ...ALLOWED].sort((a, b) => b.length - a.length)) {
    text = text.split(allowed).join(" ");
  }
  return text;
}

function srcs(el: HTMLElement): (string | null)[] {
  return Array.from(el.querySelectorAll("img")).map((img) => img.getAttribute("src"));
}

/** The file behind every inline background image in `el`: only Amr's sheet should be one. */
function backgrounds(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>("*"))
    .map((node) => node.style.backgroundImage)
    .filter(Boolean)
    .map((image) => image.replace(/^url\(["']?|["']?\)$/g, ""));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  h.summaries = [];
  h.listCalls = 0;
  window.history.replaceState(null, "", "/comics");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(INTRO_ATTR);
  document.documentElement.removeAttribute(INTRO_RUN_ATTR);
  vi.unstubAllEnvs();
});

describe("the book intro", () => {
  it("is the book's named dialog with Skip", () => {
    render(<BookIntro latest={null} />);
    const dialog = overlay();
    expect(dialog).toHaveAttribute(OVERLAY_ATTR, "book");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Skip intro" })).toBeTruthy();
    // The dialog carries the exit, whose end is what ends the intro.
    expect(dialog).toHaveClass(styles.overlay);
  });

  it("letters the cover under its art, and opens onto this week's story and its panel", () => {
    render(<BookIntro latest={{ title: TITLE, cover: COVER }} />);
    const dialog = overlay();
    expect(within(dialog).getByText("This week's story")).toBeTruthy();
    expect(within(dialog).getByText(TITLE)).toBeTruthy();
    expect(dialog.textContent).toContain("Agile at Work");
    expect(dialog.textContent).toContain("Workplace comics by Amr Elharony");
    expect(leftoverText(dialog, [TITLE]).trim()).toBe("");
  });

  it("shows only the story's panel, the book's cover and Amr's sheet", () => {
    render(<BookIntro latest={{ title: TITLE, cover: COVER }} />);
    const dialog = overlay();
    const images = Array.from(dialog.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(images).toEqual([panelImageUrl(COVER.pathSmall), COVER_INTRO_URL]);
    expect(dialog.querySelector("svg")).toBeNull();
    expect(backgrounds(dialog)).toEqual([MASCOT_SPRITE_URL]);
    expect(dialog.querySelector("[data-amr-pose]")).toHaveAttribute("data-amr-pose", "waving");
  });

  it("letters the title alone while the story has no art", () => {
    render(<BookIntro latest={{ title: TITLE, cover: null }} />);
    const dialog = overlay();
    expect(srcs(dialog)).toEqual([COVER_INTRO_URL]);
    expect(dialog.querySelector("svg")).toBeNull();
    expect(within(dialog).getByText("This week's story")).toBeTruthy();
    expect(within(dialog).getByText(TITLE)).toBeTruthy();
    expect(backgrounds(dialog)).toEqual([MASCOT_SPRITE_URL]);
    expect(leftoverText(dialog, [TITLE]).trim()).toBe("");
  });

  it("opens onto nothing but Amr before any story is out", () => {
    render(<BookIntro latest={null} />);
    const dialog = overlay();
    expect(srcs(dialog)).toEqual([COVER_INTRO_URL]);
    expect(dialog.querySelector("svg")).toBeNull();
    expect(within(dialog).queryByText("This week's story")).toBeNull();
    expect(backgrounds(dialog)).toEqual([MASCOT_SPRITE_URL]);
    expect(dialog.querySelector("[data-amr-pose]")).toHaveAttribute("data-amr-pose", "waving");
    expect(leftoverText(dialog).trim()).toBe("");
  });

  it("fronts the book with its cover's art, lazily, over the lettered cover", () => {
    render(<BookIntro latest={null} />);
    const art = Array.from(overlay().querySelectorAll("img")).find(
      (img) => img.getAttribute("src") === COVER_INTRO_URL
    )!;
    // The lettering says what the cover says, so the art adds no words.
    expect(art).toHaveAttribute("alt", "");
    // Fetched only when the intro shows: the head script preloads it then.
    expect(art).toHaveAttribute("loading", "lazy");
    expect(art).toHaveClass(styles.art);
    const front = art.parentElement!;
    expect(front.textContent).toContain("Agile at Work");
    expect(front.lastElementChild).toBe(art);
  });

  it("letters in paragraphs, never headings, since the page has its own h1", () => {
    render(<BookIntro latest={{ title: TITLE, cover: COVER }} />);
    expect(within(overlay()).queryAllByRole("heading")).toEqual([]);
  });

  it("moves Amr only through wrappers: his own element keeps just his frames", () => {
    render(<BookIntro latest={null} />);
    const amr = overlay().querySelector("[data-amr-pose]")!;
    expect(amr.getAttribute("class")).toBe("intro-amr");
    expect(amr.parentElement!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders the same markup every time, with no hooks and no client boundary", () => {
    const source = readFileSync(path.join(process.cwd(), `${SCENE}.tsx`), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date/);
  });
});

describe("the book's pages", () => {
  function parts(latest: { title: string; cover: StoryCover | null } | null) {
    render(<BookIntro latest={latest} />);
    const dialog = overlay();
    const book = dialog.querySelector<HTMLElement>(`.${styles.book}`)!;
    const one = (cls: string) => book.querySelector<HTMLElement>(`:scope > .${cls}`)!;
    return {
      dialog,
      book,
      inside: one(styles.inside),
      leaf1: one(styles.leaf1),
      leaf2: one(styles.leaf2),
      cover: one(styles.cover),
    };
  }

  const STORIES = [
    ["with art", { title: TITLE, cover: COVER }],
    ["without art", { title: TITLE, cover: null }],
    ["before any story", null],
  ] as const;

  it.each(STORIES)("turns two pages between the inside page and the cover, %s", (_, latest) => {
    const { book, inside, leaf1, leaf2, cover } = parts(latest);
    const order = Array.from(book.children);
    expect(order.indexOf(inside)).toBeGreaterThan(-1);
    expect(order.indexOf(leaf1)).toBeGreaterThan(order.indexOf(inside));
    expect(order.indexOf(leaf2)).toBeGreaterThan(order.indexOf(leaf1));
    expect(order.indexOf(cover)).toBeGreaterThan(order.indexOf(leaf2));
    for (const leaf of [leaf1, leaf2]) {
      expect(leaf).toHaveAttribute("aria-hidden", "true");
      expect(leaf.querySelectorAll(`:scope > .${styles.face}`)).toHaveLength(2);
      expect(leaf.querySelectorAll(`:scope > .${styles.back}`)).toHaveLength(1);
    }
  });

  it("darkens each page's front on that page's own clock, and never its back", () => {
    // One BlankLeaf draws both pages, so each must be handed its own shade.
    const { leaf1, leaf2 } = parts({ title: TITLE, cover: COVER });
    const shades = (leaf: HTMLElement, side: string) =>
      Array.from(leaf.querySelectorAll<HTMLElement>(`:scope > ${side} > [data-look="turn"]`));
    const front = `.${styles.face}:not(.${styles.back})`;
    for (const [leaf, own, other] of [
      [leaf1, styles.leaf1Shade, styles.leaf2Shade],
      [leaf2, styles.leaf2Shade, styles.leaf1Shade],
    ] as const) {
      const [shade, ...more] = shades(leaf, front);
      expect(more).toEqual([]);
      expect(shade).toHaveClass(own);
      expect(shade).not.toHaveClass(other);
      // The back lands face up as the spread's left page: no turn shade there.
      expect(shades(leaf, `.${styles.back}`)).toEqual([]);
    }
  });

  it.each(STORIES)("turns two blank pages, %s", (_, latest) => {
    const { leaf1, leaf2 } = parts(latest);
    for (const leaf of [leaf1, leaf2]) {
      expect(leaf.querySelector("img")).toBeNull();
      expect(leaf.textContent).toBe("");
    }
  });

  it("holds this week's panel on the inside page, above the title", () => {
    const { inside } = parts({ title: TITLE, cover: COVER });
    const images = Array.from(inside.querySelectorAll("img"));
    expect(images).toHaveLength(1);
    const [panel] = images;
    expect(panel.getAttribute("src")).toBe(panelImageUrl(COVER.pathSmall));
    expect(panel).toHaveAttribute("alt", "");
    expect(panel).toHaveAttribute("loading", "lazy");
    expect(panel.hasAttribute("srcset")).toBe(false);
    // In the page's own 3:2 window, never on a sheet's face that turns.
    const frame = panel.parentElement!;
    expect(frame).toHaveClass(styles.window);
    expect(frame.parentElement).toBe(inside);
    expect(panel.closest(`.${styles.face}`)).toBeNull();
    // The window first, then the title under it.
    const caption = within(inside).getByText(TITLE).parentElement!;
    const kids = Array.from(inside.children);
    expect(kids.indexOf(frame)).toBeGreaterThan(-1);
    expect(kids.indexOf(caption)).toBeGreaterThan(kids.indexOf(frame));
  });

  it.each(STORIES.slice(1))("keeps the inside page without a picture %s", (_, latest) => {
    const { inside } = parts(latest);
    expect(inside.querySelector("img")).toBeNull();
    expect(inside.querySelector(`.${styles.window}`)).toBeNull();
  });

  it.each(STORIES)("shows no picture twice, %s", (_, latest) => {
    const all = srcs(parts(latest).dialog);
    expect(new Set(all).size).toBe(all.length);
  });

  it("letters the title under the panel, four lines at most, where it inks in", () => {
    const { inside } = parts({ title: TITLE, cover: COVER });
    const caption = within(inside).getByText(TITLE).parentElement!;
    expect(caption.parentElement).toBe(inside);
    expect(caption).toHaveClass(styles.titleInk);
    expect(caption).toHaveClass(styles.caption);
    expect(caption).not.toHaveClass(styles.captionAlone);
    expect(within(caption).getByText("This week's story")).toHaveClass(styles.eyebrow);
    const title = within(caption).getByText(TITLE);
    expect(title).toHaveClass(styles.storyTitle);
    expect(title).toHaveClass("line-clamp-4");
  });

  it("letters the title alone, larger, while the story has no art", () => {
    const { inside } = parts({ title: TITLE, cover: null });
    const caption = within(inside).getByText(TITLE).parentElement!;
    expect(caption.parentElement).toBe(inside);
    expect(caption).toHaveClass(styles.titleInk);
    expect(caption).toHaveClass(styles.captionAlone);
    expect(caption).not.toHaveClass(styles.caption);
    const title = within(caption).getByText(TITLE);
    expect(title).toHaveClass(styles.storyTitleAlone);
    expect(title).toHaveClass("line-clamp-4");
  });

  it("lays the cover's grain, light and shade over its art, written before it", () => {
    const { cover } = parts(null);
    const art = cover.querySelector("img")!;
    const front = art.parentElement!;
    const kids = Array.from(front.children);
    for (const look of ["grain", "light", "turn"]) {
      const part = front.querySelector<HTMLElement>(`:scope > [data-look="${look}"]`)!;
      expect(part, look).not.toBeNull();
      expect(part).toHaveClass(styles.overArt);
      expect(kids.indexOf(part)).toBeLessThan(kids.indexOf(art));
    }
    expect(front.lastElementChild).toBe(art);
  });

  it("rests a stripe of light on the inside page, under the panel, and nothing there moves it", () => {
    const { inside } = parts({ title: TITLE, cover: COVER });
    const light = inside.querySelector<HTMLElement>(':scope > [data-look="light"]')!;
    expect(light).not.toBeNull();
    expect(light.firstElementChild).toHaveClass(styles.restingLight);
    const animated = new Set(sceneAnimations(CSS_FILE).map((a) => styles[a.selector.slice(1)]));
    for (const el of [light, ...Array.from(light.querySelectorAll("*"))]) {
      for (const cls of Array.from(el.classList)) expect(animated.has(cls), cls).toBe(false);
    }
    // Nothing moves the panel's window either: the second page uncovers it.
    const frame = inside.querySelector<HTMLElement>(`:scope > .${styles.window}`)!;
    for (const cls of Array.from(frame.classList)) expect(animated.has(cls), cls).toBe(false);
    const kids = Array.from(inside.children);
    expect(kids.indexOf(light)).toBeLessThan(kids.indexOf(frame));
  });

  it("lays each page's back, the spread's left page once it lands, in the same light, still", () => {
    const { leaf1, leaf2 } = parts({ title: TITLE, cover: COVER });
    const animated = new Set(sceneAnimations(CSS_FILE).map((a) => styles[a.selector.slice(1)]));
    for (const leaf of [leaf1, leaf2]) {
      const back = leaf.querySelector<HTMLElement>(`:scope > .${styles.back}`)!;
      const light = back.querySelector<HTMLElement>(':scope > [data-look="light"]')!;
      expect(light.firstElementChild).toHaveClass(styles.shadeOnly);
      for (const el of [light, ...Array.from(light.querySelectorAll("*"))]) {
        for (const cls of Array.from(el.classList)) expect(animated.has(cls), cls).toBe(false);
      }
      expect(back.querySelector('[data-look="grain"]')).not.toBeNull();
    }
  });

  it.each(STORIES)(
    "puts every look part inside a face, never on what keeps the 3D space open, %s",
    (_, latest) => {
      const { dialog, book } = parts(latest);
      // The classes that set preserve-3d, read from the CSS so a new one is held too.
      const text = readFileSync(path.join(process.cwd(), CSS_FILE), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        ""
      );
      const open = Array.from(text.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        .filter((rule) => /transform-style\s*:\s*preserve-3d/.test(rule[2]))
        .flatMap((rule) => rule[1].split(","))
        .map((selector) => selector.trim().slice(1))
        .sort();
      expect(open).toEqual(["book", "cover", "glide", "leaf1", "leaf2", "lift", "push"]);
      for (const name of open) {
        const els = Array.from(dialog.querySelectorAll(`.${styles[name]}`));
        expect(els, name).toHaveLength(1);
        // Its own class alone, so no look part's class (a mask, a clip, opacity) sits on it.
        expect(Array.from(els[0].classList), name).toEqual([styles[name]]);
        expect(els[0].hasAttribute("data-look"), name).toBe(false);
      }
      // Inside a face, the inside page or the page block, and never one of those itself.
      const holders = [styles.face, styles.inside, styles.block].map((c) => `.${c}`).join(",");
      const looks = Array.from(book.querySelectorAll<HTMLElement>("[data-look]"));
      expect(looks.length).toBeGreaterThan(0);
      for (const part of looks) {
        const look = part.getAttribute("data-look");
        expect(part.matches(holders), look!).toBe(false);
        expect(part.parentElement!.closest(holders), look!).not.toBeNull();
      }
    }
  );

  it("grains every face, and draws the page block's edges and the ground shadow", () => {
    const { dialog, book } = parts({ title: TITLE, cover: COVER });
    const faces = Array.from(dialog.querySelectorAll(`.${styles.face}`));
    expect(faces).toHaveLength(6);
    for (const face of faces) expect(face.querySelector('[data-look="grain"]')).not.toBeNull();
    expect(book.querySelector(`:scope > .${styles.inside} > [data-look="grain"]`)).not.toBeNull();
    expect(book.querySelector(`:scope > .${styles.block} [data-look="edges"]`)).not.toBeNull();
    const ground = dialog.querySelector(`.${styles.groundBox} [data-look="ground"]`);
    expect(ground).toHaveClass(styles.groundGrow);
    // On the ground, outside the book's 3D space, so the book always covers it.
    expect(book.contains(ground)).toBe(false);
  });
});

describe("the book intro's timing", () => {
  const animations = sceneAnimations(CSS_FILE);
  const css = readFileSync(path.join(process.cwd(), CSS_FILE), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );

  /** Each @keyframes block's steps, as property → value. */
  function keyframes(): Map<string, Record<string, string>[]> {
    const found = new Map<string, Record<string, string>[]>();
    for (const head of Array.from(css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g))) {
      let depth = 1;
      let i = head.index! + head[0].length;
      const start = i;
      while (depth > 0) {
        if (css[i] === "{") depth += 1;
        if (css[i] === "}") depth -= 1;
        i += 1;
      }
      const steps = Array.from(css.slice(start, i - 1).matchAll(/[^{}]+\{([^{}]*)\}/g)).map(
        (step) =>
          Object.fromEntries(
            Array.from(step[1].matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)).map((d) => [d[1], d[2].trim()])
          )
      );
      found.set(head[1], steps);
    }
    return found;
  }

  it("gives the overlay one animation, its exit, ending with the intro", () => {
    const own = animations.filter((a) => a.selector === ".overlay");
    expect(own).toHaveLength(1);
    expect(endsAt(own[0])).toBeCloseTo(INTRO_SECONDS.book, 9);
  });

  it("leaves the overlay invisible when the exit is over", () => {
    const [exit] = animations.filter((a) => a.selector === ".overlay");
    const steps = keyframes().get(exit.name)!;
    expect(steps.at(-1)).toMatchObject({ opacity: "0", visibility: "hidden" });
  });

  it("ends everything by then, and loops nothing", () => {
    expect(animations.length).toBeGreaterThan(1);
    for (const animation of animations) {
      expect(animation.iterations, animation.name).toBe(1);
      expect(endsAt(animation), animation.name).toBeLessThanOrEqual(INTRO_SECONDS.book + 1e-9);
    }
  });

  /** Every animation in the module, one shorthand each, as written. */
  const shorthands = Array.from(css.matchAll(/(?:^|[;{])\s*animation\s*:\s*([^;]+);/g)).flatMap(
    (decl) => decl[1].split(/,(?![^(]*\))/).map((one) => one.trim())
  );

  it("fills every animation both ways, so each holds its first and last frames", () => {
    expect(shorthands).toHaveLength(animations.length);
    for (const one of shorthands) expect(one).toMatch(/\bboth$/);
  });

  it("writes every time as a literal, which is what the timing checks can read", () => {
    // sceneAnimations skips a function token, so var(--d) or calc() as a delay
    // would read as no delay at all. Only a timing curve may take parentheses.
    for (const one of shorthands) {
      expect(one.replace(/(?:cubic-bezier|steps)\([^)]*\)/g, ""), one).not.toMatch(/\(/);
    }
  });

  it("styles plain classes only, so no rule can reach into Amr's own element", () => {
    const rules = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const selectors = Array.from(rules.matchAll(/([^{}]+)\{[^{}]*\}/g)).map((rule) =>
      rule[1].trim()
    );
    expect(selectors.length).toBeGreaterThan(1);
    for (const selector of selectors) expect(selector).toMatch(/^\.[A-Za-z][\w-]*$/);
  });

  it("colours with the theme's tokens only", () => {
    expect(css).not.toMatch(
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i
    );
  });

  it("animates only transform, opacity, clip-path and visibility", () => {
    const allowed = new Set([
      "transform",
      "opacity",
      "clip-path",
      "visibility",
      "animation-timing-function",
    ]);
    const all = keyframes();
    for (const animation of animations) expect(all.has(animation.name), animation.name).toBe(true);
    for (const [name, steps] of Array.from(all)) {
      for (const step of steps) {
        for (const property of Object.keys(step))
          expect(allowed.has(property), `${name}: ${property}`).toBe(true);
      }
    }
  });

  it("lets a short landscape page's wider window outrank the base one", () => {
    // Same specificity, so the later rule wins: the override has to follow.
    const base = css.search(/\n\.window \{[^}]*aspect-ratio: 3 \/ 2;/);
    const landscape = css.search(
      /@media \(orientation: landscape\) and \(max-height: 540px\) \{\s*\.window \{\s*aspect-ratio: 2 \/ 1;/
    );
    expect(base).toBeGreaterThan(-1);
    expect(landscape).toBeGreaterThan(base);
  });

  /**
   * The declarations of the top-level rule for `selector`, in order. The markup
   * tests can't see these: a CSS module reads as any class name in a test.
   */
  function declsOf(selector: string): [string, string][] {
    const rule = new RegExp(`\\n\\${selector} \\{([^}]*)\\}`).exec(css);
    expect(rule, selector).not.toBeNull();
    return Array.from(rule![1].matchAll(/([a-z-]+)\s*:\s*([^;]+);/g), (d) => [
      d[1],
      d[2].replace(/\s+/g, " ").trim(),
    ]);
  }

  it("turns a sheet's back over, and hides each face once it faces away", () => {
    // So a page's back turns over and lands face up as the spread's left page.
    expect(declsOf(".back")).toContainEqual(["transform", "rotateY(180deg)"]);
    const face = declsOf(".face");
    const prefixed = face.findIndex(
      ([p, v]) => p === "-webkit-backface-visibility" && v === "hidden"
    );
    const plain = face.findIndex(([p, v]) => p === "backface-visibility" && v === "hidden");
    expect(prefixed).toBeGreaterThan(-1);
    expect(plain).toBeGreaterThan(prefixed);
  });

  /**
   * A length as the browser works it out, in px: calc(), min(), max(), var(),
   * rem (16px), px, % of `percent` and plain numbers.
   */
  function px(expr: string, vars: Record<string, string>, percent = Number.NaN): number {
    let text = expr;
    for (let pass = 0; /var\(/.test(text); pass++) {
      expect(pass, `var() in ${expr}`).toBeLessThan(10);
      text = text.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
        expect(vars[name], name).toBeDefined();
        return `(${vars[name]})`;
      });
    }
    const found = Array.from(
      text.matchAll(/\s*(?:(\d*\.?\d+)(rem|px|%)?|(calc|min|max)\(|([-+*/(),]))/g)
    );
    // Every character read: anything else (a unit or function it doesn't know) fails here.
    expect(found.map((m) => m[0].trim()).join(""), text).toBe(text.replace(/\s+/g, ""));
    const tokens = found.map((m) => m.slice(1));
    let i = 0;
    const peek = () => tokens[i]?.[3];
    const sum = (): number => {
      let v = product();
      while (peek() === "+" || peek() === "-")
        v = tokens[i++][3] === "+" ? v + product() : v - product();
      return v;
    };
    const product = (): number => {
      let v = factor();
      while (peek() === "*" || peek() === "/")
        v = tokens[i++][3] === "*" ? v * factor() : v / factor();
      return v;
    };
    const factor = (): number => {
      const [n, unit, fn, op] = tokens[i++];
      if (n !== undefined)
        return Number(n) * (unit === "rem" ? 16 : unit === "%" ? percent / 100 : 1);
      if (op === "-") return -factor();
      const args = [sum()];
      while (peek() === ",") {
        i++;
        args.push(sum());
      }
      expect(tokens[i++]?.[3], text).toBe(")");
      if (fn === "min") return Math.min(...args);
      if (fn === "max") return Math.max(...args);
      expect(args, text).toHaveLength(1);
      return args[0];
    };
    const v = sum();
    expect(i, text).toBe(tokens.length);
    return v;
  }

  it("works lengths out the way the browser does", () => {
    const vars = { "--w": "200px", "--two": "var(--w) / 100" };
    expect(px("calc(var(--w) * 0.5 - 1rem)", vars)).toBeCloseTo(84, 9);
    expect(px("max(0.75rem, calc(var(--w) * 0.046))", vars)).toBeCloseTo(12, 9);
    expect(px("min(100%, calc(var(--w) * (1 - 2 * 0.25)))", vars, 80)).toBeCloseTo(80, 9);
    expect(px("calc(var(--two) * -3)", vars)).toBeCloseTo(-6, 9);
  });

  it("sizes the panel's window so the eyebrow and four lines of title always fit under it", () => {
    const value = (selector: string, property: string) => {
      const found = declsOf(selector).find(([p]) => p === property);
      expect(found, `${selector} ${property}`).toBeDefined();
      return found![1];
    };
    // The lettering takes its sizes from the page, and the window its room from them.
    expect(value(".eyebrow", "font-size")).toBe("var(--eyebrow-size)");
    expect(value(".storyTitle", "font-size")).toBe("var(--title-size)");
    expect(value(".inside", "border")).toMatch(/^var\(--panel-w\) solid /);
    const landscape =
      /@media \(orientation: landscape\) and \(max-height: 540px\) \{\s*\.window \{([^}]*)\}/
        .exec(css)![1]
        .match(/width:\s*([^;]+);/)![1];
    const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const panelW = /--panel-w:\s*([^;]+);/.exec(globals)![1].trim();
    const vars = (bookW: number) => ({
      "--book-w": `${bookW}px`,
      "--panel-w": panelW,
      "--eyebrow-size": value(".inside", "--eyebrow-size"),
      "--title-size": value(".inside", "--title-size"),
      "--room": value(".window", "--room"),
    });
    // The book's width on a 375 px phone 667 or 550 tall (270px both), a 320
    // and a 360 px phone, a laptop, and phones on their side (2:1 window).
    for (const [bookW, width, ratio] of [
      [270, value(".window", "width"), 3 / 2],
      [230.4, value(".window", "width"), 3 / 2],
      [259.2, value(".window", "width"), 3 / 2],
      [416, value(".window", "width"), 3 / 2],
      [193.5, landscape, 2],
      [144, landscape, 2],
    ] as const) {
      const v = vars(bookW);
      const at = (selector: string, property: string) => px(value(selector, property), v);
      const inner = bookW - 2 * px(panelW, v) - 2 * at(".inside", "padding");
      const windowH = px(width, v, inner) / ratio;
      expect(windowH, `${bookW}px`).toBeGreaterThan(0);
      // The eyebrow takes one line: "This week's story" is far short of the page's width.
      const caption =
        at(".caption", "margin-top") +
        Number(value(".eyebrow", "line-height")) * px("var(--eyebrow-size)", v) +
        at(".storyTitle", "margin-top") +
        4 * Number(value(".storyTitle", "line-height")) * px("var(--title-size)", v);
      expect(windowH + caption, `${bookW}px`).toBeLessThanOrEqual(inner + 1e-6);
      // And no smaller than that leaves it: the window fills the page's width, or the room.
      expect(Math.min(inner / ratio, inner - caption), `${bookW}px`).toBeCloseTo(windowH, 6);
    }
  });

  it("lifts the cover's grain, light and shade above its art", () => {
    const z = declsOf(".overArt").find(([p]) => p === "z-index");
    expect(Number(z?.[1])).toBeGreaterThan(0);
  });

  it("places the resting light on each page of the open spread", () => {
    for (const selector of [".restingLight", ".shadeOnly"]) {
      const transform = declsOf(selector).find(([p]) => p === "transform");
      expect(transform?.[1], selector).toMatch(/^translateX\(-?[\d.]+%\)$/);
    }
  });

  it("draws nothing of its own: no images or gradients in the CSS", () => {
    expect(css).not.toMatch(/url\(|gradient\(/);
  });

  /** The one animation on `selector` (the caption has two: the straight wipe and its bowed twin). */
  function only(selector: string) {
    const found = animations.filter((a) => a.selector === selector);
    expect(found, selector).toHaveLength(1);
    return found[0];
  }

  /** A keyframes block's steps, each at its offset from 0 to 1. */
  function stepsOf(name: string): { at: number; decls: Record<string, string> }[] {
    const head = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(css);
    expect(head, name).not.toBeNull();
    let depth = 1;
    let i = head!.index + head![0].length;
    const start = i;
    for (; depth > 0; i++) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
    }
    return Array.from(css.slice(start, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)).flatMap((m) => {
      const decls = Object.fromEntries(
        Array.from(m[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)).map((d) => [
          d[1],
          d[2].replace(/\s+/g, " ").trim(),
        ])
      );
      return m[1].split(",").map((offset) => {
        const o = offset.trim();
        return { at: o === "from" ? 0 : o === "to" ? 1 : Number(o.slice(0, -1)) / 100, decls };
      });
    });
  }

  const angle = (transform: string) => Number(/rotateY\((-?[\d.]+)deg\)/.exec(transform)![1]);
  const depthOf = (transform: string) => Number(/translateZ\((-?[\d.]+)px\)/.exec(transform)![1]);

  /** When a sheet's turn passes edge-on: its rotateY(-90deg) step. */
  function edgeOn(selector: string): number {
    const turn = only(selector);
    const step = stepsOf(turn.name).find((s) => /rotateY\(-90deg\)/.test(s.decls.transform ?? ""));
    expect(step, `${turn.name} has a rotateY(-90deg) step`).toBeDefined();
    return turn.delay + step!.at * turn.duration;
  }

  const SHEETS = [".cover", ".leaf1", ".leaf2"] as const;

  it("turns the cover and both pages through an explicit edge-on step", () => {
    for (const sheet of SHEETS) expect(edgeOn(sheet), sheet).toBeGreaterThan(only(sheet).delay);
  });

  it("rests the cover at -160 and the pages at -158 and -156, so the page turned last lies on top", () => {
    const resting = SHEETS.map((sheet) => angle(stepsOf(only(sheet).name).at(-1)!.decls.transform));
    expect(resting).toEqual([-160, -158, -156]);
    for (const a of resting) {
      expect(a).toBeGreaterThanOrEqual(-160);
      expect(a).toBeLessThanOrEqual(-154);
    }
  });

  it("turns each sheet with rotateY and then translateZ, the cover in front while closed", () => {
    const depths = SHEETS.map((sheet) => {
      const steps = stepsOf(only(sheet).name);
      for (const { decls } of steps) {
        const t = decls.transform;
        expect(t.indexOf("rotateY"), t).toBeGreaterThan(-1);
        expect(t.indexOf("translateZ"), t).toBeGreaterThan(t.indexOf("rotateY"));
      }
      const each = new Set(steps.map((s) => depthOf(s.decls.transform)));
      expect(each.size, sheet).toBe(1);
      return Array.from(each)[0];
    });
    expect(depths).toEqual([3, 2, 1]);
  });

  it("lands the pages without passing their resting angle, so no page goes through the one under it", () => {
    for (const sheet of [".leaf1", ".leaf2"]) {
      const steps = stepsOf(only(sheet).name);
      const angles = steps.map((s) => angle(s.decls.transform));
      expect(angles, sheet).toEqual([...angles].sort((a, b) => b - a));
      // No spring: its overshoot is past the resting angle.
      expect(steps.some((s) => /linear\(/.test(s.decls["animation-timing-function"] ?? ""))).toBe(
        false
      );
      // Nor a curve that runs past its end: every cubic-bezier, in the shorthand
      // (which a step without its own curve takes) and in each step, keeps y in 0..1.
      const name = only(sheet).name;
      const shorthand = shorthands.find((one) => one.startsWith(`${name} `))!;
      const curves = [shorthand, ...steps.map((s) => s.decls["animation-timing-function"] ?? "")]
        .flatMap((value) => Array.from(value.matchAll(/cubic-bezier\(([^)]*)\)/g)))
        .map((m) => m[1].split(",").map(Number));
      expect(curves.length, sheet).toBeGreaterThan(0);
      for (const [, y1, , y2] of curves) {
        for (const y of [y1, y2]) {
          expect(y, `${sheet}: cubic-bezier y ${y}`).toBeGreaterThanOrEqual(0);
          expect(y, `${sheet}: cubic-bezier y ${y}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // Each sheet lifts only once the one above it is upright, and lands after it.
    expect(only(".leaf1").delay).toBeGreaterThanOrEqual(edgeOn(".cover") - 1e-9);
    expect(endsAt(only(".leaf1"))).toBeGreaterThan(endsAt(only(".cover")));
    expect(only(".leaf2").delay).toBeGreaterThanOrEqual(endsAt(only(".leaf1")) - 1e-9);
  });

  it("turns the blank first page at once: it lifts as the cover goes edge-on", () => {
    expect(Math.abs(only(".leaf1").delay - edgeOn(".cover"))).toBeLessThan(0.02);
  });

  it("turns the blank second page at once too: it lifts as the first page lands", () => {
    // Neither page holds a picture, so neither lies still to be looked at.
    expect(Math.abs(only(".leaf2").delay - endsAt(only(".leaf1")))).toBeLessThan(0.02);
  });

  /** The title's two wipes: the straight one, and its bowed twin where shape() works. */
  const wipes = () => {
    const found = animations.filter((a) => a.selector === ".titleInk");
    expect(found.map((w) => w.name)).toEqual(["book-ink", "book-ink-bowed"]);
    return found;
  };

  it("inks the title in only once the second page is edge-on, straight or bowed", () => {
    for (const wipe of wipes()) {
      expect(wipe.delay, wipe.name).toBeGreaterThanOrEqual(edgeOn(".leaf2") - 1e-9);
    }
  });

  it("leaves the title fully inked at least 1.9 s before the push, which stays at 4.25 s", () => {
    const push = only(".push").delay;
    expect(push).toBeCloseTo(4.25, 9);
    for (const wipe of wipes()) {
      expect(push - endsAt(wipe), wipe.name).toBeGreaterThanOrEqual(1.9 - 1e-9);
    }
  });

  it("keeps the bowed ink at the straight wipe's pace: its two steps are that curve cut at its middle", () => {
    const bezier = (one: string) =>
      /cubic-bezier\(([^)]*)\)/.exec(one)![1].split(",").map(Number) as [
        number,
        number,
        number,
        number,
      ];
    const [x1, y1, x2, y2] = bezier(shorthands.find((one) => one.startsWith("book-ink "))!);
    // de Casteljau at t = 0.5: the middle point, and each half's control points.
    const mid = (a: number, b: number) => (a + 3 * b) / 8;
    const [mx, my] = [mid(0, x1) + mid(0, x2) + 1 / 8, mid(0, y1) + mid(0, y2) + 1 / 8];
    const left = [x1 / 2 / mx, y1 / 2 / my, (2 * x1 + x2) / 4 / mx, (2 * y1 + y2) / 4 / my];
    const right = [
      ((x1 + 2 * x2 + 1) / 4 - mx) / (1 - mx),
      ((y1 + 2 * y2 + 1) / 4 - my) / (1 - my),
      ((x2 + 1) / 2 - mx) / (1 - mx),
      ((y2 + 1) / 2 - my) / (1 - my),
    ];
    const steps = stepsOf("book-ink-bowed");
    expect(steps.map((s) => s.at)).toEqual([0, expect.closeTo(mx, 3), 1]);
    const curve = (s: (typeof steps)[number]) => bezier(s.decls["animation-timing-function"]);
    curve(steps[0]).forEach((v, i) => expect(v).toBeCloseTo(left[i], 3));
    curve(steps[1]).forEach((v, i) => expect(v).toBeCloseTo(right[i], 3));
    // The edge has come that far of its way from 0 to 100% + 0.5rem.
    const edge = /line to calc\(([\d.]+)% \+ ([\d.]+)rem\) -0\.5rem/.exec(
      steps[1].decls["clip-path"]
    )!;
    expect(Number(edge[1]) / 100).toBeCloseTo(my, 3);
    expect(Number(edge[2]) / 0.5).toBeCloseTo(my, 2);
  });

  it("pops Amr up only after the second page has landed, so no page sweeps across him", () => {
    expect(only(".amrPop").delay).toBeGreaterThanOrEqual(endsAt(only(".leaf2")) - 1e-9);
  });

  it("sweeps the light across the closed cover, ending before it opens", () => {
    const sweep = only(".coverLight");
    expect(endsAt(sweep)).toBeLessThanOrEqual(only(".cover").delay + 1e-9);
    expect(sweep.delay).toBeGreaterThan(0);
  });

  it("darkens each turning front in three flat steps, to 24%, until it is edge-on", () => {
    for (const [shade, sheet] of [
      [".coverShade", ".cover"],
      [".leaf1Shade", ".leaf1"],
      [".leaf2Shade", ".leaf2"],
    ]) {
      const a = only(shade);
      expect(a.delay, shade).toBeCloseTo(only(sheet).delay, 9);
      expect(endsAt(a), shade).toBeCloseTo(edgeOn(sheet), 9);
      const shorthand = new RegExp(`\\n\\${shade} \\{\\s*animation: ([^;]+);`).exec(css)?.[1];
      expect(shorthand, shade).toMatch(/\bsteps\(3\b/);
      const steps = stepsOf(a.name);
      expect(steps[0].decls.opacity).toBe("0");
      expect(steps.at(-1)!.decls.opacity).toBe("0.24");
    }
  });

  it("lands the book on a spring and grows its ground shadow with it, by scaleX only", () => {
    const [rise, grow] = [only(".lift"), only(".groundGrow")];
    expect([grow.delay, grow.duration]).toEqual([rise.delay, rise.duration]);
    const steps = stepsOf(grow.name);
    expect(steps[0].decls.transform).toMatch(/^scaleX\([\d.]+\)$/);
    expect(steps.at(-1)!.decls.transform).toBe("none");
  });

  it("glides the ground with the book", () => {
    const [book, ground] = [only(".glide"), only(".groundBox")];
    expect([ground.name, ground.duration, ground.delay]).toEqual([
      book.name,
      book.duration,
      book.delay,
    ]);
  });
});

describe("on the gallery page", () => {
  it("plays outside ToolPageWrapper, opening onto the story the gallery leads with", async () => {
    h.summaries = [
      summary(30, "Newest story"),
      summary(29, "Older story", { ...COVER, pathSmall: "stories/29/one-768.webp" }),
    ];
    render(await ComicsPage());
    const dialog = overlay();
    expect(screen.getByTestId("tool-page-wrapper").contains(dialog)).toBe(false);
    expect(within(dialog).getByText("Newest story")).toBeTruthy();
    expect(within(dialog).queryByText("Older story")).toBeNull();
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      panelImageUrl("stories/30/one-768.webp")
    );
  });

  it("reads the list once, for the intro and the gallery both", async () => {
    h.summaries = [summary(30, "Newest story")];
    render(await ComicsPage());
    expect(h.listCalls).toBe(1);
  });

  it("opens onto Amr alone before anything is released", async () => {
    render(await ComicsPage());
    const dialog = overlay();
    expect(srcs(dialog)).toEqual([COVER_INTRO_URL]);
    expect(screen.getByTestId("tool-page-wrapper").contains(dialog)).toBe(false);
    expect(within(dialog).queryByText("This week's story")).toBeNull();
    expect(dialog.querySelector("[data-amr-pose]")).not.toBeNull();
  });

  it("offers Replay intro, which plays the book's intro again", async () => {
    render(await ComicsPage());
    fireEvent.click(await screen.findByRole("button", { name: "Replay intro" }));
    expect(document.documentElement.getAttribute(INTRO_ATTR)).toBe("book");
    expect(document.activeElement).toBe(
      within(overlay()).getByRole("button", { name: "Skip intro" })
    );
  });
});
