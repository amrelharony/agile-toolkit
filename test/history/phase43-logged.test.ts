// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as CATALOGS from "@/lib/history/event-actions";

/**
 * Every history name of the tools plan's phase 2 new tools is logged
 * somewhere in src: a name no page logs is a history event the tool can
 * never produce, which history filters, the mascot and insights would then
 * carry as dead weight (Product Metrics, the A/B Calculator and the EBM
 * Dashboard once listed resets they have no control for).
 */
const NEW_TOOL_CATALOGS = [
  "AB_CALCULATOR_ACTIONS",
  "BUG_TRIAGE_ACTIONS",
  "EBM_DASHBOARD_ACTIONS",
  "EXAMPLE_MAPPING_ACTIONS",
  "FLOW_INSIGHTS_ACTIONS",
  "HILL_CHART_ACTIONS",
  "IMPACT_MAP_ACTIONS",
  "IMPROVE_ACTIONS",
  "KICKOFF_ACTIONS",
  "NOTES_TO_ACTIONS_ACTIONS",
  "PERSONA_LIBRARY_ACTIONS",
  "PRODUCT_CANVAS_ACTIONS",
  "PRODUCT_METRICS_ACTIONS",
  "RELATIVE_SIZING_ACTIONS",
  "STRATEGY_TREE_ACTIONS",
  "TEAM_TIME_ACTIONS",
  "TEST_SESSIONS_ACTIONS",
] as const;

const SRC = join(process.cwd(), "src");
const CATALOG_FILE = join(SRC, "lib/history/event-actions.ts");

/** Every source file's text, the catalog itself and the generated registry left out. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "_generated") sources(p, out);
    } else if (/\.tsx?$/.test(e.name) && p !== CATALOG_FILE) {
      out.push(readFileSync(p, "utf8"));
    }
  }
  return out;
}

describe("the phase 2 new tools' history names", () => {
  const all = sources(SRC).join("\n");

  it.each(NEW_TOOL_CATALOGS)("%s: every name is logged somewhere in src", (catalog) => {
    const actions = (CATALOGS as unknown as Record<string, Record<string, string>>)[catalog];
    expect(actions, catalog).toBeDefined();
    const keys = Object.keys(actions);
    expect(keys.length).toBeGreaterThan(0);
    const unlogged = keys.filter((k) => !new RegExp(`\\b${catalog}\\s*\\.\\s*${k}\\b`).test(all));
    expect(unlogged, catalog).toEqual([]);
  });
});
