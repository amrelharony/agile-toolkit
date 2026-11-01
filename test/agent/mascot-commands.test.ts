/**
 * Mascot slash-command parser. A claimed command never reaches the agent, so
 * anything it doesn't recognise (including the retired hats) must pass through.
 */

import { describe, it, expect } from "vitest";
import { handleMascotCommand } from "@/components/agent/mascot/engine/customization/commands";

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
