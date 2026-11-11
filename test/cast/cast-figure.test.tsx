/**
 * CastFigure draws a rig given as a prop: server-safe (no hooks, no "use
 * client", nothing random or clock-based), nested parts with their pivots,
 * every swap choice in the markup with only data-on showing, the atlas on the
 * root, and the switches a host or scene needs (classes, ground, defer, tap).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CAST_MAX_CSS_PX, CastFigure } from "@/components/cast/cast-figure";
import styles from "@/components/cast/cast-figure.module.css";
import { ARMLESS_PUPPET, TEST_PUPPET } from "./fixtures/rig-fixture";

const SOURCE = readFileSync(
  path.join(process.cwd(), "src/components/cast/cast-figure.tsx"),
  "utf8"
);

function figure(props: Partial<Parameters<typeof CastFigure>[0]> = {}): HTMLElement {
  const { container } = render(<CastFigure rig={TEST_PUPPET} height="160px" {...props} />);
  return container.querySelector("[data-cast]") as HTMLElement;
}

describe("CastFigure on the server", () => {
  it("has no hooks, no client directive and nothing random or clock-based", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/["']use client["']/);
    expect(code).not.toMatch(/\buse[A-Z]\w*\s*\(/);
    expect(code).not.toMatch(/Math\.random|Date\.now|new Date/);
    // The rig is a prop: only types come from the rig modules.
    expect(code).not.toMatch(/from\s+["']@\/lib\/cast\/rigs(\.generated)?["']/);
    expect(code).not.toMatch(/^import\s+(?!type\b)[^;]*["']@\/lib\/cast\//m);
  });

  it("renders to the same markup every time, from props alone", () => {
    const a = renderToStaticMarkup(<CastFigure rig={TEST_PUPPET} height="160px" ground />);
    const b = renderToStaticMarkup(<CastFigure rig={TEST_PUPPET} height="160px" ground />);
    expect(a).toBe(b);
    expect(a).toContain('data-cast="AAW-90"');
  });

  it("is decorative: hidden from assistive tech, with nothing to focus", () => {
    const el = figure({ tap: true });
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.querySelector("a, button, input, [tabindex]")).toBeNull();
    expect(el.getAttribute("role")).toBeNull();
  });

  it("names the character, its signature moves and its pupils' travel", () => {
    const el = figure();
    expect(el).toHaveClass(styles.figure);
    expect(el.dataset.cast).toBe("AAW-90");
    expect(el.dataset.sig).toBe("sig.tail sig.wave");
    expect(el.dataset.travel).toBe("30 20");
  });

  it("carries the atlas on the root and nothing else as a custom property", () => {
    const el = figure();
    expect(el.style.getPropertyValue("--cast-x1")).toBe(`url(${TEST_PUPPET.atlas.x1})`);
    expect(el.style.getPropertyValue("--cast-x2")).toBe(`url(${TEST_PUPPET.atlas.x2})`);
    for (const node of Array.from(el.querySelectorAll("[style]"))) {
      expect(node.getAttribute("style"), node.outerHTML).not.toMatch(/--|url\(/);
    }
  });

  it("keeps its height at or under the cap, at the rig's own proportions", () => {
    expect(CAST_MAX_CSS_PX).toBe(240);
    // jsdom's style parser drops min(), so read the server's markup.
    const html = renderToStaticMarkup(<CastFigure rig={TEST_PUPPET} height="30vh" />);
    const root = /^<span [^>]*style="([^"]*)"/.exec(html)![1];
    expect(root).toContain("height:min(30vh, 240px)");
    expect(root).toContain("aspect-ratio:0.5");
  });
});

describe("the skeleton", () => {
  it("nests every part inside its parent, with its box, pivot and order", () => {
    const el = figure();
    for (const part of TEST_PUPPET.parts) {
      if (part.id.startsWith("pupil-")) continue;
      const node = el.querySelector<HTMLElement>(`[data-part="${part.id}"]`)!;
      expect(node, part.id).not.toBeNull();
      const parent = node.parentElement!;
      if (part.parent === null) expect(parent).toBe(el);
      else expect(parent.dataset.part).toBe(part.parent);
      expect(node.style.left).toBe(`${part.box[0]}%`);
      expect(node.style.top).toBe(`${part.box[1]}%`);
      expect(node.style.width).toBe(`${part.box[2]}%`);
      expect(node.style.height).toBe(`${part.box[3]}%`);
      expect(node.style.transformOrigin).toBe(`${part.pivot[0]}% ${part.pivot[1]}%`);
      expect(node.style.zIndex).toBe(String(part.z));
      expect(node.dataset.socket).toBe(part.socket);
    }
  });

  it("paints each part's own art from the atlas, in its own box", () => {
    const art = figure().querySelector<HTMLElement>('[data-part="tail"] > [data-sprite]')!;
    expect(art.style.backgroundSize).toBe("600% 800%");
    expect(art.style.backgroundPosition).toBe("60% 40%");
  });

  it("marks a drawn extra and the ground shadow with data-look", () => {
    const el = figure({ ground: true });
    expect(el.querySelector('[data-part="glint"]')).toHaveAttribute("data-look");
    const ground = el.querySelector<HTMLElement>("[data-ground]")!;
    expect(ground).toHaveAttribute("data-look");
    expect(ground.style.top).toBe("97%");
    expect(figure().querySelector("[data-ground]")).toBeNull();
  });

  it("renders exactly the nodes its manifest counts, within the budget", () => {
    for (const rig of [TEST_PUPPET, ARMLESS_PUPPET]) {
      const { container } = render(<CastFigure rig={rig} height="120px" ground />);
      const nodes = container.querySelectorAll("[data-cast], [data-cast] *").length;
      expect(nodes, rig.id).toBe(rig.counts.nodes);
      expect(nodes).toBeLessThanOrEqual(48);
    }
  });

  it("puts the arm slots on the shoulder and lets a hand at the chin draw over the head", () => {
    const el = figure();
    const arms = el.querySelectorAll<HTMLElement>('[data-slot="arm-l"]');
    expect(arms).toHaveLength(2);
    for (const arm of Array.from(arms)) {
      expect(arm.dataset.socket).toBe("arm-l");
      expect(arm.style.transformOrigin).toBe("20% 5%");
      expect(arm.parentElement!.dataset.part).toBe("torso");
    }
    const chin = el.querySelector('[data-choice="chin"]')!.parentElement as HTMLElement;
    const head = el.querySelector<HTMLElement>('[data-part="head"]')!;
    expect(Number(chin.style.zIndex)).toBeGreaterThan(Number(head.style.zIndex));
    // The eyes and mouth are faces, not joints.
    expect(el.querySelector('[data-slot="eyes"]')!.hasAttribute("data-socket")).toBe(false);
  });
});

describe("swaps", () => {
  it("puts every choice in the markup, with only the rest choice on", () => {
    const el = figure();
    for (const slot of TEST_PUPPET.swaps) {
      const choices = Array.from(el.querySelectorAll<HTMLElement>(`[data-swap="${slot.id}"]`));
      expect(choices.map((c) => c.dataset.choice).sort()).toEqual(
        slot.choices.map((c) => c.id).sort()
      );
      const on = choices.filter((c) => c.hasAttribute("data-on"));
      expect(on.map((c) => c.dataset.choice)).toEqual([slot.rest]);
      expect(on[0]).toHaveAttribute("data-rest");
      for (const c of choices) {
        const drawn = slot.choices.find((x) => x.id === c.dataset.choice)!.sprite !== null;
        expect(c.hasAttribute("data-sprite"), `${slot.id}.${c.dataset.choice}`).toBe(drawn);
      }
    }
  });

  it("toggles nothing but data-on: no class, style or custom property differs between choices", () => {
    const el = figure();
    const choice = el.querySelector('[data-swap="eyes"][data-choice="closed"]')!;
    expect(choice.getAttribute("class")).toBeNull();
    expect(choice.getAttribute("style")).not.toMatch(/visibility|display|opacity|--/);
  });

  it("puts the pupils inside the eye choices that show empty whites, nowhere else", () => {
    const el = figure();
    const pupils = Array.from(el.querySelectorAll<HTMLElement>("[data-pupil]"));
    expect(pupils).toHaveLength(4);
    expect(pupils.map((p) => p.parentElement!.dataset.choice)).toEqual([
      "open",
      "open",
      "wide",
      "wide",
    ]);
    expect(pupils.map((p) => p.dataset.pupil)).toEqual(["r", "l", "r", "l"]);
    expect(el.querySelector('[data-part="pupil-r"]')).toBeNull();
    // Re-measured inside the open choice, which covers the eyes slot: the
    // pupil sits at head x 30% → (30 - 25) / 50 of the slot.
    const right = pupils[0];
    expect(right.style.left).toBe("10%");
    expect(right.style.top).toBe(`${Math.round(((40 - 32) / 24) * 10000) / 100}%`);
    expect(right.style.width).toBe("16%");
  });
});

describe("what a host or scene sets", () => {
  it("hangs intro scene classes on sockets, slots, choices, pupils and the ground", () => {
    const el = figure({
      ground: true,
      classes: {
        head: "c-head",
        "arm-r": "c-arm",
        "arm-r.wave": "c-wave",
        pupils: "c-pupils",
        ground: "c-ground",
      },
    });
    expect(el.querySelector('[data-part="head"]')).toHaveClass("c-head");
    expect(el.querySelector('[data-slot="arm-r"]')).toHaveClass("c-arm");
    expect(el.querySelector('[data-choice="wave"]')).toHaveClass("c-wave");
    expect(el.querySelectorAll(".c-pupils")).toHaveLength(4);
    expect(el.querySelector("[data-ground]")).toHaveClass("c-ground");
  });

  it("defers the art and answers taps only when asked", () => {
    expect(figure().hasAttribute("data-defer")).toBe(false);
    expect(figure({ defer: true })).toHaveAttribute("data-defer");
    expect(figure().hasAttribute("data-tap")).toBe(false);
    expect(figure({ tap: true })).toHaveAttribute("data-tap");
  });

  it("shows a translucent character at its opacity", () => {
    const { container } = render(
      <CastFigure rig={{ ...ARMLESS_PUPPET, translucent: 0.9 }} height="100px" />
    );
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe("0.9");
  });

  it("draws nothing for a rig without a root", () => {
    const html = renderToStaticMarkup(
      <CastFigure rig={{ ...TEST_PUPPET, parts: TEST_PUPPET.parts.slice(1) }} height="100px" />
    );
    expect(html).toBe("");
  });
});
