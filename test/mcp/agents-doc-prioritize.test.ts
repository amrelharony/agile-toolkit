/**
 * docs/MCP-AGENTS.md against the code it describes, for the Prioritize &
 * decide tools: every registered verb is documented under its tool, the
 * verbs that ask first are the ones the registry makes confirm, the
 * numbers are the libraries' own, the stale WSJF example is gone and the
 * new one returns what the code returns. A change on either side fails
 * here instead of leaving the doc wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/workspace";
import "@/lib/actions/tools/prioritizer";
import "@/lib/actions/tools/rice-scoring";
import "@/lib/actions/tools/wsjf";
import "@/lib/actions/tools/ice-score";
import "@/lib/actions/tools/moscow";
import "@/lib/actions/tools/cost-of-delay";
import "@/lib/actions/tools/value-effort-matrix";
import "@/lib/actions/tools/eisenhower";
import "@/lib/actions/tools/kano-model";
import "@/lib/actions/tools/buy-a-feature";
import "@/lib/actions/tools/hundred-dollar-test";
import "@/lib/actions/tools/decision-log";
import "@/lib/actions/tools/daci";
import "@/lib/actions/tools/rapid-decision";
import "@/lib/actions/tools/weighted-decision";
import "@/lib/actions/tools/cynefin";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { MANY_AGREE, STALE_PROPOSED_DAYS } from "@/lib/decisions/model";
import { MUST_BUDGET_MIN_SIZED, MUST_BUDGET_SHARE } from "@/lib/prioritization/methods/moscow";
import { VE_HIGH_EFFORT_FROM, VE_HIGH_VALUE_FROM } from "@/lib/prioritization/methods/value-effort";
import { URGENT_WITHIN_DAYS } from "@/lib/prioritization/methods/eisenhower";
import { KANO_MIN_RESPONSES } from "@/lib/prioritization/methods/kano";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import { TIE_MARGIN } from "@/lib/weighted/model";
import { BUY_A_FEATURE_ID, DEFAULT_WEIGHTED_MATRIX_ID } from "@/lib/stores/workspace-types";

const DOC = readFileSync(join(process.cwd(), "docs", "MCP-AGENTS.md"), "utf8");

/** The text under `heading`, up to the next heading of the same level or above. */
function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`No "${heading}" in docs/MCP-AGENTS.md`);
  const level = heading.slice(0, heading.indexOf(" ")).length;
  const rest = DOC.slice(start + heading.length + 1);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

const PRIORITIZE = section("### Prioritize & decide");
const HUB = section("#### Backlog Prioritizer — `tool.prioritizer.*`");
const METHODS = section("#### RICE, WSJF, ICE, MoSCoW and Cost of Delay");
const VE = section("#### Value vs Effort — `tool.value_effort_matrix.*`");
const EIS = section("#### Eisenhower — `tool.eisenhower.*`");
const KANO = section("#### Kano — `tool.kano_model.*`");
const BAF = section("#### Buy-a-Feature — `tool.buy_a_feature.*`");
const HDT = section("#### $100 Test — `tool.hundred_dollar_test.*`");
const DECISIONS = section("#### Decision Log, DACI and RAPID — `tool.decision_log.*`");
const WEIGHTED = section("#### Weighted Decision Matrix — `tool.weighted_decision.*`");
const CYNEFIN = section("#### Cynefin Decision Picker — `tool.cynefin.*`");

const ctx = () => ({ userId: "test-user", source: "agent" as const, squadProfileIds: [] });

