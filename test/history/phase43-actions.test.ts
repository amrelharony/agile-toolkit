import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AB_CALCULATOR_ACTIONS,
  ASYNC_STANDUP_ACTIONS,
  BUG_TRIAGE_ACTIONS,
  EBM_DASHBOARD_ACTIONS,
  EPIC_ROADMAP_ACTIONS,
  EXAMPLE_MAPPING_ACTIONS,
  FLOW_INSIGHTS_ACTIONS,
  HILL_CHART_ACTIONS,
  HYPOTHESIS_ACTIONS,
  IMPACT_MAP_ACTIONS,
  IMPEDIMENT_ACTIONS,
  IMPROVE_ACTIONS,
  KANBAN_ACTIONS,
  KICKOFF_ACTIONS,
  NOTES_TO_ACTIONS_ACTIONS,
  PERSONA_LIBRARY_ACTIONS,
  PI_PLANNING_ACTIONS,
  PLANNING_POKER_ACTIONS,
  PRODUCT_CANVAS_ACTIONS,
  PRODUCT_METRICS_ACTIONS,
  RELATIVE_SIZING_ACTIONS,
  RELEASE_READINESS_ACTIONS,
  ROOT_CAUSE_ACTIONS,
  STRATEGY_TREE_ACTIONS,
  TEAM_TIME_ACTIONS,
  TEST_SESSIONS_ACTIONS,
  WORKING_AGREEMENT_ACTIONS,
  isMilestoneAction,
} from "@/lib/history/event-actions";
import * as CATALOGS from "@/lib/history/event-actions";

/**
 * The history actions of the tools plan's phase 2, in the shared catalog
 * before the pages that log them are built: each new tool's names, the names
 * its additions bring to existing tools, and which of them are milestones.
 * A stored history row keeps its string, so these are pinned as written.
 */

