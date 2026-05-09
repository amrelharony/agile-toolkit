/**
 * Per-tool action catalog. Imported at log call sites for autocomplete and
 * to keep action names DRY (used by the global /history page filter UI).
 *
 * Milestone actions carry an `is_milestone = true` flag in cloud rows. They
 * are also (in Phase 5) anchor points for restore-to-point replay.
 */

export const RETRO_ACTIONS = {
  CARD_ADDED: "card_added",
  CARD_REMOVED: "card_removed",
  CARD_VOTED: "card_voted",
  CARDS_GROUPED: "cards_grouped",
  CARDS_UNGROUPED: "cards_ungrouped",
  PHASE_ADVANCED: "phase_advanced", // milestone
  ACTION_ASSIGNED: "action_assigned",
  ACTION_TOGGLED: "action_toggled",
  RETRO_RESET: "retro_reset", // milestone
  FORMAT_CHANGED: "format_changed",
} as const;

export const VELOCITY_ACTIONS = {
  SPRINT_ADDED: "sprint_added",
  SPRINT_REMOVED: "sprint_removed",
  SPRINT_UPDATED: "sprint_updated",
  VELOCITY_RESET: "velocity_reset", // milestone
} as const;

export const IMPEDIMENT_ACTIONS = {
  IMPEDIMENT_RAISED: "impediment_raised",
  IMPEDIMENT_UPDATED: "impediment_updated",
  IMPEDIMENT_RESOLVED: "impediment_resolved", // milestone
  IMPEDIMENT_REMOVED: "impediment_removed",
  IMPEDIMENT_STATUS_CHANGED: "impediment_status_changed",
} as const;

export const STANDUP_ACTIONS = {
  ENTRY_ADDED: "entry_added",
  ENTRY_REMOVED: "entry_removed",
  STANDUP_RESET: "standup_reset", // milestone
} as const;

export const PLANNING_POKER_ACTIONS = {
  VOTE_CAST: "vote_cast",
  VOTES_REVEALED: "votes_revealed", // milestone
  ESTIMATE_COMMITTED: "estimate_committed", // milestone
  ROUND_RESET: "round_reset",
  STORY_CHANGED: "story_changed",
} as const;

// ── Time-series accumulators ─────────────────────────────────────────
export const BURNDOWN_ACTIONS = {
  DAY_LOGGED: "day_logged",
  DAY_REMOVED: "day_removed",
  CONFIG_UPDATED: "config_updated",
  SCOPE_CHANGED: "scope_changed",
  BURNDOWN_RESET: "burndown_reset", // milestone
} as const;

export const BURNUP_ACTIONS = {
  DAY_LOGGED: "day_logged",
  DAY_REMOVED: "day_removed",
  CONFIG_UPDATED: "config_updated",
  SCOPE_CHANGED: "scope_changed",
  BURNUP_RESET: "burnup_reset", // milestone
} as const;

export const CFD_ACTIONS = {
  SNAPSHOT_LOGGED: "snapshot_logged",
  COLUMN_ADDED: "column_added",
  COLUMN_REMOVED: "column_removed",
  CFD_RESET: "cfd_reset", // milestone
} as const;

export const MOOD_ACTIONS = {
  MOOD_LOGGED: "mood_logged",
  MOOD_REMOVED: "mood_removed",
  MOOD_RESET: "mood_reset", // milestone
} as const;

export const NPS_CSAT_ACTIONS = {
  SURVEY_ADDED: "survey_added",
  SURVEY_REMOVED: "survey_removed",
  SURVEY_RESET: "survey_reset", // milestone
} as const;

// ── Configuration registers ──────────────────────────────────────────
export const CAPACITY_ACTIONS = {
  MEMBER_ADDED: "member_added",
  MEMBER_REMOVED: "member_removed",
  MEMBER_UPDATED: "member_updated",
  CAPACITY_RESET: "capacity_reset", // milestone
} as const;

export const RACI_ACTIONS = {
  ROLE_ADDED: "role_added",
  ROLE_REMOVED: "role_removed",
  ACTIVITY_ADDED: "activity_added",
  ACTIVITY_REMOVED: "activity_removed",
  ASSIGNMENT_CHANGED: "assignment_changed",
  RACI_RESET: "raci_reset", // milestone
} as const;

