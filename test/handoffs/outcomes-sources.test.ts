import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_TOOLS, sourceHref, sourceLabel } from "@/lib/handoffs/registry";

/**
 * Every Outcomes & quality tool whose items land elsewhere with its
 * sourceRef gets a "From …" back-link (Phase 8): a quote raised as an
 * opportunity, an assumption or an experiment sent to the Hypothesis
 * Tracker, a risk raised as an impediment, a debt item added to the
 * backlog (on the page and through the agent verbs).
 */

const src = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");

describe("Outcomes & quality back-links", () => {
  it("list every tool the Phase 8 code sends with", () => {
    const SENT_RE = /sourceRef(?::\s*HandoffRef)?\s*[:=]\s*\{\s*tool:\s*"([^"]+)"/g;
    const files = [
      ["lib", "interviews", "model.ts"],
      ["lib", "opportunity-tree", "model.ts"],
      ["lib", "assumptions", "model.ts"],
      ["lib", "risks", "model.ts"],
      ["lib", "actions", "tools", "tech-debt.ts"],
    ];
    const sent = Array.from(
      new Set(files.flatMap((f) => Array.from(src(...f).matchAll(SENT_RE), (m) => m[1])))
    );
    expect(sent.sort()).toEqual([
      "opportunity-tree",
      "risk-register",
      "riskiest-assumption",
      "tech-debt",
      "user-interviews",
    ]);
    // The Tech Debt page sends its backlog story under its TOOL_ID.
    const client = src("app", "(tools)", "tech-debt", "tech-debt-client.tsx");
    expect(client).toMatch(/sourceRef:\s*\{\s*tool:\s*TOOL_ID\b/);
    const pageTool = /export const TOOL_ID = "([^"]+)"/.exec(client)?.[1];
    expect(pageTool).toBe("tech-debt");
    for (const tool of sent) {
      expect(Object.prototype.hasOwnProperty.call(SOURCE_TOOLS, tool), tool).toBe(true);
    }
  });

  it("label and link each back to its page", () => {
    const cases: [string, string, string][] = [
      ["user-interviews", "From user interviews", "/user-interviews"],
      ["opportunity-tree", "From opportunity tree", "/opportunity-tree"],
      ["riskiest-assumption", "From riskiest assumption", "/riskiest-assumption"],
      ["risk-register", "From Risk Register", "/risk-register"],
      ["tech-debt", "From tech debt", "/tech-debt"],
    ];
    for (const [tool, label, href] of cases) {
      const ref = { tool, id: "x1", doc: "d1" };
      expect(sourceLabel(ref), tool).toBe(label);
      expect(sourceHref(ref), tool).toBe(href);
    }
  });
});
