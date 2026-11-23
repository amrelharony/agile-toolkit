/**
 * Amr's chat commands and the Konami sweep. A claimed command never reaches
 * the AI, so anything it doesn't recognise (the retired hats among them) must
 * pass through; one it runs leaves a note for the composer's status row, in
 * the narrator's voice. The command lives apart from the Konami listener,
 * which Amr's every-page chunk carries. The sweep paints his aura in theme
 * tokens, never pure neon hexes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as konami from "@/components/agent/mascot/engine/customization/commands";
import {
  AURA_OFF_NOTE,
  AURA_ON_NOTE,
  DANCE_NOTE,
  handleMascotCommand,
  NO_SCENE_NOTE,
  PLAY_NOTE,
  storyFor,
} from "@/components/agent/mascot/engine/customization/chat-commands";
import { COMPANION_SCENES } from "@/components/agent/mascot/engine/scenes";
import { useMascotStore } from "@/lib/agent/mascot/store";

const { RAINBOW, installKonami } = konami;

const queue = () => useMascotStore.getState().reactionQueue;
const played = { note: PLAY_NOTE };

describe("/play an expansion scene", () => {
  beforeEach(() => useMascotStore.getState().reset());

  it("plays any shipped expansion scene by its pack's name, in any case", () => {
    expect(handleMascotCommand("/play x001")).toEqual(played);
    expect(queue()).toEqual(["scene:x001"]);
    expect(handleMascotCommand("/play X001")).toEqual(played);
    expect(queue()).toEqual(["scene:x001"]);
    expect(handleMascotCommand("  /PLAY X124 ")).toEqual(played);
    expect(queue()).toEqual(["scene:x124"]);
    expect(storyFor("X057", null)).toBe("x057");
  });

  it("plays X112 as its filter moment, as the Scenes tab does", () => {
    expect(handleMascotCommand("/play x112")).toEqual(played);
    expect(queue()).toEqual(["scene:x112.filter"]);
  });

  it("keeps today's turn for a name it doesn't know, and for /play alone", () => {
    const first = COMPANION_SCENES.play[0];
    expect(storyFor("x999", null)).toBe(first);
    expect(storyFor("x112.filter", null)).toBe(first);
    expect(storyFor("x12", null)).toBe(first);
    expect(handleMascotCommand("/play x999")).toEqual(played);
    expect(queue()).toHaveLength(1);
    const story = queue()[0].slice("scene:".length);
    expect(COMPANION_SCENES.play as readonly string[]).toContain(story);

    // An expansion scene between them leaves the companion stories' turn alone.
    expect(handleMascotCommand("/play x001")).toEqual(played);
    expect(handleMascotCommand("/play")).toEqual(played);
    expect(queue()).toEqual([`scene:${storyFor(undefined, story)}`]);
  });

  it("still knows the companion stories and their plain words", () => {
    expect(handleMascotCommand("/play dinosaur")).toEqual(played);
    expect(queue()).toEqual(["scene:dino"]);
    expect(handleMascotCommand("/playx001")).toBeNull();
  });
});

describe("handleMascotCommand", () => {
  afterEach(() => {
    vi.useRealTimers();
    useMascotStore.getState().reset();
  });

  it("forwards the retired /mascot-hat command and plain text to the AI", () => {
    expect(handleMascotCommand("/mascot-hat crown")).toBeNull();
    expect(handleMascotCommand("create a sprint called Sprint 47")).toBeNull();
    expect(handleMascotCommand("dance with me")).toBeNull();
  });

  it("dances for /dance and a bare dance, and says so in a note", () => {
    vi.useFakeTimers();
    useMascotStore.getState().reset();
    const seen: string[] = [];
    const unsubscribe = useMascotStore.subscribe((s, prev) => {
      if (
        s.reactionQueue !== prev.reactionQueue &&
        s.reactionQueue.length > prev.reactionQueue.length
      )
        seen.push(s.reactionQueue[s.reactionQueue.length - 1]);
    });
    expect(handleMascotCommand("/dance")).toEqual({ note: DANCE_NOTE });
    vi.advanceTimersByTime(2000);
    unsubscribe();
    expect(seen).toEqual(["wave", "excited", "spin"]);
    expect(handleMascotCommand("  Dance ")).toEqual({ note: "Amr dances" });
  });

  it("keeps a typed aura as its hex (the sprite themes it), and clears it with none or off", () => {
    useMascotStore.getState().reset();
    expect(handleMascotCommand("/mascot-aura 22C55E")).toEqual({ note: AURA_ON_NOTE });
    expect(useMascotStore.getState().auraColor).toBe("#22c55e");
    expect(handleMascotCommand("/mascot-aura #ff8800")).toEqual({ note: AURA_ON_NOTE });
    expect(useMascotStore.getState().auraColor).toBe("#ff8800");
    expect(handleMascotCommand("/mascot-aura none")).toEqual({ note: AURA_OFF_NOTE });
    expect(useMascotStore.getState().auraColor).toBeNull();
    expect(handleMascotCommand("/mascot-aura off")).toEqual({ note: AURA_OFF_NOTE });
  });

  it("writes each note as narration: Amr in the third person, no I, me or my", () => {
    for (const note of [DANCE_NOTE, AURA_ON_NOTE, AURA_OFF_NOTE, PLAY_NOTE, NO_SCENE_NOTE]) {
      expect(note).toMatch(/^Amr/);
      expect(note).not.toMatch(/\b(?:I|me|my)\b/i);
      expect(note).not.toMatch(/[—–]/);
    }
  });

  it("is not in the module Amr's every-page chunk imports for the Konami listener", () => {
    expect(Object.keys(konami).sort()).toEqual(["RAINBOW", "installKonami"]);
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
