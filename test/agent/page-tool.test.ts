/**
 * lib/agent/page-tool.ts — which tool a page or a stored tool id refers to.
 * The chat sends the result as its toolId, and the client's grounding and tool
 * selection both key off it, so a sub-page, a trailing slash or an old
 * conversation's stored path must all land on the same registry id.
 */

import { describe, it, expect } from "vitest";
import { resolvePageTool, toolIdForPath } from "@/lib/agent/page-tool";

describe("toolIdForPath", () => {
  it("maps a tool's page to its registry id", () => {
    expect(toolIdForPath("/retro")).toBe("retro");
    expect(toolIdForPath("/planning-poker")).toBe("planning-poker");
  });

  it("counts a tool's sub-page and a trailing slash as the tool", () => {
    expect(toolIdForPath("/retro/abc")).toBe("retro");
    expect(toolIdForPath("/retro/")).toBe("retro");
  });

  it("is null on pages that aren't a tool", () => {
    expect(toolIdForPath("/")).toBeNull();
    expect(toolIdForPath("/settings")).toBeNull();
    expect(toolIdForPath("/settings/access-tokens")).toBeNull();
    expect(toolIdForPath(null)).toBeNull();
    expect(toolIdForPath("")).toBeNull();
  });
});

describe("resolvePageTool", () => {
  it("accepts the id, its path or a bare slug", () => {
    expect(resolvePageTool("retro")?.id).toBe("retro");
    expect(resolvePageTool("/retro")?.id).toBe("retro");
    expect(resolvePageTool("planning-poker")?.path).toBe("/planning-poker");
  });

  it("is undefined for nothing or a non-tool", () => {
    expect(resolvePageTool(null)).toBeUndefined();
    expect(resolvePageTool("")).toBeUndefined();
    expect(resolvePageTool("settings")).toBeUndefined();
  });
});
