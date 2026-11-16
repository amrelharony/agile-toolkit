/**
 * Mascot slash-command parser. A claimed command never reaches the agent, so
 * anything it doesn't recognise (including the retired hats) must pass through.
 */

import { beforeEach, describe, it, expect } from "vitest";
import {
  handleMascotCommand,
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
});