export const SKILLS_ACTIONS = {
  SKILL_ADDED: "skill_added",
  SKILL_REMOVED: "skill_removed",
  PERSON_ADDED: "person_added",
  PERSON_REMOVED: "person_removed",
  RATING_CHANGED: "rating_changed",
  SKILLS_RESET: "skills_reset", // milestone
} as const;

export const DECISION_ACTIONS = {
  DECISION_ADDED: "decision_added",
  DECISION_UPDATED: "decision_updated",
  DECISION_REMOVED: "decision_removed",
  STATUS_CHANGED: "status_changed", // milestone
  DECISION_RESET: "decision_reset",
} as const;

export const HEALTH_CHECK_ACTIONS = {
  CHECK_SAVED: "check_saved", // milestone
  CHECK_REMOVED: "check_removed",
  HEALTH_CHECK_RESET: "health_check_reset",
} as const;

export const MATURITY_ACTIONS = {
  ASSESSMENT_SAVED: "assessment_saved", // milestone
  RATING_CHANGED: "rating_changed",
  MATURITY_RESET: "maturity_reset",
} as const;

export const DOD_ACTIONS = {
  CRITERION_ADDED: "criterion_added",
  CRITERION_REMOVED: "criterion_removed",
  CRITERION_TOGGLED: "criterion_toggled",
  DOD_RESET: "dod_reset", // milestone
} as const;

// ── Workflow / kanban ────────────────────────────────────────────────
export const KANBAN_ACTIONS = {
  CARD_ADDED: "card_added",
  CARD_REMOVED: "card_removed",
  CARD_MOVED: "card_moved",
  CARD_UPDATED: "card_updated",
  COLUMN_ADDED: "column_added",
  COLUMN_REMOVED: "column_removed",
  KANBAN_RESET: "kanban_reset", // milestone
} as const;

export const CYCLE_TIME_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  CYCLE_TIME_RESET: "cycle_time_reset", // milestone
} as const;

export const VALUE_STREAM_ACTIONS = {
  STAGE_ADDED: "stage_added",
  STAGE_REMOVED: "stage_removed",
  STAGE_UPDATED: "stage_updated",
  VALUE_STREAM_RESET: "value_stream_reset", // milestone
} as const;

export const PI_PLANNING_ACTIONS = {
  TEAM_ADDED: "team_added",
  TEAM_REMOVED: "team_removed",
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_ASSIGNED: "item_assigned",
  PI_PLAN_COMMITTED: "pi_plan_committed", // milestone
  PI_RESET: "pi_reset", // milestone
} as const;

export const SCRUM_OF_SCRUMS_ACTIONS = {
  TEAM_UPDATE_ADDED: "team_update_added",
  TEAM_UPDATE_REMOVED: "team_update_removed",
  IMPEDIMENT_RAISED: "impediment_raised",
  SOS_RESET: "sos_reset", // milestone
} as const;

// ── Risk + governance ────────────────────────────────────────────────
export const RISK_ACTIONS = {
  RISK_ADDED: "risk_added",
  RISK_UPDATED: "risk_updated",
  RISK_REMOVED: "risk_removed",
  RISK_RESET: "risk_reset", // milestone
} as const;

export const PREMORTEM_ACTIONS = {
  CAUSE_ADDED: "cause_added",
  CAUSE_REMOVED: "cause_removed",
  PREVENTION_ADDED: "prevention_added",
  PREMORTEM_RESET: "premortem_reset", // milestone
} as const;

export const TECH_DEBT_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  ITEM_RESOLVED: "item_resolved", // milestone
  TECH_DEBT_RESET: "tech_debt_reset",
} as const;

// ── Outcomes + product discovery ─────────────────────────────────────
export const OKR_ACTIONS = {
  OBJECTIVE_ADDED: "objective_added",
  OBJECTIVE_REMOVED: "objective_removed",
  KEY_RESULT_ADDED: "key_result_added",
  KEY_RESULT_REMOVED: "key_result_removed",
  PROGRESS_UPDATED: "progress_updated",
  OKR_RESET: "okr_reset", // milestone
} as const;

export const OPPORTUNITY_TREE_ACTIONS = {
  NODE_ADDED: "node_added",
  NODE_REMOVED: "node_removed",
  NODE_UPDATED: "node_updated",
  TREE_RESET: "tree_reset", // milestone
} as const;

