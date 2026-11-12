/**
 * Mascot slash-command parser. A claimed command never reaches the agent, so
 * anything it doesn't recognise (including the retired hats) must pass through.
 * The Konami sweep paints his aura in theme tokens, never pure neon hexes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  RAINBOW,
  handleMascotCommand,
  installKonami,
  storyFor,
} from "@/components/agent/mascot/engine/customization/commands";
import { COMPANION_SCENES } from "@/components/agent/mascot/engine/scenes";
import { useMascotStore } from "@/lib/agent/mascot/store";

const queue = () => useMascotStore.getState().reactionQueue;

describe("/play an expansion scene", () => {
  beforeEach(() => useMascotStore.getState().reset());

  it("plays any shipped expansion scene by its pack's name, in any case", () => {
    expect(handleMascotCommand("/play x001")).toBe(true);
    expect(queue()).toEqual(["scene:x001"]);
    expect(handleMascotCommand("/play X001")).toBe(true);
    expect(queue()).toEqual(["scene:x001"]);
    expect(handleMascotCommand("  /PLAY X124 ")).toBe(true);
    expect(queue()).toEqual(["scene:x124"]);
    expect(storyFor("X057", null)).toBe("x057");
  });

  it("plays X112 as its filter moment, as the Scenes tab does", () => {
    expect(handleMascotCommand("/play x112")).toBe(true);
    expect(queue()).toEqual(["scene:x112.filter"]);
  });

  it("keeps today's turn for a name it doesn't know, and for /play alone", () => {
    const first = COMPANION_SCENES.play[0];
    expect(storyFor("x999", null)).toBe(first);
    expect(storyFor("x112.filter", null)).toBe(first);
    expect(storyFor("x12", null)).toBe(first);
    expect(handleMascotCommand("/play x999")).toBe(true);
    expect(queue()).toHaveLength(1);
    const story = queue()[0].slice("scene:".length);
    expect(COMPANION_SCENES.play as readonly string[]).toContain(story);

    // An expansion scene between them leaves the companion stories' turn alone.
    expect(handleMascotCommand("/play x001")).toBe(true);
    expect(handleMascotCommand("/play")).toBe(true);
    expect(queue()).toEqual([`scene:${storyFor(undefined, story)}`]);
  });

  it("still knows the companion stories and their plain words", () => {
    expect(handleMascotCommand("/play dinosaur")).toBe(true);
    expect(queue()).toEqual(["scene:dino"]);
    expect(handleMascotCommand("/playx001")).toBe(false);
  });
});

describe("handleMascotCommand", () => {
  it("forwards the retired /mascot-hat command to the agent", () => {
    expect(handleMascotCommand("/mascot-hat crown")).toBe(false);
  });

  it("handles /dance and a valid aura, and forwards plain text", () => {
    expect(handleMascotCommand("/dance")).toBe(true);
    expect(handleMascotCommand("/mascot-aura #ff8800")).toBe(true);
    expect(handleMascotCommand("create a sprint called Sprint 47")).toBe(false);
  });

  it("keeps a typed aura as its hex (the sprite themes it), and clears it with none", () => {
    useMascotStore.getState().reset();
    handleMascotCommand("/mascot-aura 22C55E");
    expect(useMascotStore.getState().auraColor).toBe("#22c55e");
    handleMascotCommand("/mascot-aura none");
    expect(useMascotStore.getState().auraColor).toBeNull();
  });
});

describe("the Konami rainbow", () => {
  const globals = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
  /** The custom properties a theme block declares. */
  function declared(selector: string): Set<string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block = globals.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!block) throw new Error(`no ${selector} block in globals.css`);
    return new Set(Array.from(block[1].matchAll(/--([\w-]+):/g), (m) => m[1]));
  }

  it("is six theme tokens, red to violet, with no hex", () => {
    expect(RAINBOW).toEqual([
      "var(--danger)",
      "var(--neon-amber)",
      "var(--warning)",
      "var(--success)",
      "var(--info)",
      "var(--accent3)",
    ]);
    for (const c of RAINBOW) expect(c).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("names only tokens every theme defines: night, comic and high contrast", () => {
    const themes = [":root", '[data-theme="light"]', '[data-theme="hc"]'].map(declared);
    for (const c of RAINBOW) {
      const name = c.match(/^var\(--([\w-]+)\)$/)![1];
      for (const t of themes) expect(t.has(name), name).toBe(true);
    }
  });

  describe("the sweep", () => {
    let uninstall: () => void = () => {};
    beforeEach(() => {
      vi.useFakeTimers();
      useMascotStore.getState().reset();
    });
    afterEach(() => {
      uninstall();
      vi.useRealTimers();
      useMascotStore.getState().reset();
    });

    it("steps the aura through the tokens, then clears it", () => {
      const seen: (string | null)[] = [];
      const unsubscribe = useMascotStore.subscribe((s, prev) => {
        if (s.auraColor !== prev.auraColor) seen.push(s.auraColor);
      });
      const onActivate = vi.fn();
      uninstall = installKonami(onActivate);
      for (const key of [
        "ArrowUp",
        "ArrowUp",
        "ArrowDown",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowLeft",
        "ArrowRight",
        "b",
        "a",
      ]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      }
      expect(onActivate).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(200 * (RAINBOW.length + 1));
      unsubscribe();
      expect(seen).toEqual([...RAINBOW, null]);
    });
  });
});
