// @vitest-environment node
/**
 * pickModel and minEffort (lib/agent/upstream.ts): the model a tool AI task
 * gets on each backend, and the effort cap that keeps the visitor config row
 * working as a brake. The owner's chat keeps using `backend.model` unchanged.
 */

import { describe, expect, it } from "vitest";
import {
  minEffort,
  pickModel,
  resolveOwnerBackend,
  resolveVisitorBackend,
} from "@/lib/agent/upstream";

describe("pickModel", () => {
  it("OpenClaw, owner: openclaw-flash for flash, OPENCLAW_MODEL (default openclaw) for full", () => {
    const b = resolveOwnerBackend({ OPENCLAW_API_KEY: "k" })!;
    expect(pickModel(b, "flash")).toBe("openclaw-flash");
    expect(pickModel(b, "full")).toBe("openclaw");
    const custom = resolveOwnerBackend({ OPENCLAW_API_KEY: "k", OPENCLAW_MODEL: "openclaw-pro" })!;
    expect(pickModel(custom, "full")).toBe("openclaw-pro");
    expect(pickModel(custom, "flash")).toBe("openclaw-flash");
  });

  it("a bigmodel key: its flash model, or GLM_AGENT_MODEL for full", () => {
    const b = resolveOwnerBackend({ GLM_API_KEY: "k", GLM_AGENT_MODEL: "glm-5" })!;
    expect(pickModel(b, "flash")).toBe("glm-4.5-flash");
    expect(pickModel(b, "full")).toBe("glm-5");
  });

  it("a Z.AI key: the same pattern", () => {
    const b = resolveOwnerBackend({ ZAI_API_KEY: "k", ZAI_AGENT_MODEL: "glm-5.3" })!;
    expect(pickModel(b, "flash")).toBe("glm-5.3-flash");
    expect(pickModel(b, "full")).toBe("glm-5.3");
  });

  it("visitors always get VISITOR_AI_MODEL, whatever the tier", () => {
    const b = resolveVisitorBackend({
      VISITOR_AI_ENABLED: "1",
      OPENCLAW_API_KEY: "k",
      VISITOR_AI_MODEL: "visitor-x",
    })!;
    expect(pickModel(b, "flash", "visitor")).toBe("visitor-x");
    expect(pickModel(b, "full", "visitor")).toBe("visitor-x");
  });

  it("leaves the backend itself unchanged", () => {
    const b = resolveOwnerBackend({ OPENCLAW_API_KEY: "k" })!;
    pickModel(b, "flash");
    expect(b.model).toBe("openclaw");
  });
});

describe("minEffort", () => {
  it("takes the lower of the two, low < high < max", () => {
    expect(minEffort("high", "low")).toBe("low");
    expect(minEffort("low", "high")).toBe("low");
    expect(minEffort("high", "max")).toBe("high");
    expect(minEffort("max", "high")).toBe("high");
    expect(minEffort("high", "high")).toBe("high");
  });

  it("keeps the task's effort when there is no cap or an unknown one", () => {
    expect(minEffort("high")).toBe("high");
    expect(minEffort("low", null)).toBe("low");
    expect(minEffort("high", "extreme" as never)).toBe("high");
  });
});
