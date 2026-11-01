import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_TOOLS, sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import { BACKLOG_SOURCE_TOOL, storyFromBacklogItem } from "@/app/(tools)/sprint-planning/view";

/**
 * Every Prioritize & decide tool whose items land elsewhere with its
 * sourceRef gets a "From …" back-link: a story pulled from the backlog,
 * a funded Buy-a-Feature feature, a Cynefin hypothesis, a weighted
 * matrix's decision record.
 */

const src = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

describe("Prioritize & decide back-links", () => {
  it("link a story pulled from the backlog back to the Backlog Prioritizer", () => {
    const story = storyFromBacklogItem({ id: "b1", name: "Search filters" }, "s1");
    expect(story.sourceRef).toEqual({ tool: BACKLOG_SOURCE_TOOL, id: "b1" });
    expect(sourceLabel(story.sourceRef)).toBe("From Backlog Prioritizer");
    expect(sourceHref(story.sourceRef)).toBe("/prioritizer");
  });

  it("list every tool the Phase 7 code sends with", () => {
    const SENT_RE = /sourceRef(?::\s*HandoffRef)?\s*[:=]\s*\{\s*tool:\s*"([^"]+)"/g;
    const files = [
      ["app", "(tools)", "buy-a-feature", "buy-a-feature-client.tsx"],
      ["lib", "cynefin", "model.ts"],
      ["lib", "weighted", "model.ts"],
    ];
    const sent = Array.from(
      new Set(files.flatMap((f) => Array.from(src(...f).matchAll(SENT_RE), (m) => m[1])))
    );
    expect(sent.sort()).toEqual(["buy-a-feature", "cynefin", "weighted-decision"]);
    for (const tool of [...sent, BACKLOG_SOURCE_TOOL]) {
      expect(Object.prototype.hasOwnProperty.call(SOURCE_TOOLS, tool), tool).toBe(true);
    }
  });

  it("open the matrix a weighted decision came from", () => {
    expect(sourceHref({ tool: "weighted-decision", id: "m1", doc: "m1" })).toBe(
      "/weighted-decision?matrix=m1"
    );
  });
});