/** Each new tool's catalog, with every name it holds and its one milestone (if any). */
const NEW_TOOLS: [
  tool: string,
  actions: Record<string, string>,
  names: string[],
  milestone?: string,
][] = [
  [
    "example-mapping",
    EXAMPLE_MAPPING_ACTIONS,
    [
      "MAP_CREATED",
      "MAP_UPDATED",
      "MAP_REMOVED",
      "RULE_ADDED",
      "EXAMPLE_ADDED",
      "QUESTION_ADDED",
      "QUESTION_ANSWERED",
      "VERDICT_SET",
      "SENT_TO_STORY",
      "SPLIT_BY_RULE",
    ],
    "sent_to_story",
  ],
  [
    "relative-sizing",
    RELATIVE_SIZING_ACTIONS,
    [
      "BOARD_CREATED",
      "BOARD_REMOVED",
      "ROUND_STARTED",
      "ROUND_SAVED",
      "SIZES_APPLIED",
      "SENT_TO_POKER",
    ],
    "sizes_applied",
  ],
  [
    "bug-triage",
    BUG_TRIAGE_ACTIONS,
    [
      "BUG_LOGGED",
      "BUG_TRIAGED",
      "BUG_UPDATED",
      "BUG_SENT",
      "BUG_CLOSED",
      "BUG_REOPENED",
      "BUG_REMOVED",
      "TRIAGE_DONE",
    ],
    "triage_done",
  ],
  [
    "hill-chart",
    HILL_CHART_ACTIONS,
    [
      "CHART_CREATED",
      "CHART_UPDATED",
      "CHART_REMOVED",
      "SCOPE_ADDED",
      "SCOPE_MOVED",
      "SCOPE_REMOVED",
      "SCOPE_RAISED",
      "CHECKED_IN",
      "SCOPE_DONE",
    ],
    "scope_done",
  ],
  [
    "test-sessions",
    TEST_SESSIONS_ACTIONS,
    [
      "SESSION_PLANNED",
      "SESSION_STARTED",
      "SESSION_ENDED",
      "NOTE_ADDED",
      "BUGS_SENT",
      "SESSION_DEBRIEFED",
      "SESSION_REMOVED",
    ],
    "session_debriefed",
  ],
  [
    "notes-to-actions",
    NOTES_TO_ACTIONS_ACTIONS,
    [
      "NOTES_ADDED",
      "ITEMS_FOUND",
      "ITEMS_KEPT",
      "ITEMS_SENT",
      "ITEM_DROPPED",
      "ITEM_ANSWERED",
      "NOTE_DONE",
      "NOTES_TEXT_FORGOTTEN",
      "NOTES_REMOVED",
    ],
    "note_done",
  ],
  [
    "product-canvas",
    PRODUCT_CANVAS_ACTIONS,
    [
      "CANVAS_CREATED",
      "CANVAS_UPDATED",
      "CANVAS_REMOVED",
      "DRAFT_ACCEPTED",
      "ITEM_SENT",
      "IDEA_LOGGED",
      "IDEAS_MERGED",
      "IDEA_TRIAGED",
      "CASE_DECIDED",
      "CASE_APPROVED",
      "BET_PLACED",
    ],
    "case_approved",
  ],
  [
    "impact-map",
    IMPACT_MAP_ACTIONS,
    [
      "MAP_CREATED",
      "MAP_UPDATED",
      "MAP_REMOVED",
      "NODE_ADDED",
      "NODE_UPDATED",
      "NODE_REMOVED",
      "FOCUS_SET",
      "FOCUS_CHANGED",
      "DELIVERABLE_SENT",
      "IMPACT_TESTED",
      "DRAFT_ACCEPTED",
    ],
    "focus_set",
  ],
  [
    "strategy-tree",
    STRATEGY_TREE_ACTIONS,
    [
      "TREE_CREATED",
      "TREE_UPDATED",
      "TREE_REMOVED",
      "NODE_ADDED",
      "NODE_UPDATED",
      "NODE_REMOVED",
      "STATUS_CHANGED",
      "TREE_AGREED",
      "BET_SENT",
      "DRAFT_ACCEPTED",
    ],
    "tree_agreed",
  ],
  [
    "persona-library",
    PERSONA_LIBRARY_ACTIONS,
    ["PERSONA_CREATED", "PERSONA_UPDATED", "PERSONA_REMOVED", "PERSONA_DRAFTED"],
  ],
  [
    "product-metrics",
    PRODUCT_METRICS_ACTIONS,
    [
      "METRIC_ADDED",
      "METRIC_UPDATED",
      "METRIC_REMOVED",
      "READING_ADDED",
      "READING_REMOVED",
      "READINGS_IMPORTED",
      "FUNNEL_PERIOD_ADDED",
      "NORTH_STAR_SET",
      "METRICS_RESET",
    ],
    "north_star_set",
  ],
  [
    "ab-calculator",
    AB_CALCULATOR_ACTIONS,
    [
      "TEST_SAVED",
      "TEST_UPDATED",
      "TEST_REMOVED",
      "COUNTS_RECORDED",
      "DECISION_SET",
      "TESTS_RESET",
    ],
    "decision_set",
  ],
  [
    "ebm-dashboard",
    EBM_DASHBOARD_ACTIONS,
    [
      "MEASURE_ADDED",
      "MEASURE_UPDATED",
      "MEASURE_REMOVED",
      "READING_ADDED",
      "STRATEGIC_GOAL_SET",
      "REVIEW_RECORDED",
      "EBM_RESET",
    ],
    "review_recorded",
  ],
  [
    "flow-insights",
    FLOW_INSIGHTS_ACTIONS,
    ["WORK_TYPE_SET", "WORK_TYPES_SORTED", "TARGET_SPLIT_SET"],
  ],
  [
    "improve",
    IMPROVE_ACTIONS,
    [
      "ITEM_CREATED",
      "ITEM_UPDATED",
      "ITEM_REMOVED",
      "ITEM_CLOSED",
      "STEP_ADDED",
      "STEP_DONE",
      "STEP_SENT",
      "READING_LOGGED",
      "OBSTACLE_ADDED",
      "OBSTACLE_CLEARED",
      "OBSTACLE_SENT",
      "COACHING_DONE",
      "TARGET_REACHED",
    ],
    "target_reached",
  ],
  [
    "kickoff",
    KICKOFF_ACTIONS,
    [
      "KICKOFF_CREATED",
      "KICKOFF_UPDATED",
      "KICKOFF_REMOVED",
      "ITEM_ADDED",
      "ITEMS_DRAFTED",
      "ITEMS_COLLECTED",
      "SLIDERS_SET",
      "ITEM_SENT",
      "KICKOFF_AGREED",
    ],
    "kickoff_agreed",
  ],
  [
    "team-time",
    TEAM_TIME_ACTIONS,
    [
      "PERSON_SAVED",
      "PERSON_REMOVED",
      "POLL_CREATED",
      "POLL_ANSWERED",
      "SLOT_CHOSEN",
      "POLL_REMOVED",
      "ROTATION_SAVED",
      "ROTATION_REMOVED",
      "OCCURRENCE_HELD",
      "OCCURRENCE_SKIPPED",
      "TEAM_TIME_RESET",
    ],
    "slot_chosen",
  ],
];

