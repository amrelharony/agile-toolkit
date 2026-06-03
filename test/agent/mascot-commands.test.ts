/**
 * Mascot slash-command parser. Regression: `/mascot-hat <unknown>` used to
 * return true (swallowing the message) even when the hat id was invalid, so the
 * input vanished with no effect and was never forwarded to the agent.
 */

import { describe, it, expect } from "vitest";
import { handleMascotCommand } from "@/components/agent/mascot/engine/customization/commands";

describe("handleMascotCommand", () => {
  it("claims a known hat id", () => {
    expect(handleMascotCommand("/mascot-hat crown")).toBe(true);
    expect(handleMascotCommand("/mascot-hat none")).toBe(true);
  });

  it("does NOT swallow an unknown hat id — forwards it to the agent", () => {
    expect(handleMascotCommand("/mascot-hat wizard")).toBe(false);
  });

  it("handles /dance and a valid aura, and forwards plain text", () => {
    expect(handleMascotCommand("/dance")).toBe(true);
    expect(handleMascotCommand("/mascot-aura #ff8800")).toBe(true);
    expect(handleMascotCommand("create a sprint called Sprint 47")).toBe(false);
  });
});
