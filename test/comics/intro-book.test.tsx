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

  it("letters the cover, and opens onto this week's story and its first panel", () => {
    render(<BookIntro latest={{ title: TITLE, cover: COVER }} />);
    const dialog = overlay();
    expect(within(dialog).getByText("This week's story")).toBeTruthy();
    expect(within(dialog).getByText(TITLE)).toBeTruthy();
    expect(dialog.textContent).toContain("Agile at Work");
    expect(dialog.textContent).toContain("Workplace comics by Amr Elharony");
    expect(leftoverText(dialog, [TITLE]).trim()).toBe("");
  });

  it("shows only the story's panel and Amr's sheet", () => {
    render(<BookIntro latest={{ title: TITLE, cover: COVER }} />);
    const dialog = overlay();
    const images = Array.from(dialog.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(images).toEqual([panelImageUrl(COVER.pathSmall)]);
    expect(dialog.querySelector("svg")).toBeNull();
    expect(backgrounds(dialog)).toEqual([MASCOT_SPRITE_URL]);
    expect(dialog.querySelector("[data-amr-pose]")).toHaveAttribute("data-amr-pose", "waving");
  });

  it("letters the title alone while the story has no art", () => {
    render(<BookIntro latest={{ title: TITLE, cover: null }} />);
    const dialog = overlay();
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("svg")).toBeNull();
    expect(within(dialog).getByText("This week's story")).toBeTruthy();
    expect(within(dialog).getByText(TITLE)).toBeTruthy();
    expect(backgrounds(dialog)).toEqual([MASCOT_SPRITE_URL]);
    expect(leftoverText(dialog, [TITLE]).trim()).toBe("");
  });

  it("opens onto nothing but Amr before any story is out", () => {
    render(<BookIntro latest={null} />);
    const dialog = overlay();
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("svg")).toBeNull();
    expect(within(dialog).queryByText("This week's story")).toBeNull();
    expect(backgrounds(dialog)).toEqual([MASCOT_SPRITE_URL]);
    expect(dialog.querySelector("[data-amr-pose]")).toHaveAttribute("data-amr-pose", "waving");
    expect(leftoverText(dialog).trim()).toBe("");
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

  it("draws nothing of its own: no images or gradients in the CSS", () => {
    expect(css).not.toMatch(/url\(|gradient\(/);
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