export const HYPOTHESIS_ACTIONS = {
  HYPOTHESIS_ADDED: "hypothesis_added",
  HYPOTHESIS_UPDATED: "hypothesis_updated",
  HYPOTHESIS_REMOVED: "hypothesis_removed",
  STATUS_CHANGED: "status_changed", // milestone
  HYPOTHESIS_RESET: "hypothesis_reset",
} as const;

export const INTERVIEW_ACTIONS = {
  INTERVIEW_ADDED: "interview_added",
  INTERVIEW_REMOVED: "interview_removed",
  INSIGHT_ADDED: "insight_added",
  INTERVIEWS_RESET: "interviews_reset", // milestone
} as const;

export const PRIORITIZER_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  SCORE_UPDATED: "score_updated",
  PRIORITIZER_RESET: "prioritizer_reset", // milestone
} as const;

// ── Sprint planning + delivery ───────────────────────────────────────
export const SPRINT_GOAL_ACTIONS = {
  GOAL_SAVED: "goal_saved", // milestone
  CRITERION_ADDED: "criterion_added",
  CRITERION_REMOVED: "criterion_removed",
  GOAL_RESET: "goal_reset",
} as const;

export const SPRINT_REVIEW_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  FEEDBACK_ADDED: "feedback_added",
  REVIEW_COMPLETED: "review_completed", // milestone
} as const;

export const SPRINT_COMPARE_ACTIONS = {
  SPRINT_PINNED: "sprint_pinned",
  SPRINT_UNPINNED: "sprint_unpinned",
  COMPARE_RESET: "compare_reset", // milestone
} as const;

export const RELEASE_PLANNER_ACTIONS = {
  RELEASE_ADDED: "release_added",
  RELEASE_REMOVED: "release_removed",
  RELEASE_UPDATED: "release_updated",
  RELEASE_RESET: "release_reset", // milestone
} as const;

export const EPIC_ROADMAP_ACTIONS = {
  EPIC_ADDED: "epic_added",
  EPIC_REMOVED: "epic_removed",
  EPIC_UPDATED: "epic_updated",
  ROADMAP_RESET: "roadmap_reset", // milestone
} as const;

export const REFINEMENT_ACTIONS = {
  STORY_ADDED: "story_added",
  STORY_REMOVED: "story_removed",
  STORY_UPDATED: "story_updated",
  REFINEMENT_RESET: "refinement_reset", // milestone
} as const;

export const STORY_MAPPER_ACTIONS = {
  SLICE_ADDED: "slice_added",
  SLICE_REMOVED: "slice_removed",
  STEP_ADDED: "step_added",
  STEP_REMOVED: "step_removed",
  CARD_ADDED: "card_added",
  CARD_REMOVED: "card_removed",
  CARD_MOVED: "card_moved",
  STORY_MAP_RESET: "story_map_reset", // milestone
} as const;

// ── Light / leaf tools ───────────────────────────────────────────────
export const CEREMONY_TIMER_ACTIONS = {
  TIMER_STARTED: "timer_started",
  TIMER_PAUSED: "timer_paused",
  TIMER_RESET: "timer_reset",
  PRESET_CHANGED: "preset_changed",
} as const;

export const ICEBREAKER_ACTIONS = {
  PROMPT_DRAWN: "prompt_drawn",
  PROMPT_FAVORITED: "prompt_favorited",
  CATEGORY_CHANGED: "category_changed",
} as const;

export const ESTIMATION_GUIDE_ACTIONS = {
  EXAMPLE_ADDED: "example_added",
  EXAMPLE_REMOVED: "example_removed",
  SCALE_CHANGED: "scale_changed",
  GUIDE_RESET: "guide_reset", // milestone
} as const;

export const HEALTH_DASHBOARD_ACTIONS = {
  DASHBOARD_REFRESHED: "dashboard_refreshed",
  SUMMARY_GENERATED: "summary_generated", // milestone
  SUMMARY_COPIED: "summary_copied",
} as const;

export const DEPENDENCY_MAP_ACTIONS = {
  NODE_ADDED: "node_added",
  NODE_REMOVED: "node_removed",
  EDGE_ADDED: "edge_added",
  EDGE_REMOVED: "edge_removed",
  MAP_RESET: "map_reset", // milestone
} as const;

/**
 * Set of (toolId, action) pairs that should be marked as milestones —
 * used by the logger to auto-flag without each call site having to know.
 */
