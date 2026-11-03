/**
 * The VIP intro: what it shows with and without early comics, the timeline its
 * CSS module keeps, and that only a device the book's link unlocked is sent it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { BookOpen, IdCard, Smile, Users } from "lucide-react";
import type { StoryCover, StorySummary } from "@/lib/comics/types";
import { endsAt, sceneAnimations } from "../comics/intro-css";

const h = vi.hoisted(() => ({
  unlocked: false,
  early: [] as StorySummary[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/vip/access", () => ({ hasVipAccess: async () => h.unlocked }));
vi.mock("@/lib/comics/store", () => ({ listEarlyWeekly: async () => h.early }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <div data-testid="tool-page-wrapper">
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </div>
  ),
}));

import VipPage from "@/app/vip/page";
import { VipClient } from "@/app/vip/vip-client";
import { VipIntro, type VipIntroTool } from "@/app/(tools)/comics/components/intro/vip-intro";
import styles from "@/app/(tools)/comics/components/intro/vip-intro.module.css";
import { POSES } from "@/components/agent/mascot/engine/sprite-poses";
import { MASCOT_SPRITE_URL } from "@/components/agent/mascot/mascot-asset";
import { panelImageUrl } from "@/lib/comics/images";
import {
  INTRO_ATTR,
  INTRO_RUN_ATTR,
  INTRO_SECONDS,
  OVERLAY_ATTR,
  SKIP_ATTR,
} from "@/lib/comics/intro";
import { getVipTools } from "@/lib/tools/catalog";

const CSS = "src/app/(tools)/comics/components/intro/vip-intro.module.css";

const WELCOME = "Welcome, reader of the book";
const QUESTION = "Would one of these help your team this week?";
const EARLY_HEADING = "The next four weeks of comics";

/** One more than the intro shows, so the cut-off is tested too. */
const TOOLS: VipIntroTool[] = [
  { id: "squad-session", name: "Squad Session Kit", icon: Users },
  { id: "meet-the-cast", name: "Meet the Cast", icon: IdCard },
  { id: "which-colleague", name: "Which Colleague Are You?", icon: Smile },
  { id: "fourth", name: "A Fourth Tool", icon: BookOpen },
];

const cover = (ep: number): StoryCover => ({
  pathSmall: `stories/${ep}/one-768.webp`,
  width: 1536,
  height: 1024,
});

const early = (ep: number, withCover = true): StorySummary => ({
  ep,
  title: `Early story ${ep}`,
  lesson: `Lesson of ${ep}`,
  castNames: ["Amr"],
  themes: [],
  cover: withCover ? cover(ep) : null,
  releaseAt: "2026-11-09T07:00:00.000Z",
  updatedAt: "2026-11-01T07:00:00.000Z",
});

/** Five early comics, the second without art: the intro fans the first three with some. */
const EARLY = [early(30), early(31, false), early(32), early(33), early(34)];
const FANNED = [30, 32, 33];