/** Names phase 2 adds to existing tools' catalogs, with the ones that are milestones. */
const ADDED: [
  tool: string,
  actions: Record<string, string>,
  names: string[],
  milestone?: string,
][] = [
  [
    "planning-poker",
    PLANNING_POKER_ACTIONS,
    [
      "THREE_POINT_USED",
      "ASYNC_ROUND_CREATED",
      "ASYNC_REPLY_ADDED",
      "ASYNC_REVEALED",
      "ASYNC_CLOSED",
    ],
  ],
  [
    "release-readiness",
    RELEASE_READINESS_ACTIONS,
    ["STORIES_LINKED", "NOTES_DRAFTED", "NOTES_SAVED"],
  ],
  ["epic-roadmap", EPIC_ROADMAP_ACTIONS, ["HORIZON_CHANGED"]],
  [
    "hypothesis-tracker",
    HYPOTHESIS_ACTIONS,
    ["VALUE_CHECK_ADDED", "MEASURED_BY_SET", "AB_RESULT_USED"],
  ],
  [
    "kanban",
    KANBAN_ACTIONS,
    ["WORKFLOW_UPDATED", "WORKFLOW_VERSION_SAVED", "STATIK_STEP_SAVED", "BLOCK_NOTED"],
    "workflow_version_saved",
  ],
  ["impediments", IMPEDIMENT_ACTIONS, ["BLOCKERS_CLUSTERED", "CLUSTER_RAISED"]],
  [
    "pi-planning",
    PI_PLANNING_ACTIONS,
    ["RISK_ROAMED", "OBJECTIVE_SCORED", "CONFIDENCE_SAVED", "PI_CLOSED"],
    "pi_closed",
  ],
  ["root-cause", ROOT_CAUSE_ACTIONS, ["LOOP_NODE_ADDED", "LOOP_LINK_ADDED", "LOOP_NAMED"]],
  ["working-agreement", WORKING_AGREEMENT_ACTIONS, ["TEMPLATE_APPLIED"]],
  ["async-standup", ASYNC_STANDUP_ACTIONS, ["DIGEST_SUMMARISED"]],
];

const snake = (name: string) => name.toLowerCase();

describe("the tools plan's phase 2 history actions", () => {
  it.each(NEW_TOOLS)(
    "%s: holds exactly its names, each the snake case of its key",
    (_t, actions, names) => {
      expect(actions).toEqual(Object.fromEntries(names.map((n) => [n, snake(n)])));
    }
  );

  it.each(ADDED)("%s: gains its names, each the snake case of its key", (_t, actions, names) => {
    for (const n of names) expect(actions[n], n).toBe(snake(n));
  });

  it.each([...NEW_TOOLS, ...ADDED])("%s: each action is its own string", (_t, actions) => {
    const values = Object.values(actions);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each([...NEW_TOOLS, ...ADDED])(
    "%s: only its named milestone is a milestone",
    (tool, actions, names, milestone) => {
      for (const n of names) {
        const action = actions[n];
        expect(isMilestoneAction(tool, action), `${tool}:${action}`).toBe(action === milestone);
      }
    }
  );

  it("keeps the existing milestones of the tools it extends", () => {
    expect(isMilestoneAction("planning-poker", PLANNING_POKER_ACTIONS.ESTIMATE_COMMITTED)).toBe(
      true
    );
    expect(isMilestoneAction("kanban", KANBAN_ACTIONS.KANBAN_RESET)).toBe(true);
    expect(isMilestoneAction("pi-planning", PI_PLANNING_ACTIONS.PI_PLAN_COMMITTED)).toBe(true);
    expect(isMilestoneAction("root-cause", ROOT_CAUSE_ACTIONS.ROOT_CAUSE_FOUND)).toBe(true);
    expect(isMilestoneAction("hypothesis-tracker", HYPOTHESIS_ACTIONS.STATUS_CHANGED)).toBe(true);
  });

  it("documents each new name with a line saying its payload", () => {
    const catalog = readFileSync(join(process.cwd(), "src/lib/history/event-actions.ts"), "utf8");
    const exported = (actions: Record<string, string>) =>
      Object.entries(CATALOGS).find(([, c]) => c === actions)?.[0] ?? "";
    for (const [tool, actions, names] of [...NEW_TOOLS, ...ADDED]) {
      const name = exported(actions);
      const start = catalog.indexOf(`export const ${name} = {\n`);
      expect(start, `${tool}: ${name}`).toBeGreaterThan(-1);
      const lines = catalog.slice(start, catalog.indexOf("\n} as const;", start)).split("\n");
      for (const n of names) {
        const at = lines.findIndex((l) => l.startsWith(`  ${n}: "${snake(n)}",`));
        expect(at, `${tool}: ${n}`).toBeGreaterThan(0);
        expect(lines[at - 1], `${tool}: ${n}`).toMatch(/^ {2}\/\*\* \S.* \*\/$/);
      }
    }
  });

  it("logs a blocked spell's cluster as default or custom, never its words", () => {
    // A custom cluster is a label someone typed, so the payload says which
    // default it is (or that it is custom), as it never holds the cause.
    const lines = readFileSync(
      join(process.cwd(), "src/lib/history/event-actions.ts"),
      "utf8"
    ).split("\n");
    const at = lines.findIndex((l) => l.startsWith('  BLOCK_NOTED: "block_noted",'));
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toMatch(/default one \(and its index in DEFAULT_BLOCKER_CLUSTERS\)/);
    expect(lines[at - 1]).toMatch(/never the cluster's or the cause's text/);
  });
});