const MILESTONE_PAIRS: ReadonlySet<string> = new Set([
  `retro:${RETRO_ACTIONS.PHASE_ADVANCED}`,
  `retro:${RETRO_ACTIONS.RETRO_RESET}`,
  `velocity:${VELOCITY_ACTIONS.VELOCITY_RESET}`,
  `impediments:${IMPEDIMENT_ACTIONS.IMPEDIMENT_RESOLVED}`,
  `standup:${STANDUP_ACTIONS.STANDUP_RESET}`,
  `planning-poker:${PLANNING_POKER_ACTIONS.VOTES_REVEALED}`,
  `planning-poker:${PLANNING_POKER_ACTIONS.ESTIMATE_COMMITTED}`,
  `burndown:${BURNDOWN_ACTIONS.BURNDOWN_RESET}`,
  `burnup:${BURNUP_ACTIONS.BURNUP_RESET}`,
  `cumulative-flow:${CFD_ACTIONS.CFD_RESET}`,
  `mood-tracker:${MOOD_ACTIONS.MOOD_RESET}`,
  `nps-csat:${NPS_CSAT_ACTIONS.SURVEY_RESET}`,
  `capacity-planner:${CAPACITY_ACTIONS.CAPACITY_RESET}`,
  `raci:${RACI_ACTIONS.RACI_RESET}`,
  `skills-matrix:${SKILLS_ACTIONS.SKILLS_RESET}`,
  `decision-log:${DECISION_ACTIONS.STATUS_CHANGED}`,
  `health-check:${HEALTH_CHECK_ACTIONS.CHECK_SAVED}`,
  `maturity:${MATURITY_ACTIONS.ASSESSMENT_SAVED}`,
  `dod-builder:${DOD_ACTIONS.DOD_RESET}`,
  `kanban:${KANBAN_ACTIONS.KANBAN_RESET}`,
  `cycle-time:${CYCLE_TIME_ACTIONS.CYCLE_TIME_RESET}`,
  `value-stream:${VALUE_STREAM_ACTIONS.VALUE_STREAM_RESET}`,
  `pi-planning:${PI_PLANNING_ACTIONS.PI_PLAN_COMMITTED}`,
  `pi-planning:${PI_PLANNING_ACTIONS.PI_RESET}`,
  `scrum-of-scrums:${SCRUM_OF_SCRUMS_ACTIONS.SOS_RESET}`,
  `risk-register:${RISK_ACTIONS.RISK_RESET}`,
  `premortem:${PREMORTEM_ACTIONS.PREMORTEM_RESET}`,
  `tech-debt:${TECH_DEBT_ACTIONS.ITEM_RESOLVED}`,
  `okrs:${OKR_ACTIONS.OKR_RESET}`,
  `opportunity-tree:${OPPORTUNITY_TREE_ACTIONS.TREE_RESET}`,
  `hypothesis-tracker:${HYPOTHESIS_ACTIONS.STATUS_CHANGED}`,
  `user-interviews:${INTERVIEW_ACTIONS.INTERVIEWS_RESET}`,
  `prioritizer:${PRIORITIZER_ACTIONS.PRIORITIZER_RESET}`,
  `sprint-goal:${SPRINT_GOAL_ACTIONS.GOAL_SAVED}`,
  `sprint-review:${SPRINT_REVIEW_ACTIONS.REVIEW_COMPLETED}`,
  `sprint-compare:${SPRINT_COMPARE_ACTIONS.COMPARE_RESET}`,
  `release-planner:${RELEASE_PLANNER_ACTIONS.RELEASE_RESET}`,
  `epic-roadmap:${EPIC_ROADMAP_ACTIONS.ROADMAP_RESET}`,
  `refinement:${REFINEMENT_ACTIONS.REFINEMENT_RESET}`,
  `story-mapper:${STORY_MAPPER_ACTIONS.STORY_MAP_RESET}`,
  `estimation-guide:${ESTIMATION_GUIDE_ACTIONS.GUIDE_RESET}`,
  `health-dashboard:${HEALTH_DASHBOARD_ACTIONS.SUMMARY_GENERATED}`,
  `dependency-map:${DEPENDENCY_MAP_ACTIONS.MAP_RESET}`,
]);

export function isMilestoneAction(toolId: string, action: string): boolean {
  return MILESTONE_PAIRS.has(`${toolId}:${action}`);
}

/**
 * Human-readable label for an action — used by the drawer/history page.
 * Fallback formats snake_case → Title Case.
 */
export function formatActionLabel(action: string): string {
  return action
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