describe("MCP-AGENTS.md: the Prioritize & decide verbs", () => {
  it.each([
    ["tool.prioritizer", HUB],
    ["tool.rice_scoring", METHODS],
    ["tool.wsjf", METHODS],
    ["tool.ice_score", METHODS],
    ["tool.moscow", METHODS],
    ["tool.cost_of_delay", METHODS],
    ["tool.value_effort_matrix", VE],
    ["tool.eisenhower", EIS],
    ["tool.kano_model", KANO],
    ["tool.buy_a_feature", BAF],
    ["tool.hundred_dollar_test", HDT],
    ["tool.decision_log", DECISIONS],
    ["tool.daci", DECISIONS],
    ["tool.rapid_decision", DECISIONS],
    ["tool.weighted_decision", WEIGHTED],
    ["tool.cynefin", CYNEFIN],
  ] as const)("%s: every registered verb is documented", (toolId, text) => {
    const verbs = registry
      .list({ toolId })
      .filter((a) => a.toolId === toolId)
      .map((a) => a.name);
    expect(verbs.length).toBeGreaterThan(0);
    for (const verb of verbs)
      expect(text, `${toolId}.${verb}`).toMatch(new RegExp(`\\b${verb}\\b`));
  });

  it("the verbs that ask first are the ones the registry makes confirm", () => {
    const confirmed = registry
      .list()
      .filter(
        (a) =>
          a.requiresConfirmation &&
          /^tool\.(prioritizer|buy_a_feature|decision_log|weighted_decision|cynefin|hundred_dollar_test)\./.test(
            a.id
          )
      )
      .map((a) => a.id)
      .sort();
    expect(confirmed).toEqual([
      "tool.buy_a_feature.refund_unfunded",
      "tool.decision_log.delete",
      "tool.prioritizer.set_order",
    ]);
    expect(HUB).toContain("**`set_order`** (write, asks first)");
    expect(BAF).toContain("**`refund_unfunded`** (asks first)");
    expect(DECISIONS).toContain("**`delete`** (write, asks first)");
  });

  it("the stale WSJF example is gone", () => {
    expect(registry.get("tool.wsjf.compute_scores")).toBeUndefined();
    expect(DOC).not.toContain("tool.wsjf.compute_scores");
    expect(DOC).not.toContain("### Score a backlog with WSJF then persist top items");
    expect(DOC).not.toMatch(/"riskReduction":3,"jobSize":3/);
  });

  it("the WSJF example returns what compute_and_rank returns", async () => {
    const items = [
      {
        id: "f1",
        title: "Single sign-on",
        fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2 },
      },
      {
        id: "f2",
        title: "Audit log export",
        fields: { businessValue: 3, timeCriticality: 1, rrOe: 1, jobSize: 1 },
      },
    ];
    for (const item of items) expect(PRIORITIZE).toContain(JSON.stringify(item));
    const out = (await registry.get("tool.wsjf.compute_and_rank")!.handler({ items }, ctx())) as {
      ranked: { id: string; score: number; rank: number }[];
      count: number;
      columnsWithoutOne: string[];
    };
    expect(out.ranked.map((r) => [r.id, r.score, r.rank])).toEqual([
      ["f1", 8, 1],
      ["f2", 5, 2],
    ]);
    expect(out.count).toBe(2);
    expect(out.columnsWithoutOne).toEqual(["businessValue"]);
    expect(PRIORITIZE).toContain('{"id": "f1", "score": 8, "rank": 1, ...}');
    expect(PRIORITIZE).toContain('{"id": "f2", "score": 5, "rank": 2, ...}');
    expect(PRIORITIZE).toContain('"count": 2, "columnsWithoutOne": ["businessValue"]');
  });
});

describe("MCP-AGENTS.md: the Prioritize & decide rules", () => {
  it("live rounds run in the browser, and agents record totals under the kit's minimums", () => {
    const bullet =
      PRIORITIZE.split("\n").find((l) => l.startsWith("- **Live rounds run in the browser.**")) ??
      "";
    for (const id of [
      "tool.kano_model.record_round",
      "tool.buy_a_feature.record_round",
      "tool.hundred_dollar_test.record_round",
    ]) {
      expect(registry.get(id), id).toBeDefined();
      expect(bullet).toContain(`\`${id}\``);
    }
    expect(MIN_SAMPLE.anonymous).toBe(3);
    expect(MIN_SAMPLE.distribution).toBe(5);
    expect(bullet).toContain("results from 3 people, who backed what and the spread from 5");
    expect(bullet).toContain("No action takes or returns anyone's answers or split.");
  });

  it("one value field on the Fibonacci steps, and the decided rank", () => {
    const bullet =
      PRIORITIZE.split("\n").find((l) =>
        l.startsWith("- **One backlog, one value field, one decided order.**")
      ) ?? "";
    expect(bullet).toContain(FIBONACCI_VALUES.join(", "));
    expect(bullet).toContain("only `tool.prioritizer.set_order`");
    expect(VE).toContain(`(${VE_HIGH_VALUE_FROM} or more is high`);
    expect(VE).toContain(`effort is 1–10 (${VE_HIGH_EFFORT_FROM} or more is high)`);
  });

  it("the method minimums are the libraries' own", () => {
    expect(METHODS).toContain(`at most about ${Math.round(MUST_BUDGET_SHARE * 100)}%`);
    expect(METHODS).toContain(`\`share\` is null below ${MUST_BUDGET_MIN_SIZED} sized items`);
    expect(EIS).toContain(`due within ${URGENT_WITHIN_DAYS} days, overdue included`);
    expect(KANO).toContain(`from ${KANO_MIN_RESPONSES} answers`);
    expect(BAF).toContain(`id \`${BUY_A_FEATURE_ID}\``);
    expect(WEIGHTED).toContain(`within ${Math.round(TIE_MARGIN * 100)}% of the leader`);
    expect(WEIGHTED).toContain(`\`${DEFAULT_WEIGHTED_MATRIX_ID}\``);
  });

  it("the decision record: one numbering, the aliases and the generic delete caveat", () => {
    expect(DECISIONS).toContain("**One numbering sequence** runs across the forms");
    expect(DECISIONS).toContain(`proposed for over ${STALE_PROPOSED_DAYS} days`);
    expect(DECISIONS).toContain(`more than ${MANY_AGREE} Agree`);
    for (const id of [
      "workspace.decision.delete",
      "workspace.daci_decision.list",
      "workspace.rapid_decision.list",
    ]) {
      expect(registry.get(id), id).toBeDefined();
    }
    expect(DECISIONS).toContain(
      "**Delete with `tool.decision_log.delete`, not `workspace.decision.delete`.**"
    );
    expect(DECISIONS).toContain("reads back in from that row");
    expect(DECISIONS).toContain("`workspace.daci_decision.*` and `workspace.rapid_decision.*`");
    // The registry's own description of the tool verb says the same.
    expect(registry.get("tool.decision_log.delete")?.description).toContain(
      "not workspace.decision.delete"
    );
  });
});
