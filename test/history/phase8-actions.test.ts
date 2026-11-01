import { describe, expect, it } from "vitest";
import {
  CODE_REVIEW_ACTIONS,
  FLAKY_TEST_ACTIONS,
  HYPOTHESIS_ACTIONS,
  INTERVIEW_ACTIONS,
  NPS_CSAT_ACTIONS,
  OKR_ACTIONS,
  OPPORTUNITY_TREE_ACTIONS,
  QUALITY_COST_ACTIONS,
  RISKIEST_ASSUMPTION_ACTIONS,
  RISK_ACTIONS,
  TECH_DEBT_ACTIONS,
  TEST_PYRAMID_ACTIONS,
  isMilestoneAction,
} from "@/lib/history/event-actions";

/**
 * The history actions the Phase 8 pages log live in the shared catalog: the
 * strings logged before stay as they were (stored history rows keep them),
 * each tool's actions are distinct, and the new ones are not milestones.
 */

const BLOCKS: [tool: string, actions: Record<string, string>][] = [
  ["okrs", OKR_ACTIONS],
  ["nps-csat", NPS_CSAT_ACTIONS],
  ["hypothesis-tracker", HYPOTHESIS_ACTIONS],
  ["user-interviews", INTERVIEW_ACTIONS],
  ["opportunity-tree", OPPORTUNITY_TREE_ACTIONS],
  ["riskiest-assumption", RISKIEST_ASSUMPTION_ACTIONS],
  ["risk-register", RISK_ACTIONS],
  ["tech-debt", TECH_DEBT_ACTIONS],
  ["quality-cost", QUALITY_COST_ACTIONS],
  ["test-pyramid", TEST_PYRAMID_ACTIONS],
  ["flaky-tests", FLAKY_TEST_ACTIONS],
  ["code-review-metrics", CODE_REVIEW_ACTIONS],
];

describe("the Phase 8 history actions", () => {
  it("keep the strings the pages logged", () => {
    expect(OKR_ACTIONS.PROGRESS_UPDATED).toBe("progress_updated");
    expect(NPS_CSAT_ACTIONS.SURVEY_ADDED).toBe("survey_added");
    expect(NPS_CSAT_ACTIONS.SURVEY_REMOVED).toBe("survey_removed");
    expect(RISK_ACTIONS.RISK_UPDATED).toBe("risk_updated");
    expect(TECH_DEBT_ACTIONS.ITEM_RESOLVED).toBe("item_resolved");
    expect(CODE_REVIEW_ACTIONS.PR_LOGGED).toBe("pr_logged");
    expect(TEST_PYRAMID_ACTIONS.COUNT_UPDATED).toBe("count_updated");
    expect(QUALITY_COST_ACTIONS.COST_UPDATED).toBe("cost_updated");
  });

  it("name what the upgraded pages do", () => {
    expect(OKR_ACTIONS.CHECK_IN_RECORDED).toBe("check_in_recorded");
    expect(NPS_CSAT_ACTIONS.RESPONSES_IMPORTED).toBe("responses_imported");
    expect(HYPOTHESIS_ACTIONS.RESULT_RECORDED).toBe("result_recorded");
    expect(INTERVIEW_ACTIONS.QUOTE_SENT).toBe("quote_sent");
    expect(OPPORTUNITY_TREE_ACTIONS.TARGET_CHANGED).toBe("target_changed");
    expect(OPPORTUNITY_TREE_ACTIONS.EXPERIMENT_SENT).toBe("experiment_sent");
    expect(RISKIEST_ASSUMPTION_ACTIONS.TEST_CREATED).toBe("test_created");
    expect(RISK_ACTIONS.RISK_ESCALATED).toBe("risk_escalated");
    expect(TECH_DEBT_ACTIONS.ITEM_SENT_TO_BACKLOG).toBe("item_sent_to_backlog");
    expect(TEST_PYRAMID_ACTIONS.SNAPSHOT_TAKEN).toBe("snapshot_taken");
    expect(TEST_PYRAMID_ACTIONS.SNAPSHOT_REMOVED).toBe("snapshot_removed");
    expect(TEST_PYRAMID_ACTIONS.RUNTIME_UPDATED).toBe("runtime_updated");
    expect(QUALITY_COST_ACTIONS.PERIOD_SAVED).toBe("period_saved");
    expect(QUALITY_COST_ACTIONS.PERIOD_REMOVED).toBe("period_removed");
    expect(CODE_REVIEW_ACTIONS.PR_UPDATED).toBe("pr_updated");
    expect(CODE_REVIEW_ACTIONS.PRS_IMPORTED).toBe("prs_imported");
  });

  it.each(BLOCKS)("%s: each action is its own string", (_tool, actions) => {
    const values = Object.values(actions);
    expect(new Set(values).size).toBe(values.length);
  });

  it("the new ones are not milestones", () => {
    const added: [string, string][] = [
      ["okrs", OKR_ACTIONS.CHECK_IN_RECORDED],
      ["nps-csat", NPS_CSAT_ACTIONS.RESPONSES_IMPORTED],
      ["hypothesis-tracker", HYPOTHESIS_ACTIONS.RESULT_RECORDED],
      ["risk-register", RISK_ACTIONS.RISK_ESCALATED],
      ["tech-debt", TECH_DEBT_ACTIONS.ITEM_SENT_TO_BACKLOG],
      ["test-pyramid", TEST_PYRAMID_ACTIONS.SNAPSHOT_TAKEN],
      ["test-pyramid", TEST_PYRAMID_ACTIONS.RUNTIME_UPDATED],
      ["quality-cost", QUALITY_COST_ACTIONS.PERIOD_SAVED],
      ["code-review-metrics", CODE_REVIEW_ACTIONS.PRS_IMPORTED],
    ];
    for (const [tool, a] of added) expect(isMilestoneAction(tool, a), `${tool}:${a}`).toBe(false);
  });
});