function overlay(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${OVERLAY_ATTR}="vip"]`);
}

/** The overlay's text with every allowed string taken out. */
function leftover(el: HTMLElement, allowed: readonly string[]): string {
  let text = el.textContent ?? "";
  for (const s of [...allowed].sort((a, b) => b.length - a.length)) text = text.split(s).join(" ");
  return text;
}

function backgrounds(el: HTMLElement): string[] {
  return [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))]
    .map((node) => node.style?.backgroundImage ?? "")
    .filter(Boolean);
}

/** Each cover's tilt in the fan, in order. */
function tilts(): string[] {
  return Array.from(overlay()!.querySelectorAll<HTMLElement>(".intro-window"), (w) =>
    w.style.getPropertyValue("--fan-tilt")
  );
}

/** Whether the tools step back for covers: only `.withComics .tools` recedes. */
function stepsBack(): boolean {
  return overlay()!.querySelector(`.${styles.withComics}`) !== null;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  h.unlocked = false;
  h.early = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  document.cookie = "agile-toolkit:vip-hint=; path=/; max-age=0";
  document.documentElement.removeAttribute(INTRO_ATTR);
  document.documentElement.removeAttribute(INTRO_RUN_ATTR);
});

describe("VipIntro", () => {
  it("is the VIP overlay, named, with Skip", () => {
    render(<VipIntro tools={TOOLS} earlyComics={[]} />);
    const dialog = screen.getByRole("dialog", { name: "VIP intro" });
    expect(dialog).toHaveAttribute(OVERLAY_ATTR, "vip");
    expect(dialog.querySelector(`[${SKIP_ATTR}]`)).toHaveTextContent("Skip intro");
    // The dialog carries the exit, whose end is what ends the intro.
    expect(dialog).toHaveClass(styles.overlay);
  });

  it("deals in the first three tools, each with its icon and name", () => {
    render(<VipIntro tools={TOOLS} earlyComics={[]} />);
    const el = overlay()!;
    const items = Array.from(el.querySelectorAll("li"));
    expect(items.map((li) => li.textContent)).toEqual(TOOLS.slice(0, 3).map((t) => t.name));
    for (const li of items) {
      expect(li).toHaveClass("panel");
      expect(li.querySelectorAll("svg")).toHaveLength(1);
    }
    expect(el).not.toHaveTextContent("A Fourth Tool");
  });

  it("has Amr jump in, then ask his question in a balloon", () => {
    render(<VipIntro tools={TOOLS} earlyComics={[]} />);
    const el = overlay()!;
    const poses = Array.from(el.querySelectorAll("[data-amr-pose]"), (n) =>
      n.getAttribute("data-amr-pose")
    );
    expect(poses).toEqual(["jumping", "waiting"]);
    const balloon = el.querySelector(".balloon");
    expect(balloon?.textContent).toBe(QUESTION);
    expect(balloon?.textContent?.endsWith("?")).toBe(true);
  });

  it("letters the welcome one word at a time, reading as one line", () => {
    render(<VipIntro tools={TOOLS} earlyComics={[]} />);
    const line = screen.getByText(
      (_, node) => node?.tagName === "P" && node.textContent === WELCOME
    );
    expect(Array.from(line.querySelectorAll("span"), (s) => s.textContent)).toEqual(
      WELCOME.split(" ")
    );
  });

  it("puts its lettering in paragraphs, never headings: the page has its own h1", () => {
    render(<VipIntro tools={TOOLS} earlyComics={EARLY} />);
    expect(overlay()!.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
  });

  it("moves Amr only through wrappers, since his own animation is his frames", () => {
    render(<VipIntro tools={TOOLS} earlyComics={EARLY} />);
    const amrs = Array.from(overlay()!.querySelectorAll("[data-amr-pose]"));
    expect(amrs.length).toBeGreaterThan(0);
    for (const amr of amrs) expect(amr.getAttribute("class")).toBe("intro-amr");
  });

  describe("without art", () => {
    it("shows no pictures but Amr, and no early comics", () => {
      render(<VipIntro tools={TOOLS} earlyComics={[]} />);
      const el = overlay()!;
      expect(el.querySelectorAll("img")).toHaveLength(0);
      for (const bg of backgrounds(el)) expect(bg).toContain(MASCOT_SPRITE_URL);
      expect(backgrounds(el).length).toBeGreaterThan(0);
      // The only SVGs are the tools' own icons.
      expect(el.querySelectorAll("svg")).toHaveLength(3);
      expect(el.querySelectorAll("li svg")).toHaveLength(3);
      expect(el).not.toHaveTextContent(EARLY_HEADING);
    });

    it("leaves early comics without a cover out entirely", () => {
      render(<VipIntro tools={TOOLS} earlyComics={[early(31, false)]} />);
      const el = overlay()!;
      expect(el.querySelectorAll("img")).toHaveLength(0);
      expect(el).not.toHaveTextContent(EARLY_HEADING);
    });

    // Otherwise the tools would fade at 5.8 s and leave the slot empty until the page turns.
    it.each([
      ["no early comics", []],
      ["early comics without covers", [early(31, false)]],
    ])("keeps the tools on the page with %s", (_, comics) => {
      render(<VipIntro tools={TOOLS} earlyComics={comics} />);
      expect(stepsBack()).toBe(false);
    });

    it("says nothing but the allowed words", () => {
      render(<VipIntro tools={TOOLS} earlyComics={[]} />);
      const allowed = ["Skip intro", WELCOME, QUESTION, ...TOOLS.slice(0, 3).map((t) => t.name)];
      expect(leftover(overlay()!, allowed).trim()).toBe("");
    });
  });

  describe("with art", () => {
    it("fans the first three covers, and no other pictures but Amr", () => {
      render(<VipIntro tools={TOOLS} earlyComics={EARLY} />);
      const el = overlay()!;
      const sources = Array.from(el.querySelectorAll("img"), (img) => img.getAttribute("src"));
      expect(sources).toEqual(FANNED.map((ep) => panelImageUrl(`stories/${ep}/one-768.webp`)));
      for (const bg of backgrounds(el)) expect(bg).toContain(MASCOT_SPRITE_URL);
      expect(el.querySelectorAll("svg")).toHaveLength(el.querySelectorAll("li svg").length);
      expect(el).toHaveTextContent(EARLY_HEADING);
    });

    it("steps the tools back so the covers can take their place", () => {
      render(<VipIntro tools={TOOLS} earlyComics={EARLY} />);
      expect(stepsBack()).toBe(true);
    });

    it("gives each cover its own place in the fan", () => {
      render(<VipIntro tools={TOOLS} earlyComics={EARLY} />);
      expect(tilts()).toEqual(["-6deg", "0deg", "6deg"]);
    });

    it("fans two covers to either side", () => {
      render(<VipIntro tools={TOOLS} earlyComics={[early(30), early(32)]} />);
      const sources = Array.from(overlay()!.querySelectorAll("img"), (img) =>
        img.getAttribute("src")
      );
      expect(sources).toEqual([30, 32].map((ep) => panelImageUrl(`stories/${ep}/one-768.webp`)));
      expect(tilts()).toEqual(["-4deg", "4deg"]);
      expect(stepsBack()).toBe(true);
    });

    it("stands a single cover upright", () => {
      render(<VipIntro tools={TOOLS} earlyComics={[early(31, false), early(32)]} />);
      expect(overlay()!.querySelectorAll("img")).toHaveLength(1);
      expect(tilts()).toEqual(["0deg"]);
      expect(stepsBack()).toBe(true);
    });

    it("says nothing but the allowed words", () => {
      render(<VipIntro tools={TOOLS} earlyComics={EARLY} />);
      const allowed = [
        "Skip intro",
        WELCOME,
        QUESTION,
        EARLY_HEADING,
        ...TOOLS.slice(0, 3).map((t) => t.name),
      ];
      expect(leftover(overlay()!, allowed).trim()).toBe("");
    });
  });
});

describe("the timeline in vip-intro.module.css", () => {
  const source = readFileSync(path.join(process.cwd(), CSS), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  const animations = sceneAnimations(CSS);

  /** Each @keyframes block's body, by name. */
  const keyframes = new Map<string, string>();
  for (const match of Array.from(source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g))) {
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      i += 1;
    }
    keyframes.set(match[1], source.slice(start, i - 1));
  }

  it("gives the overlay exactly one animation, the exit, ending with the intro", () => {
    const exits = animations.filter((a) => a.selector === ".overlay");
    expect(exits).toHaveLength(1);
    expect(endsAt(exits[0])).toBeCloseTo(INTRO_SECONDS.vip, 9);
  });

  it("leaves the overlay invisible when the exit ends", () => {
    const exit = animations.find((a) => a.selector === ".overlay")!;
    const last = /(?:100%|to)\s*\{([^}]*)\}\s*$/.exec(keyframes.get(exit.name) ?? "")?.[1] ?? "";
    expect(last).toMatch(/opacity:\s*0\s*;/);
    expect(last).toMatch(/visibility:\s*hidden\s*;/);
  });

  it("ends everything by then, and loops nothing", () => {
    expect(animations.length).toBeGreaterThan(10);
    for (const animation of animations) {
      expect(animation.iterations, animation.selector).toBe(1);
      expect(endsAt(animation), animation.selector).toBeLessThanOrEqual(INTRO_SECONDS.vip + 1e-9);
    }
  });

  it("holds each element's first and last frame (fill both)", () => {
    for (const decl of Array.from(source.matchAll(/(?:^|[;{])\s*animation\s*:\s*([^;]+)/g))) {
      let depth = 0;
      const parts = [""];
      for (const char of decl[1]) {
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        if (char === "," && depth === 0) parts.push("");
        else parts[parts.length - 1] += char;
      }
      for (const part of parts) expect(part.trim().split(/\s+/), part).toContain("both");
    }
  });

  it("steps the tools back only for covers, and brings the comics in once they've gone", () => {
    const recede = animations.filter((a) => a.name === "vipRecede");
    expect(recede.map((a) => a.selector)).toEqual([".withComics .tools"]);
    for (const selector of [".comicsHeading", ".cover"]) {
      const comes = animations.find((a) => a.selector === selector)!;
      expect(comes.delay, selector).toBeGreaterThanOrEqual(endsAt(recede[0]) - 1e-9);
    }
  });

  it("cuts Amr to asking while he stands, in the last frame of a jump", () => {
    const { frames, fps } = POSES.jumping;
    const loop = frames / fps;
    for (const selector of [".amrJump", ".amrAsk"]) {
      const cut = animations.find((a) => a.selector === selector)!;
      const loopStart = Math.floor(cut.delay / loop + 1e-9) * loop;
      expect(cut.delay - loopStart, selector).toBeGreaterThanOrEqual(loop - 1 / fps - 1e-9);
      expect(endsAt(cut), selector).toBeLessThanOrEqual(loopStart + loop + 1e-9);
    }
  });

  it("runs only keyframes the module defines", () => {
    for (const animation of animations)
      expect(keyframes.has(animation.name), animation.name).toBe(true);
  });

  it("animates only transform, opacity, clip-path and visibility", () => {
    const allowed = new Set([
      "transform",
      "opacity",
      "clip-path",
      "visibility",
      // A step's easing, not something animated.
      "animation-timing-function",
    ]);
    expect(keyframes.size).toBeGreaterThan(0);
    keyframes.forEach((body, name) => {
      for (const prop of Array.from(body.matchAll(/(?:^|[{;])\s*([a-z-]+)\s*:/g)))
        expect(allowed.has(prop[1]), `${name}: ${prop[1]}`).toBe(true);
    });
  });
});

describe("on /vip", () => {
  it("renders the intro beside the page's wrapper, not inside it", () => {
    render(<VipClient access="unlocked" earlyComics={[early(30)]} />);
    const el = overlay()!;
    expect(el).not.toBeNull();
    expect(screen.getByTestId("tool-page-wrapper")).not.toContainElement(el);
    for (const tool of getVipTools().slice(0, 3)) expect(el).toHaveTextContent(tool.name);
    // The page's early comics reach the intro: the hub's own cards can't pass this.
    expect(Array.from(el.querySelectorAll("img"), (img) => img.getAttribute("src"))).toEqual([
      panelImageUrl("stories/30/one-768.webp"),
    ]);
    expect(el).toHaveTextContent(EARLY_HEADING);
  });

  it("offers to play it again, and it plays the VIP intro", () => {
    render(<VipClient access="unlocked" />);
    fireEvent.click(screen.getByRole("button", { name: "Replay intro" }));
    expect(document.documentElement.getAttribute(INTRO_ATTR)).toBe("vip");
    expect(document.activeElement).toBe(overlay()!.querySelector(`[${SKIP_ATTR}]`));
  });

  it.each(["locked", "invalid-link"] as const)("%s: no intro and no replay", (access) => {
    const { container } = render(<VipClient access={access} />);
    expect(overlay()).toBeNull();
    expect(container.innerHTML).not.toContain(OVERLAY_ATTR);
    expect(screen.queryByRole("button", { name: "Replay intro" })).toBeNull();
  });

  it("the server sends the overlay only to a device the book's link unlocked", async () => {
    h.early = [early(30)];
    const html = async (searchParams: { link?: string }) =>
      renderToString(await VipPage({ searchParams }));

    expect(await html({})).not.toContain(OVERLAY_ATTR);
    expect(await html({ link: "invalid" })).not.toContain(OVERLAY_ATTR);

    h.unlocked = true;
    expect(await html({})).toContain(`${OVERLAY_ATTR}="vip"`);
  });
});
