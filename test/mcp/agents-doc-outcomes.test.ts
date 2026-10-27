/**
 * docs/MCP-AGENTS.md against the code it describes, for the Outcomes,
 * quality & library tools: every registered verb is documented under its
 * tool, the verbs that ask first are the ones the registry makes confirm,
 * the numbers and document ids are the libraries' own, the comic has no
 * verb, and the OKR example returns what check_in returns. A change on
 * either side fails here instead of leaving the doc wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/workspace";
import "@/lib/actions/tools/okrs";
import "@/lib/actions/tools/nps-csat";
import "@/lib/actions/tools/hypothesis-tracker";
import "@/lib/actions/tools/user-interviews";
import "@/lib/actions/tools/opportunity-tree";
import "@/lib/actions/tools/riskiest-assumption";
import "@/lib/actions/tools/risk-register";
import "@/lib/actions/tools/tech-debt";
import "@/lib/actions/tools/quality-cost";
import "@/lib/actions/tools/test-pyramid";
import "@/lib/actions/tools/flaky-tests";
import "@/lib/actions/tools/code-review-metrics";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { CHECK_IN_NOTE_MAX } from "@/lib/okrs/progress";
import { HYPOTHESIS_TEXT_MAX, HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { CONTEXT_MAX, PARTICIPANT_MAX, QUOTE_TEXT_MAX, UI_ID } from "@/lib/interviews/model";
import { NODE_TEXT_MAX } from "@/lib/opportunity-tree/model";
import { ASSUMPTION_STATEMENT_MAX, RA_ID } from "@/lib/assumptions/model";
import { INTEREST_CAP, INTEREST_RATE_MAX } from "@/lib/tech-debt/model";
import { QUALITY_COST_KEY } from "@/lib/quality/cost";
import { PYRAMID_SNAPSHOT_MAX, SHAPE_TOLERANCE, TEST_PYRAMID_ID } from "@/lib/quality/pyramid";
import { FEW_RUNS, FLAKY_BOARD_ID, QUARANTINE_ALERT_DAYS } from "@/lib/quality/flaky";
import { CODE_REVIEW_LOG_ID } from "@/lib/quality/review";
import {
  KR_CHECK_IN_CAP,
  NPS_TAG_LIMIT,
  NPS_TAG_MAX_LENGTH,
  OPPORTUNITY_TREE_ID,
  type Okr,
} from "@/lib/stores/workspace-types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

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

const OUTCOMES = section("### Outcomes, quality & library");
const OKRS = section("#### OKR Tracker — `tool.okrs.*`");
const NPS = section("#### NPS / CSAT — `tool.nps_csat.*`");
const HYPOTHESES = section("#### Hypothesis Tracker — `tool.hypothesis_tracker.*`");
const INTERVIEWS = section("#### User Interview Log — `tool.user_interviews.*`");
const TREE = section("#### Opportunity Solution Tree — `tool.opportunity_tree.*`");
const ASSUMPTIONS = section("#### Riskiest Assumption Canvas — `tool.riskiest_assumption.*`");
const RISKS = section("#### Risk Register — `tool.risk_register.*`");
const DEBT = section("#### Technical Debt Tracker — `tool.tech_debt.*`");
const COQ = section("#### Cost of Quality — `tool.quality_cost.*`");
const PYRAMID = section("#### Test Pyramid Analyzer — `tool.test_pyramid.*`");
const FLAKY = section("#### Flaky Test Scoreboard — `tool.flaky_tests.*`");
const REVIEW = section("#### Code Review Metrics — `tool.code_review_metrics.*`");

const TOOLS = [
  ["tool.okrs", OKRS],
  ["tool.nps_csat", NPS],
  ["tool.hypothesis_tracker", HYPOTHESES],
  ["tool.user_interviews", INTERVIEWS],
  ["tool.opportunity_tree", TREE],
  ["tool.riskiest_assumption", ASSUMPTIONS],
  ["tool.risk_register", RISKS],
  ["tool.tech_debt", DEBT],
  ["tool.quality_cost", COQ],
  ["tool.test_pyramid", PYRAMID],
  ["tool.flaky_tests", FLAKY],
  ["tool.code_review_metrics", REVIEW],
] as const;

const ctx = () => ({ userId: "test-user", source: "agent" as const, squadProfileIds: [] });

describe("MCP-AGENTS.md: the Outcomes, quality & library verbs", () => {
  it.each(TOOLS)("%s: every registered verb is documented", (toolId, text) => {
    const verbs = registry
      .list({ toolId })
      .filter((a) => a.toolId === toolId)
      .map((a) => a.name);
    expect(verbs.length).toBeGreaterThan(0);
    for (const verb of verbs) expect(text, `${toolId}.${verb}`).toContain(`**\`${verb}\`**`);
  });

  it("the verbs that ask first are the ones the registry makes confirm", () => {
    const prefix = new RegExp(`^(${TOOLS.map(([id]) => id.replace(".", "\\.")).join("|")})\\.`);
    const confirmed = registry
      .list()
      .filter((a) => a.requiresConfirmation && prefix.test(a.id))
      .map((a) => a.id)
      .sort();
    expect(confirmed).toEqual([
      "tool.okrs.remove_check_in",
      "tool.opportunity_tree.remove_node",
      "tool.risk_register.delete",
      "tool.tech_debt.delete",
      "tool.tech_debt.mark_resolved",
    ]);
    expect(OKRS).toContain("**`remove_check_in`** (write, asks first)");
    expect(TREE).toContain("**`remove_node`** (write, asks first)");
    expect(RISKS).toContain("**`delete`** (write, asks first)");
    expect(DEBT).toContain("**`delete`** (write, asks first)");
    expect(DEBT).toContain("**`mark_resolved`** (write, asks first)");
  });

  it("the comic has no agent actions", () => {
    expect(registry.list().some((a) => /agile_at_work|comic/.test(a.id))).toBe(false);
    expect(OUTCOMES).toContain("**The comic has no agent actions.**");
  });

  it("the one-store moves: pending rows are read, and their delete is refused", () => {
    for (const id of ["tool.risk_register.delete", "tool.tech_debt.delete"]) {
      expect(registry.get(id)?.description, id).toContain("'pending_move'");
    }
    expect(OUTCOMES).toContain("`pending: true` on an item");
    expect(OUTCOMES).toContain("refused with `pending_move`");
    expect(OUTCOMES).toContain("with an error starting `pending_move:`");
  });
});

describe("MCP-AGENTS.md: the numbers and ids are the libraries' own", () => {
  it("OKRs and NPS", () => {
    expect(OKRS).toContain(`it keeps its ${KR_CHECK_IN_CAP} newest`);
    expect(OKRS).toContain(`note? (≤${CHECK_IN_NOTE_MAX})`);
    expect(NPS).toContain(`fewer than ${MIN_SAMPLE.surveyPeriod} answers of a kind`);
    expect(NPS).toContain(`minPerPeriod (${MIN_SAMPLE.surveyPeriod})`);
    expect(NPS).toContain(`at most ${NPS_TAG_LIMIT}, ${NPS_TAG_MAX_LENGTH} characters each`);
  });

  it("the discovery tools' documents and text limits", () => {
    expect(HYPOTHESES).toContain(`One document, \`${HYPOTHESIS_TRACKER_ID}\``);
    expect(HYPOTHESES).toContain(`each up to ${HYPOTHESIS_TEXT_MAX.toLocaleString("en-US")}`);
    expect(INTERVIEWS).toContain(`One document, \`${UI_ID}\``);
    expect(INTERVIEWS).toContain(`participant (≤${PARTICIPANT_MAX})`);
    expect(INTERVIEWS).toContain(`context? (≤${CONTEXT_MAX.toLocaleString("en-US")})`);
    expect(INTERVIEWS).toContain(`text (≤${QUOTE_TEXT_MAX.toLocaleString("en-US")})`);
    expect(TREE).toContain(`One document, \`${OPPORTUNITY_TREE_ID}\``);
    expect(TREE).toContain(`text (≤${NODE_TEXT_MAX.toLocaleString("en-US")})`);
    expect(ASSUMPTIONS).toContain(`One document, \`${RA_ID}\``);
    expect(ASSUMPTIONS).toContain(
      `statement (≤${ASSUMPTION_STATEMENT_MAX.toLocaleString("en-US")})`
    );
  });

  it("Tech Debt's cap and rate", () => {
    expect(DEBT).toContain(`min(${INTEREST_CAP}, interestRate × ageSprints)`);
    expect(DEBT).toContain(`(0–${INTEREST_RATE_MAX}; 0 when not estimated)`);
  });

  it("the quality tools' stores and thresholds", () => {
    expect(COQ).toContain(`(\`${QUALITY_COST_KEY}\`)`);
    expect(PYRAMID).toContain(`One document, \`${TEST_PYRAMID_ID}\``);
    expect(PYRAMID).toContain(`within ${Math.round(SHAPE_TOLERANCE * 100)} points`);
    expect(PYRAMID).toContain(`too_many (${PYRAMID_SNAPSHOT_MAX} at most)`);
    expect(FLAKY).toContain(`One board, \`${FLAKY_BOARD_ID}\``);
    expect(FLAKY).toContain(`those under ${FEW_RUNS} runs`);
    expect(FLAKY).toContain(`quarantined ${QUARANTINE_ALERT_DAYS} days or more`);
    expect(REVIEW).toContain(`One log, \`${CODE_REVIEW_LOG_ID}\``);
    expect(REVIEW).toContain(
      `The medians are \`null\` below ${MIN_SAMPLE.average} PRs and the P85s below ${MIN_SAMPLE.distribution}`
    );
  });
});

describe("MCP-AGENTS.md: the OKR example returns what check_in returns", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("a check-in on a key result from 20 to 50", async () => {
    const okr: Okr = {
      id: "okr_q4",
      objective: "Activation",
      quarter: "2026 Q4",
      keyResults: [
        {
          id: "kr_activation",
          title: "Activated accounts",
          baseline: 20,
          target: 50,
          current: 30,
          direction: "increase",
          checkIns: [{ id: "ci_week", date: "2026-10-19", value: 30 }],
        },
        {
          id: "kr_nps",
          title: "Onboarding NPS",
          baseline: 0,
          target: 100,
          current: 44,
          direction: "increase",
          checkIns: [{ id: "ci_old", date: "2026-10-19", value: 44 }],
        },
      ],
    };
    useWorkspaceStore.setState({ okrs: [okr] });
    const args = {
      okrId: "okr_q4",
      keyResultId: "kr_activation",
      value: 38,
      confidence: 6,
      date: "2026-10-26",
    };
    expect(OUTCOMES).toContain(
      '"okrId":"okr_q4", "keyResultId":"kr_activation", "value":38, "confidence":6, "date":"2026-10-26"'
    );
    const out = (await registry.get("tool.okrs.check_in")!.handler(args, ctx())) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out).sort()).toEqual(
      [
        "recorded",
        "checkInId",
        "date",
        "current",
        "confidence",
        "keyResultProgressPct",
        "progressPct",
        "replacedUndated",
      ].sort()
    );
    expect(out).toMatchObject({
      recorded: true,
      date: "2026-10-26",
      current: 38,
      confidence: 6,
      keyResultProgressPct: 60,
      progressPct: 52,
      replacedUndated: null,
    });
    expect(OUTCOMES).toContain(
      '"keyResultProgressPct": 60, "progressPct": 52, "replacedUndated": null'
    );
  });
});
