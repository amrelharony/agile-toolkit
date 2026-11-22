/**
 * Per-tool action catalog. Imported at log call sites for autocomplete and
 * to keep action names DRY (used by the global /history page filter UI).
 *
 * Milestone actions carry an `is_milestone = true` flag in cloud rows. They
 * are also (in Phase 5) anchor points for restore-to-point replay.
 */

export const RETRO_ACTIONS = {
  CARD_ADDED: "card_added",
  CARD_EDITED: "card_edited",
  CARD_REMOVED: "card_removed",
  CARD_VOTED: "card_voted",
  /** A vote was taken back off a card. */
  CARD_UNVOTED: "card_unvoted",
  CARDS_GROUPED: "cards_grouped",
  CARDS_UNGROUPED: "cards_ungrouped",
  PHASE_ADVANCED: "phase_advanced", // milestone
  ACTION_ASSIGNED: "action_assigned",
  ACTION_TOGGLED: "action_toggled",
  RETRO_RESET: "retro_reset", // milestone
  FORMAT_CHANGED: "format_changed",
  /** The board's sprint was set or changed. */
  SPRINT_SET: "sprint_set",
  /** Kudos from the sprint were added as appreciation cards. */
  KUDOS_ADDED: "kudos_added",
  /** Lean Coffee: a topic went to Discussing with its timebox. */
  TOPIC_STARTED: "topic_started",
  /** Lean Coffee: the room kept going on a topic. */
  TOPIC_EXTENDED: "topic_extended",
  /** Lean Coffee: a topic was finished. */
  TOPIC_DONE: "topic_done",
  /** Lean Coffee: duplicate topics were merged under one. */
  TOPICS_MERGED: "topics_merged",
} as const;

export const VELOCITY_ACTIONS = {
  SPRINT_ADDED: "sprint_added",
  SPRINT_REMOVED: "sprint_removed",
  SPRINT_UPDATED: "sprint_updated",
  VELOCITY_RESET: "velocity_reset", // milestone
  SPRINT_CLOSED: "sprint_closed",
  NEXT_SPRINT_PLANNED: "next_sprint_planned",
} as const;

export const IMPEDIMENT_ACTIONS = {
  IMPEDIMENT_RAISED: "impediment_raised",
  IMPEDIMENT_UPDATED: "impediment_updated",
  IMPEDIMENT_RESOLVED: "impediment_resolved", // milestone
  IMPEDIMENT_REMOVED: "impediment_removed",
  IMPEDIMENT_STATUS_CHANGED: "impediment_status_changed",
  /** Payload: how many blockers, how many clusters and the source (ai or rules). */
  BLOCKERS_CLUSTERED: "blockers_clustered",
  /** A cluster of blockers was raised as one impediment. Payload: impedimentId and the cluster's size. */
  CLUSTER_RAISED: "cluster_raised",
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
  /** The host ran a Three-point check after Reveal. Payload: the expected size and the card it rounds up to. */
  THREE_POINT_USED: "three_point_used",
  /** Estimate without a meeting: a round was opened. Payload: roundId and its story count; counts only. */
  ASYNC_ROUND_CREATED: "async_round_created",
  /** Payload: roundId and the reply count; never a name, a card or a note. */
  ASYNC_REPLY_ADDED: "async_reply_added",
  /** Payload: roundId and its reply and story counts. */
  ASYNC_REVEALED: "async_revealed",
  /** Payload: roundId and how many of its stories got an estimate. */
  ASYNC_CLOSED: "async_closed",
} as const;

export const KUDOS_ACTIONS = {
  KUDOS_SENT: "kudos_sent", // milestone — append-only recognition card
  KUDOS_RECEIVED: "kudos_received", // viewer-side counterpart; XP attribution lives here
  KUDOS_REACTED: "kudos_reacted",
  KUDOS_REPLIED: "kudos_replied",
} as const;

// ── Time-series accumulators ─────────────────────────────────────────
export const BURNDOWN_ACTIONS = {
  DAY_LOGGED: "day_logged",
  DAY_REMOVED: "day_removed",
  CONFIG_UPDATED: "config_updated",
  SCOPE_CHANGED: "scope_changed",
  BURNDOWN_RESET: "burndown_reset", // milestone
  SOURCE_SWITCHED: "source_switched",
} as const;

export const BURNUP_ACTIONS = {
  DAY_LOGGED: "day_logged",
  DAY_REMOVED: "day_removed",
  CONFIG_UPDATED: "config_updated",
  SCOPE_CHANGED: "scope_changed",
  BURNUP_RESET: "burnup_reset", // milestone
  SOURCE_SWITCHED: "source_switched",
} as const;

export const CFD_ACTIONS = {
  SNAPSHOT_LOGGED: "snapshot_logged",
  COLUMN_ADDED: "column_added",
  COLUMN_REMOVED: "column_removed",
  CFD_RESET: "cfd_reset", // milestone
  SNAPSHOT_REMOVED: "snapshot_removed",
  SOURCE_SWITCHED: "source_switched",
} as const;

export const MOOD_ACTIONS = {
  MOOD_LOGGED: "mood_logged",
  MOOD_REMOVED: "mood_removed",
  MOOD_RESET: "mood_reset", // milestone
} as const;

export const NPS_CSAT_ACTIONS = {
  /** One response was added or deleted (the strings from before Phase 8). */
  SURVEY_ADDED: "survey_added",
  SURVEY_REMOVED: "survey_removed",
  SURVEY_RESET: "survey_reset", // milestone
  /** A response's tags or verbatim were edited. Payload: responseId, fields. */
  RESPONSE_UPDATED: "response_updated",
  /** A CSV or paste import saved its rows. Payload: added, skipped (duplicates). */
  RESPONSES_IMPORTED: "responses_imported",
} as const;

// ── Configuration registers ──────────────────────────────────────────
export const CAPACITY_ACTIONS = {
  MEMBER_ADDED: "member_added",
  MEMBER_REMOVED: "member_removed",
  MEMBER_UPDATED: "member_updated",
  CONFIG_UPDATED: "config_updated",
  /** A sprint's own plan started, from the last plan or empty. Payload: sprintId, started. */
  PLAN_STARTED: "plan_started",
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
  /** A vote round filled the draft. Payload: ballots, dimensions, source; never who voted what. */
  ROUND_SAVED: "round_saved",
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
  /** The Definition of Workflow changed. Payload: which part (work types, policies, WIP, pull, blockers or the SLE). */
  WORKFLOW_UPDATED: "workflow_updated",
  /** Payload: the version number. */
  WORKFLOW_VERSION_SAVED: "workflow_version_saved", // milestone
  /** Payload: the STATIK step saved. */
  STATIK_STEP_SAVED: "statik_step_saved",
  /** A blocked spell got a cluster or a side. Payload: cardId, cluster and side; never the cause's text. */
  BLOCK_NOTED: "block_noted",
} as const;

export const CYCLE_TIME_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  CYCLE_TIME_RESET: "cycle_time_reset", // milestone
  ITEMS_IMPORTED: "items_imported",
} as const;

export const VALUE_STREAM_ACTIONS = {
  STAGE_ADDED: "stage_added",
  STAGE_REMOVED: "stage_removed",
  STAGE_UPDATED: "stage_updated",
  VALUE_STREAM_RESET: "value_stream_reset", // milestone
  STAGE_MOVED: "stage_moved",
  FUTURE_STATE_STARTED: "future_state_started",
} as const;

export const PI_PLANNING_ACTIONS = {
  TEAM_ADDED: "team_added",
  TEAM_REMOVED: "team_removed",
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_ASSIGNED: "item_assigned",
  ITEM_UPDATED: "item_updated",
  PI_PLAN_COMMITTED: "pi_plan_committed", // milestone
  PI_RESET: "pi_reset", // milestone
  /** Payload: riskId and its ROAM status. */
  RISK_ROAMED: "risk_roamed",
  /** Payload: objectiveId, its planned and its actual business value. */
  OBJECTIVE_SCORED: "objective_scored",
  /** Payload: the vote count and the average. */
  CONFIDENCE_SAVED: "confidence_saved",
  /** Payload: the PI's predictability, as a whole percentage. */
  PI_CLOSED: "pi_closed", // milestone
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
  /** The risk happened and was raised as an impediment. Payload: riskId, impedimentId. */
  RISK_ESCALATED: "risk_escalated",
} as const;

export const PREMORTEM_ACTIONS = {
  CAUSE_ADDED: "cause_added",
  CAUSE_REMOVED: "cause_removed",
  PREVENTION_ADDED: "prevention_added",
  PREMORTEM_RESET: "premortem_reset", // milestone
  PREMORTEM_STARTED: "premortem_started",
  PHASE_ADVANCED: "phase_advanced",
  CAUSE_VOTED: "cause_voted",
  RISKS_SENT: "risks_sent", // milestone
} as const;

export const TECH_DEBT_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  ITEM_RESOLVED: "item_resolved", // milestone
  TECH_DEBT_RESET: "tech_debt_reset",
  /** The item went to the backlog as a story. Payload: itemId, storyId. */
  ITEM_SENT_TO_BACKLOG: "item_sent_to_backlog",
} as const;

// ── Outcomes + product discovery ─────────────────────────────────────
export const OKR_ACTIONS = {
  OBJECTIVE_ADDED: "objective_added",
  OBJECTIVE_REMOVED: "objective_removed",
  KEY_RESULT_ADDED: "key_result_added",
  KEY_RESULT_REMOVED: "key_result_removed",
  PROGRESS_UPDATED: "progress_updated",
  OKR_RESET: "okr_reset", // milestone
  /** The objective's text, owner or quarter was edited. Payload: okrId, fields. */
  OBJECTIVE_UPDATED: "objective_updated",
  /** A key result's title, baseline, target, direction or unit was edited. Payload: okrId, krId, fields. */
  KEY_RESULT_UPDATED: "key_result_updated",
  /** A dated check-in on a key result. Payload: okrId, krId, checkInId, date, value, confidence. */
  CHECK_IN_RECORDED: "check_in_recorded",
  CHECK_IN_REMOVED: "check_in_removed",
} as const;

export const OPPORTUNITY_TREE_ACTIONS = {
  NODE_ADDED: "node_added",
  NODE_REMOVED: "node_removed",
  NODE_UPDATED: "node_updated",
  TREE_RESET: "tree_reset", // milestone
  /** An opportunity was flagged, or unflagged, as its outcome's target. Payload: nodeId, on. */
  TARGET_CHANGED: "target_changed",
  /** An experiment went to the Hypothesis Tracker. Payload: nodeId, hypothesisId. */
  EXPERIMENT_SENT: "experiment_sent",
} as const;

export const HYPOTHESIS_ACTIONS = {
  HYPOTHESIS_ADDED: "hypothesis_added",
  HYPOTHESIS_UPDATED: "hypothesis_updated",
  HYPOTHESIS_REMOVED: "hypothesis_removed",
  STATUS_CHANGED: "status_changed", // milestone
  HYPOTHESIS_RESET: "hypothesis_reset",
  /** The measured result was recorded against the target. Payload: hypothesisId, actual. */
  RESULT_RECORDED: "result_recorded",
  /** The measured result was cleared, back to blank until measured. Payload: hypothesisId. */
  RESULT_CLEARED: "result_cleared",
  /** A shipped story or epic got a check that it delivered. Payload: hypothesisId and the shipped kind and id. */
  VALUE_CHECK_ADDED: "value_check_added",
  /** Payload: hypothesisId and the kind (metric, key-result or words). */
  MEASURED_BY_SET: "measured_by_set",
  /** An A/B test's result was recorded as the result. Payload: hypothesisId and testId. */
  AB_RESULT_USED: "ab_result_used",
} as const;

export const INTERVIEW_ACTIONS = {
  INTERVIEW_ADDED: "interview_added",
  INTERVIEW_REMOVED: "interview_removed",
  INSIGHT_ADDED: "insight_added",
  INTERVIEWS_RESET: "interviews_reset", // milestone
  /** The interview's date, participant or context was edited. Payload: interviewId, fields. */
  INTERVIEW_UPDATED: "interview_updated",
  /** A quote was deleted. Payload: interviewId, quoteId. */
  QUOTE_REMOVED: "quote_removed",
  /** A quote was raised as an opportunity on the tree. Payload: interviewId, quoteId, nodeId. */
  QUOTE_SENT: "quote_sent",
} as const;

export const PRIORITIZER_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  SCORE_UPDATED: "score_updated",
  /** Decide order saved the backlog's ranks. Payload: ranked (how many items got one). */
  ORDER_SAVED: "order_saved",
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
  RATING_SET: "rating_set",
} as const;

export const RELEASE_PLANNER_ACTIONS = {
  RELEASE_ADDED: "release_added",
  RELEASE_REMOVED: "release_removed",
  RELEASE_UPDATED: "release_updated",
  RELEASE_RESET: "release_reset", // milestone
} as const;

/** The Sprint Metrics hub: the shared sprints' lifecycle. Payloads carry `sprintId`. */
export const SPRINT_METRICS_ACTIONS = {
  SPRINT_CREATED: "sprint_created",
  SPRINT_CLOSED: "sprint_closed", // milestone
  SPRINT_REOPENED: "sprint_reopened",
} as const;

/** Retro Actions: following up what the team agreed. Payloads carry `cardId` and `boardId`. */
export const RETRO_ACTIONS_ACTIONS = {
  ACTION_DONE: "action_done",
  ACTION_REOPENED: "action_reopened",
  ACTION_CARRIED_OVER: "action_carried_over",
  ACTION_ADDED: "action_added",
  ACTION_EDITED: "action_edited",
} as const;

/** Sprint Planning: the plan for a sprint. Payloads carry `sprintId`. */
export const SPRINT_PLANNING_ACTIONS = {
  STORY_ADDED: "story_added",
  /** A story deleted from the backlog or from a sprint that hasn't started. */
  STORY_DELETED: "story_deleted",
  STORIES_IMPORTED: "stories_imported",
  /** A pasted list added as stories, one per line. Payload: `count`, `intoSprint`. */
  STORIES_PASTED: "stories_pasted",
  /**
   * A Jira Cloud CSV export imported as backlog stories. Payload: `added`
   * (new stories), `updated` (stories already here whose points changed).
   */
  JIRA_IMPORTED: "jira_imported",
  FILLED_TO_CAPACITY: "filled_to_capacity",
  /** A closed sprint's unfinished stories moved into this sprint. */
  STORIES_CARRIED_OVER: "stories_carried_over",
  /** A closed sprint's unfinished stories sent back to the backlog. */
  STORIES_RETURNED: "stories_returned",
  /**
   * A retro action or an open impediment added to the sprint as a story.
   * Payload: `storyId`, `from` ("retro" or "impediments"), `sourceId`.
   */
  IMPROVEMENT_ADDED: "improvement_added",
  /** The sprint's interrupt buffer set or cleared while planning. Payload: sprintId, pct, points. */
  BUFFER_SET: "buffer_set",
  SPRINT_COMMITTED: "sprint_committed", // milestone
} as const;

/** The Sprint Cockpit: the current sprint's day-to-day. Payloads carry `sprintId`. */
export const SPRINT_COCKPIT_ACTIONS = {
  SPRINT_CREATED: "sprint_created",
  DAY_LOGGED: "day_logged",
  SPRINT_CLOSED: "sprint_closed", // milestone
} as const;

export const EPIC_ROADMAP_ACTIONS = {
  EPIC_ADDED: "epic_added",
  EPIC_REMOVED: "epic_removed",
  EPIC_UPDATED: "epic_updated",
  ROADMAP_RESET: "roadmap_reset", // milestone
  /** An epic moved on the Now, Next, Later board. Payload: epicId and its horizon, or none when set back to its quarters. */
  HORIZON_CHANGED: "horizon_changed",
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
  TIMER_STARTED: "timer_started",
  USE_RECORDED: "use_recorded",
  USE_REMOVED: "use_removed",
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
  THRESHOLDS_UPDATED: "thresholds_updated",
} as const;

export const DEPENDENCY_MAP_ACTIONS = {
  NODE_ADDED: "node_added",
  NODE_REMOVED: "node_removed",
  EDGE_ADDED: "edge_added",
  EDGE_REMOVED: "edge_removed",
  MAP_RESET: "map_reset", // milestone
} as const;

// ── Phase 12-14: Engineering Excellence ──────────────────────────────
export const DORA_ACTIONS = {
  SAMPLE_LOGGED: "sample_logged",
  SAMPLE_REMOVED: "sample_removed",
  TARGET_UPDATED: "target_updated",
  DORA_RESET: "dora_reset", // milestone
  SAMPLE_UPDATED: "sample_updated",
  SAMPLE_DERIVED: "sample_derived",
} as const;

export const SPACE_ACTIONS = {
  SCORE_LOGGED: "score_logged",
  SCORE_REMOVED: "score_removed",
  SPACE_RESET: "space_reset", // milestone
} as const;

export const DEVEX_ACTIONS = {
  RESPONSE_LOGGED: "response_logged",
  RESPONSE_REMOVED: "response_removed",
  DEVEX_RESET: "devex_reset", // milestone
} as const;

export const SLO_ACTIONS = {
  SLO_ADDED: "slo_added",
  SLO_REMOVED: "slo_removed",
  SLO_UPDATED: "slo_updated",
  BURN_LOGGED: "burn_logged",
  SLO_RESET: "slo_reset", // milestone
} as const;

export const PLATFORM_MATURITY_ACTIONS = {
  ASSESSMENT_SAVED: "assessment_saved", // milestone
  RATING_CHANGED: "rating_changed",
  PLATFORM_RESET: "platform_reset",
} as const;

// ── Phase 12-14: Incidents & Reliability ─────────────────────────────
export const INCIDENT_ACTIONS = {
  INCIDENT_OPENED: "incident_opened", // milestone
  INCIDENT_UPDATED: "incident_updated",
  INCIDENT_RESOLVED: "incident_resolved", // milestone
  ROLE_ASSIGNED: "role_assigned",
  TIMELINE_LOGGED: "timeline_logged",
  INCIDENT_RESET: "incident_reset",
} as const;

export const POST_MORTEM_ACTIONS = {
  POSTMORTEM_ADDED: "postmortem_added",
  POSTMORTEM_UPDATED: "postmortem_updated",
  POSTMORTEM_REMOVED: "postmortem_removed",
  ACTION_ADDED: "action_added",
  ACTION_REMOVED: "action_removed",
  TIMELINE_ADDED: "timeline_added",
  POSTMORTEM_PUBLISHED: "postmortem_published", // milestone
  POSTMORTEM_RESET: "postmortem_reset",
} as const;

export const ONCALL_ACTIONS = {
  SHIFT_ADDED: "shift_added",
  SHIFT_REMOVED: "shift_removed",
  PAGE_LOGGED: "page_logged",
  PAGE_REMOVED: "page_removed",
  ONCALL_RESET: "oncall_reset", // milestone
} as const;

export const RELEASE_READINESS_ACTIONS = {
  RELEASE_ADDED: "release_added",
  GATE_TOGGLED: "gate_toggled",
  RELEASE_SHIPPED: "release_shipped", // milestone
  RELEASE_ROLLED_BACK: "release_rolled_back",
  RELEASE_REMOVED: "release_removed",
  READINESS_RESET: "readiness_reset",
  RELEASE_REOPENED: "release_reopened",
  RELEASE_UPDATED: "release_updated",
  GATES_CHANGED: "gates_changed",
  /** Shipped stories were linked to a release. Payload: releaseId and how many. */
  STORIES_LINKED: "stories_linked",
  /** Release notes were drafted. Payload: releaseId, the audience and the source (ai or template). */
  NOTES_DRAFTED: "notes_drafted",
  /** Payload: releaseId and the audience; never the text. */
  NOTES_SAVED: "notes_saved",
} as const;

export const RUNBOOK_SCORER_ACTIONS = {
  RUNBOOK_ADDED: "runbook_added",
  RUNBOOK_REMOVED: "runbook_removed",
  RUNBOOK_SCORED: "runbook_scored",
  RUNBOOK_RESET: "runbook_reset", // milestone
} as const;

// ── Phase 12-14: Security & Compliance ───────────────────────────────
export const THREAT_MODEL_ACTIONS = {
  THREAT_ADDED: "threat_added",
  THREAT_REMOVED: "threat_removed",
  THREAT_UPDATED: "threat_updated",
  MITIGATION_ADDED: "mitigation_added",
  THREAT_RESET: "threat_reset", // milestone
} as const;

export const VULN_ACTIONS = {
  VULN_ADDED: "vuln_added",
  VULN_REMOVED: "vuln_removed",
  VULN_RESOLVED: "vuln_resolved", // milestone
  VULN_UPDATED: "vuln_updated",
  VULN_RESET: "vuln_reset",
} as const;

export const CONTROL_MAP_ACTIONS = {
  CONTROL_ADDED: "control_added",
  CONTROL_REMOVED: "control_removed",
  CONTROL_UPDATED: "control_updated",
  EVIDENCE_ADDED: "evidence_added",
  CONTROL_RESET: "control_reset", // milestone
} as const;

export const A11Y_ACTIONS = {
  ISSUE_ADDED: "issue_added",
  ISSUE_REMOVED: "issue_removed",
  ISSUE_RESOLVED: "issue_resolved", // milestone
  ISSUE_UPDATED: "issue_updated",
  A11Y_RESET: "a11y_reset",
} as const;

// ── Phase 12-14: Quality Engineering ─────────────────────────────────
export const TEST_PYRAMID_ACTIONS = {
  COUNT_UPDATED: "count_updated",
  PYRAMID_RESET: "pyramid_reset", // milestone
  /** The counts were kept as a dated snapshot. Payload: snapshotId, takenOn. */
  SNAPSHOT_TAKEN: "snapshot_taken",
  SNAPSHOT_REMOVED: "snapshot_removed",
  /**
   * The minutes per layer, or the count / runtime weighting, changed.
   * Payload: runtime ({unit?, integration?, e2e?}), weighting.
   */
  RUNTIME_UPDATED: "runtime_updated",
} as const;

export const FLAKY_TEST_ACTIONS = {
  TEST_ADDED: "test_added",
  TEST_REMOVED: "test_removed",
  TEST_UPDATED: "test_updated",
  TEST_QUARANTINED: "test_quarantined", // milestone
  TEST_FIXED: "test_fixed", // milestone
  FLAKY_RESET: "flaky_reset",
} as const;

export const CODE_REVIEW_ACTIONS = {
  PR_LOGGED: "pr_logged",
  PR_REMOVED: "pr_removed",
  CODE_REVIEW_RESET: "code_review_reset", // milestone
  /** A logged pull request was edited in place. Payload: sampleId, fields. */
  PR_UPDATED: "pr_updated",
  /** A CSV import saved its rows. Payload: added, skipped. */
  PRS_IMPORTED: "prs_imported",
  /** The working-hours window was set or cleared. Payload: start, end (absent: cleared). */
  WORKING_WINDOW_CHANGED: "working_window_changed",
} as const;

export const QUALITY_COST_ACTIONS = {
  COST_UPDATED: "cost_updated",
  QUALITY_COST_RESET: "quality_cost_reset", // milestone
  /** A quarter's figures were saved to the history. Payload: periodId, period. */
  PERIOD_SAVED: "period_saved",
  PERIOD_REMOVED: "period_removed",
} as const;

// ── Phase 12-14: Workshops & Facilitation ────────────────────────────
export const WORKING_AGREEMENT_ACTIONS = {
  RULE_ADDED: "rule_added",
  RULE_REMOVED: "rule_removed",
  RULE_UPDATED: "rule_updated",
  CHARTER_PUBLISHED: "charter_published", // milestone
  CHARTER_RESET: "charter_reset",
  CHECK_IN_SAVED: "check_in_saved",
  CHECK_IN_REMOVED: "check_in_removed",
  /** Payload: the template's id (urgency-ladder, core-hours, focus-time or ai-use) and how many rules it wrote. */
  TEMPLATE_APPLIED: "template_applied",
} as const;

export const LIBERATING_STRUCTURES_ACTIONS = {
  STRUCTURE_VIEWED: "structure_viewed",
  STRUCTURE_FAVORITED: "structure_favorited",
  FILTER_CHANGED: "filter_changed",
  STEP_TIMER_STARTED: "step_timer_started",
  STEP_ADVANCED: "step_advanced",
} as const;

export const DESIGN_SPRINT_ACTIONS = {
  SPRINT_STARTED: "sprint_started", // milestone
  TASK_TOGGLED: "task_toggled",
  TASK_OWNER_ASSIGNED: "task_owner_assigned",
  ARTIFACT_LOGGED: "artifact_logged",
  SPRINT_COMPLETED: "sprint_completed", // milestone
  SPRINT_RESET: "sprint_reset",
  OUTPUT_ADDED: "output_added",
  OUTPUT_REMOVED: "output_removed",
  FINDING_SENT: "finding_sent",
} as const;

export const RISKIEST_ASSUMPTION_ACTIONS = {
  ASSUMPTION_ADDED: "assumption_added",
  ASSUMPTION_REMOVED: "assumption_removed",
  ASSUMPTION_UPDATED: "assumption_updated",
  TEST_GENERATED: "test_generated", // milestone
  CANVAS_RESET: "canvas_reset",
  /** "Test" made a linked hypothesis for the assumption. Payload: assumptionId, hypothesisId. */
  TEST_CREATED: "test_created",
} as const;

export const WARDLEY_ACTIONS = {
  COMPONENT_ADDED: "component_added",
  COMPONENT_REMOVED: "component_removed",
  COMPONENT_MOVED: "component_moved",
  LINK_ADDED: "link_added",
  LINK_REMOVED: "link_removed",
  WARDLEY_RESET: "wardley_reset", // milestone
} as const;

// ── Phase 12-14: Additions to existing categories ────────────────────
export const JTBD_ACTIONS = {
  JOB_STORY_ADDED: "job_story_added",
  JOB_STORY_REMOVED: "job_story_removed",
  JOB_STORY_UPDATED: "job_story_updated",
  JTBD_RESET: "jtbd_reset", // milestone
} as const;

export const ASYNC_STANDUP_ACTIONS = {
  UPDATE_POSTED: "update_posted",
  UPDATE_REMOVED: "update_removed",
  DIGEST_GENERATED: "digest_generated", // milestone
  ASYNC_STANDUP_RESET: "async_standup_reset",
  /** The daily digest was summarised. Payload: the day and the source (ai or rules). */
  DIGEST_SUMMARISED: "digest_summarised",
} as const;

export const ONE_ON_ONE_ACTIONS = {
  MEETING_LOGGED: "meeting_logged",
  MEETING_REMOVED: "meeting_removed",
  AGENDA_ITEM_ADDED: "agenda_item_added",
  ACTION_TOGGLED: "action_toggled",
  ONE_ON_ONE_RESET: "one_on_one_reset", // milestone
} as const;

export const PSYCH_SAFETY_ACTIONS = {
  /**
   * A round was saved. Payload: roundId, responses; never who answered, or
   * what. Rows from before rounds hold one answer sheet's responseId and
   * scores instead.
   */
  ASSESSMENT_SAVED: "assessment_saved", // milestone
  /**
   * An answer sheet from before rounds was added (payload: responseId,
   * respondent, description) or removed (responseId, removed: true). The
   * added row shares its responseId with that sheet's ASSESSMENT_SAVED row,
   * so the two read together name whose scores they were. No longer written
   * (a round keeps counts only); kept so older history rows still read.
   */
  RESPONSE_LOGGED: "response_logged",
  /** A round was deleted. Payload: roundId. */
  ROUND_REMOVED: "round_removed",
  PSYCH_SAFETY_RESET: "psych_safety_reset",
} as const;

export const TECH_RADAR_ACTIONS = {
  BLIP_ADDED: "blip_added",
  BLIP_REMOVED: "blip_removed",
  BLIP_MOVED: "blip_moved", // milestone
  RADAR_RESET: "radar_reset",
} as const;

export const ONBOARDING_TRACKER_ACTIONS = {
  PERSON_ADDED: "person_added",
  PERSON_REMOVED: "person_removed",
  MILESTONE_LOGGED: "milestone_logged", // milestone
  // BUG-T5-onboarding-tracker-2: emit on un-complete too so the audit
  // trail captures rollback events. Without this, a manager cannot
  // tell "Jane's first PR was marked complete then uncompleted on
  // May 22" from "Jane never marked it complete".
  MILESTONE_UNCOMPLETED: "milestone_uncompleted",
  ONBOARDING_RESET: "onboarding_reset",
} as const;

export const RFC_TRACKER_ACTIONS = {
  RFC_ADDED: "rfc_added",
  RFC_REMOVED: "rfc_removed",
  RFC_UPDATED: "rfc_updated",
  RFC_DECIDED: "rfc_decided", // milestone
  RFC_RESET: "rfc_reset",
} as const;

export const STAKEHOLDER_MAP_ACTIONS = {
  STAKEHOLDER_ADDED: "stakeholder_added",
  STAKEHOLDER_REMOVED: "stakeholder_removed",
  STAKEHOLDER_UPDATED: "stakeholder_updated",
  STAKEHOLDER_RESET: "stakeholder_reset", // milestone
} as const;

export const ADKAR_ACTIONS = {
  INITIATIVE_ADDED: "initiative_added",
  INITIATIVE_REMOVED: "initiative_removed",
  STAGE_ADVANCED: "stage_advanced", // milestone
  STAGE_STEPPED_BACK: "stage_stepped_back",
  ADKAR_RESET: "adkar_reset",
} as const;

export const FEATURE_FLAG_ACTIONS = {
  FLAG_ADDED: "flag_added",
  FLAG_REMOVED: "flag_removed",
  FLAG_UPDATED: "flag_updated",
  FLAG_RETIRED: "flag_retired", // milestone
  FEATURE_FLAG_RESET: "feature_flag_reset",
  FLAG_STATUS_CHANGED: "flag_status_changed",
} as const;

// ════════════════════════════════════════════════════════════════════
// Phase 19 — AI / LLM Product Management
// ════════════════════════════════════════════════════════════════════
export const LLM_EVAL_ACTIONS = {
  EVAL_LOGGED: "eval_logged",
  EVAL_REMOVED: "eval_removed",
  REGRESSION_ACKED: "regression_acked", // milestone
  EVAL_RESET: "eval_reset",
} as const;

export const PROMPT_REGISTRY_ACTIONS = {
  PROMPT_DRAFTED: "prompt_drafted",
  PROMPT_PUBLISHED: "prompt_published", // milestone
  PROMPT_DEPRECATED: "prompt_deprecated",
  PROMPT_REMOVED: "prompt_removed",
  REGISTRY_RESET: "registry_reset",
} as const;

export const AI_FEATURE_SPEC_ACTIONS = {
  SECTION_UPDATED: "section_updated",
  SPEC_PUBLISHED: "spec_published", // milestone
  SPEC_RESET: "spec_reset",
} as const;

export const HALLUCINATION_ACTIONS = {
  HALLUCINATION_LOGGED: "hallucination_logged",
  HALLUCINATION_RESOLVED: "hallucination_resolved", // milestone
  HALLUCINATION_REMOVED: "hallucination_removed",
  HALLUCINATION_RESET: "hallucination_reset",
} as const;

export const TOKEN_COST_ACTIONS = {
  SPEND_LOGGED: "spend_logged",
  SPEND_REMOVED: "spend_removed",
  BUDGET_UPDATED: "budget_updated",
  COST_RESET: "cost_reset",
} as const;

export const MODEL_COMPARISON_ACTIONS = {
  MODEL_ADDED: "model_added",
  MODEL_REMOVED: "model_removed",
  MODEL_UPDATED: "model_updated",
  MODEL_COMPARISON_RESET: "model_comparison_reset",
} as const;

export const AI_SAFETY_ACTIONS = {
  ITEM_TOGGLED: "item_toggled",
  REVIEW_COMPLETED: "review_completed", // milestone
  SAFETY_RESET: "safety_reset",
} as const;

export const MODEL_MIGRATION_ACTIONS = {
  STEP_ADDED: "step_added",
  STEP_TOGGLED: "step_toggled",
  MIGRATION_COMPLETED: "migration_completed", // milestone
  MIGRATION_RESET: "migration_reset",
} as const;

export const AGENTIC_WORKFLOW_ACTIONS = {
  WORKFLOW_ADDED: "workflow_added",
  WORKFLOW_REMOVED: "workflow_removed",
  NODE_ADDED: "node_added",
  NODE_REMOVED: "node_removed",
  NODE_UPDATED: "node_updated",
  WORKFLOW_RESET: "workflow_reset",
} as const;

export const AI_RED_TEAM_ACTIONS = {
  FINDING_LOGGED: "finding_logged",
  FINDING_RESOLVED: "finding_resolved", // milestone
  FINDING_REMOVED: "finding_removed",
  RED_TEAM_RESET: "red_team_reset",
} as const;

export const HITL_ACTIONS = {
  REVIEW_LOGGED: "review_logged",
  REVIEW_REMOVED: "review_removed",
  HITL_RESET: "hitl_reset",
} as const;

export const RLHF_ACTIONS = {
  PAIR_LOGGED: "pair_logged",
  PAIR_REMOVED: "pair_removed",
  RLHF_RESET: "rlhf_reset",
} as const;

export const VECTOR_INVENTORY_ACTIONS = {
  COLLECTION_ADDED: "collection_added",
  COLLECTION_REMOVED: "collection_removed",
  COLLECTION_UPDATED: "collection_updated",
  INVENTORY_RESET: "inventory_reset",
} as const;

export const MODEL_CARD_ACTIONS = {
  CARD_SAVED: "card_saved", // milestone
  CARD_REMOVED: "card_removed",
  CARD_RESET: "card_reset",
} as const;

// ════════════════════════════════════════════════════════════════════
// Phase 20 — Prioritization Frameworks
// ════════════════════════════════════════════════════════════════════
export const RICE_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  RICE_RESET: "rice_reset",
} as const;

export const ICE_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  ICE_RESET: "ice_reset",
} as const;

export const MOSCOW_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  BUCKET_CHANGED: "bucket_changed",
  MOSCOW_RESET: "moscow_reset",
} as const;

export const KANO_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  KANO_RESET: "kano_reset",
} as const;

export const WSJF_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  WSJF_RESET: "wsjf_reset",
} as const;

export const COD_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  COD_RESET: "cod_reset",
} as const;

export const VALUE_EFFORT_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_UPDATED: "item_updated",
  MATRIX_RESET: "matrix_reset",
} as const;

export const BUY_FEATURE_ACTIONS = {
  FEATURE_ADDED: "feature_added",
  FEATURE_REMOVED: "feature_removed",
  PURCHASE_RECORDED: "purchase_recorded",
  /**
   * A round of splits was saved and spent. Payload: ballots, spent,
   * refunded, funded (counts only); never who gave what. Rounds saved
   * before it logged PURCHASE_RECORDED with `round: true`.
   */
  ROUND_SAVED: "round_saved",
  GAME_RESET: "game_reset", // milestone
} as const;

export const HUNDRED_DOLLAR_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ALLOCATION_CHANGED: "allocation_changed",
  /**
   * A team round was saved. Payload: ballots, items, source (counts only);
   * never anyone's split. Rounds saved before it logged ALLOCATION_CHANGED
   * with `round: true`.
   */
  ROUND_SAVED: "round_saved",
  TEST_RESET: "test_reset", // milestone
} as const;

export const EISENHOWER_ACTIONS = {
  TASK_ADDED: "task_added",
  TASK_REMOVED: "task_removed",
  /** An edit that put the task in another pane (or sorted it). */
  TASK_MOVED: "task_moved",
  /** An edit that left the task in its pane. Before it, every edit logged TASK_MOVED. */
  TASK_UPDATED: "task_updated",
  EISENHOWER_RESET: "eisenhower_reset",
} as const;

export const WALKING_SKELETON_ACTIONS = {
  STEP_ADDED: "step_added",
  STEP_REMOVED: "step_removed",
  STEP_TOGGLED: "step_toggled",
  STEP_UPDATED: "step_updated",
  STEP_MOVED: "step_moved",
  SKELETON_RESET: "skeleton_reset",
} as const;

// ════════════════════════════════════════════════════════════════════
// Phase 21 — Decision Frameworks
// ════════════════════════════════════════════════════════════════════
export const DACI_ACTIONS = {
  DECISION_ADDED: "decision_added",
  DECISION_REMOVED: "decision_removed",
  DECISION_UPDATED: "decision_updated",
  DECISION_DECIDED: "decision_decided", // milestone
  DACI_RESET: "daci_reset",
} as const;

export const RAPID_ACTIONS = {
  DECISION_ADDED: "decision_added",
  DECISION_REMOVED: "decision_removed",
  DECISION_UPDATED: "decision_updated",
  DECISION_DECIDED: "decision_decided", // milestone
  RAPID_RESET: "rapid_reset",
} as const;

export const WEIGHTED_DECISION_ACTIONS = {
  CRITERION_ADDED: "criterion_added",
  CRITERION_REMOVED: "criterion_removed",
  OPTION_ADDED: "option_added",
  OPTION_REMOVED: "option_removed",
  SCORE_CHANGED: "score_changed",
  /** A matrix was added or deleted. Payload: matrixId, name. */
  MATRIX_ADDED: "matrix_added",
  MATRIX_REMOVED: "matrix_removed",
  WEIGHTED_RESET: "weighted_reset",
} as const;

export const SIX_HATS_ACTIONS = {
  THOUGHT_ADDED: "thought_added",
  THOUGHT_REMOVED: "thought_removed",
  HAT_CHANGED: "hat_changed",
  SIX_HATS_RESET: "six_hats_reset",
  SESSION_STARTED: "session_started",
  ROUND_ADVANCED: "round_advanced",
  SUMMARY_SAVED: "summary_saved",
  SESSION_CLOSED: "session_closed", // milestone
  SESSION_REMOVED: "session_removed",
} as const;

export const OODA_ACTIONS = {
  CYCLE_STARTED: "cycle_started",
  CYCLE_REMOVED: "cycle_removed",
  STAGE_UPDATED: "stage_updated",
  CYCLE_COMPLETED: "cycle_completed", // milestone
  OODA_RESET: "ooda_reset",
} as const;

export const CYNEFIN_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_RECLASSIFIED: "item_reclassified",
  CYNEFIN_RESET: "cynefin_reset",
} as const;

export const STACEY_ACTIONS = {
  ITEM_ADDED: "item_added",
  ITEM_REMOVED: "item_removed",
  ITEM_REPLOTTED: "item_replotted",
  STACEY_RESET: "stacey_reset",
} as const;

export const POLARITY_ACTIONS = {
  POLARITY_ADDED: "polarity_added",
  POLARITY_REMOVED: "polarity_removed",
  POLE_UPDATED: "pole_updated",
  POLARITY_RESET: "polarity_reset",
} as const;

// ════════════════════════════════════════════════════════════════════
// Phase 22 — Canvas (whiteboard)
// ════════════════════════════════════════════════════════════════════
export const CANVAS_ACTIONS = {
  BOARD_CREATED: "board_created", // milestone
  BOARD_RENAMED: "board_renamed",
  BOARD_DELETED: "board_deleted", // milestone
  OBJECT_ADDED: "object_added",
  OBJECT_REMOVED: "object_removed",
  OBJECT_UPDATED: "object_updated",
  OBJECTS_MOVED: "objects_moved",
  OBJECTS_PASTED: "objects_pasted",
  TEMPLATE_APPLIED: "template_applied", // milestone
  IMPORT_PERFORMED: "import_performed", // milestone
  EXPORT_PERFORMED: "export_performed",
  COMMENT_ADDED: "comment_added",
  COMMENT_RESOLVED: "comment_resolved",
  CANVAS_RESET: "canvas_reset", // milestone
} as const;

// ════════════════════════════════════════════════════════════════════
// Phase 42 — the tools plan's phase 1. Named ahead of the tools, so each
// builder logs these. Amr answers an action by its last word (applause for
// "resolved" or "finished", a nod for ordinary work, nothing for "removed"
// or "reset"), and a few shared names play a scene of their own
// (mascot/use-tool-reactions.ts ACTION_SCENES): timer_started is the timer.
// ════════════════════════════════════════════════════════════════════
export const PICKER_ACTIONS = {
  LIST_SAVED: "list_saved",
  LIST_REMOVED: "list_removed",
  /** A spin, a draw, a roll or a flip. Payload: the mode and the list's size, never the names. */
  PICK_RAN: "pick_ran",
  /** A standing role (facilitator, scribe) moved to its next person. */
  ROTATION_ADVANCED: "rotation_advanced",
  PICKER_RESET: "picker_reset",
} as const;

export const QUICK_VOTE_ACTIONS = {
  POLL_SAVED: "poll_saved",
  POLL_REMOVED: "poll_removed",
  ROUND_STARTED: "round_started",
  /** The totals were shown. Payload: format and counts only, never who voted what. */
  ROUND_REVEALED: "round_revealed",
  RESULT_SAVED: "result_saved",
  ROUND_RESET: "round_reset",
} as const;

export const AUDIENCE_WALL_ACTIONS = {
  WALL_OPENED: "wall_opened",
  /** Payload: the mode and the number of posts, never their text. */
  WALL_SAVED: "wall_saved",
  WALL_REMOVED: "wall_removed",
  /** The host accepted a grouping or merge (AI or by hand) after previewing it. */
  THEMES_ACCEPTED: "themes_accepted",
  /** Posts turned into backlog items. Payload: how many. */
  ITEMS_SENT: "items_sent",
  WALL_RESET: "wall_reset",
} as const;

export const PARKING_LOT_ACTIONS = {
  ITEM_PARKED: "item_parked",
  ITEM_UPDATED: "item_updated",
  ITEM_DISCUSSED: "item_discussed",
  /** Sent to the backlog, the Impediment Tracker or Retro Actions. Payload: route. */
  ITEM_SENT: "item_sent",
  ITEM_DROPPED: "item_dropped",
  ITEM_REMOVED: "item_removed",
  PARKING_LOT_RESET: "parking_lot_reset",
} as const;

export const FACILITATOR_TIMERS_ACTIONS = {
  /** Payload: which timer (pomodoro, break, crazy-8s, cost) and its length. */
  TIMER_STARTED: "timer_started",
  TIMER_PAUSED: "timer_paused",
  TIMER_FINISHED: "timer_finished",
  BREAK_STARTED: "break_started",
  SETTINGS_SAVED: "settings_saved",
} as const;

export const INTERRUPT_BUFFER_ACTIONS = {
  /** The sprint's buffer was set or changed. Payload: sprintId, pct, points. */
  BUFFER_SET: "buffer_set",
  INTERRUPT_LOGGED: "interrupt_logged",
  INTERRUPT_UPDATED: "interrupt_updated",
  INTERRUPT_RESOLVED: "interrupt_resolved",
  INTERRUPT_REMOVED: "interrupt_removed",
  INTERRUPT_SENT: "interrupt_sent",
  /** The buffer ran out and the team started its emergency procedure. */
  EMERGENCY_STARTED: "emergency_started", // milestone
} as const;

export const PRODUCT_GOAL_ACTIONS = {
  GOAL_CREATED: "goal_created",
  GOAL_UPDATED: "goal_updated",
  GOAL_ACHIEVED: "goal_achieved", // milestone
  GOAL_ABANDONED: "goal_abandoned",
  GOAL_REMOVED: "goal_removed",
} as const;

export const BACKLOG_HEALTH_ACTIONS = {
  /** The DEEP checks ran. Payload: the four scores and the number of flags. */
  SCAN_RAN: "scan_ran",
  STORY_UPDATED: "story_updated",
  STORY_SPLIT: "story_split",
  /** Given/When/Then lines were added to a story. Payload: storyId, how many. */
  CRITERIA_ADDED: "criteria_added",
  STORY_DROPPED: "story_dropped",
} as const;

export const ROOT_CAUSE_ACTIONS = {
  ANALYSIS_CREATED: "analysis_created",
  ANALYSIS_UPDATED: "analysis_updated",
  ANALYSIS_REMOVED: "analysis_removed",
  WHY_ADDED: "why_added",
  CAUSE_ADDED: "cause_added",
  ROOT_CAUSE_FOUND: "root_cause_found", // milestone
  /** The countermeasure went to Retro Actions. */
  COUNTERMEASURE_SENT: "countermeasure_sent",
  /** Payload: analysisId and the loop's node count. */
  LOOP_NODE_ADDED: "loop_node_added",
  /** Payload: analysisId, the polarity (same or opposite) and whether it has a delay. */
  LOOP_LINK_ADDED: "loop_link_added",
  /** Payload: analysisId and the loop's kind (reinforcing or balancing). */
  LOOP_NAMED: "loop_named",
} as const;

export const CARD_DECKS_ACTIONS = {
  CARD_DEALT: "card_dealt",
  DECK_SHUFFLED: "deck_shuffled",
  DECK_SAVED: "deck_saved",
  DECK_REMOVED: "deck_removed",
  CARD_STARRED: "card_starred",
} as const;

export const TEAM_MIXER_ACTIONS = {
  /** Payload: group count and size, the balance used, the round; never the names. */
  GROUPS_MIXED: "groups_mixed",
  MIX_SAVED: "mix_saved",
  RULE_ADDED: "rule_added",
  RULE_REMOVED: "rule_removed",
  MIXER_RESET: "mixer_reset",
} as const;

export const SM_NOTEBOOK_ACTIONS = {
  /** Payload: the note's id, tags and event, never its text. */
  NOTE_ADDED: "note_added",
  NOTE_UPDATED: "note_updated",
  NOTE_REMOVED: "note_removed",
  NOTE_SENT: "note_sent",
  /** A weekly summary was kept (written by hand or accepted from Amr). */
  SUMMARY_SAVED: "summary_saved",
} as const;

export const MEETING_AUDIT_ACTIONS = {
  MEETING_ADDED: "meeting_added",
  MEETING_UPDATED: "meeting_updated",
  MEETING_REMOVED: "meeting_removed",
  MEETING_RATED: "meeting_rated",
  /** Keep, change or drop. Payload: meetingId, verdict. */
  VERDICT_SET: "verdict_set",
  AUDIT_RESET: "audit_reset",
} as const;

// ── Phase 43 — the tools plan's phase 2 ─────────────────────────────
/** Example Mapping. Payloads hold ids and counts, never a rule's, an example's or a question's text. */
export const EXAMPLE_MAPPING_ACTIONS = {
  /** Payload: mapId, and the storyId when it maps a backlog story. */
  MAP_CREATED: "map_created",
  /** The title, story or timebox changed. Payload: mapId. */
  MAP_UPDATED: "map_updated",
  /** Payload: mapId. */
  MAP_REMOVED: "map_removed",
  /** Payload: mapId, ruleId and the map's rule count. */
  RULE_ADDED: "rule_added",
  /** Payload: mapId, ruleId, exampleId and whether it is written as Given, When, Then. */
  EXAMPLE_ADDED: "example_added",
  /** Payload: mapId and questionId; never the owner. */
  QUESTION_ADDED: "question_added",
  /** Payload: mapId, questionId and its new status (answered or dropped). */
  QUESTION_ANSWERED: "question_answered",
  /** Ready, split or not yet. Payload: mapId and the verdict. */
  VERDICT_SET: "verdict_set",
  /** The rules and examples went to the story. Payload: mapId, storyId and how many lines. */
  SENT_TO_STORY: "sent_to_story", // milestone
  /** A rule became a story of its own. Payload: mapId, ruleId and the new storyId. */
  SPLIT_BY_RULE: "split_by_rule",
} as const;

/** Relative Sizing. Counts only: no story titles and no names. */
export const RELATIVE_SIZING_ACTIONS = {
  /** Payload: boardId, its story count and its bucket count. */
  BOARD_CREATED: "board_created",
  /** Payload: boardId. */
  BOARD_REMOVED: "board_removed",
  /** A silent sort, a bucket round or a live round began. Payload: boardId, the mode and the story count. */
  ROUND_STARTED: "round_started",
  /** Payload: boardId, how many stories were placed and how many were outliers. */
  ROUND_SAVED: "round_saved",
  /** Save sizes wrote points to the stories. Payload: boardId and how many stories. */
  SIZES_APPLIED: "sizes_applied", // milestone
  /** The hardest stories were queued for Planning Poker. Payload: boardId and how many. */
  SENT_TO_POKER: "sent_to_poker",
} as const;

/** Bug Triage. Payloads hold ids, grid cells, routes and reasons, never a bug's text. */
export const BUG_TRIAGE_ACTIONS = {
  /** Payload: bugId, and the tool that sent it when another tool did. */
  BUG_LOGGED: "bug_logged",
  /** Placed on the grid. Payload: bugId, its severity and its priority. */
  BUG_TRIAGED: "bug_triaged",
  /** Payload: bugId. */
  BUG_UPDATED: "bug_updated",
  /** Fix now, next or later. Payload: bugId and the route (interrupt or backlog-story). */
  BUG_SENT: "bug_sent",
  /** Payload: bugId and the close reason. */
  BUG_CLOSED: "bug_closed",
  /** Payload: bugId. */
  BUG_REOPENED: "bug_reopened",
  /** Payload: bugId. */
  BUG_REMOVED: "bug_removed",
  /** No new bug is left untriaged. Payload: how many were triaged in the sitting. */
  TRIAGE_DONE: "triage_done", // milestone
} as const;

/** Hill Chart. Payloads hold ids and positions (0 to 100), never a scope's title or note. */
export const HILL_CHART_ACTIONS = {
  /** Payload: chartId, and the sprint or epic id it follows. */
  CHART_CREATED: "chart_created",
  /** Payload: chartId. */
  CHART_UPDATED: "chart_updated",
  /** Payload: chartId. */
  CHART_REMOVED: "chart_removed",
  /** Payload: chartId, scopeId and the linked story or epic id. */
  SCOPE_ADDED: "scope_added",
  /** Payload: chartId, scopeId and its position before and after. */
  SCOPE_MOVED: "scope_moved",
  /** Payload: chartId and scopeId. */
  SCOPE_REMOVED: "scope_removed",
  /** A stuck scope was raised as an impediment. Payload: chartId, scopeId and impedimentId. */
  SCOPE_RAISED: "scope_raised",
  /** The week's positions were saved. Payload: chartId, the scope count and how many moved. */
  CHECKED_IN: "checked_in",
  /** A scope reached the bottom of the hill. Payload: chartId and scopeId. */
  SCOPE_DONE: "scope_done", // milestone
} as const;

/** Test Sessions. Payloads hold ids, kinds and counts, never a charter's or a note's text, or the tester. */
export const TEST_SESSIONS_ACTIONS = {
  /** Payload: sessionId, the minutes, and the storyId when it tests one. */
  SESSION_PLANNED: "session_planned",
  /** Payload: sessionId. */
  SESSION_STARTED: "session_started",
  /** Payload: sessionId, the minutes it ran and its note count. */
  SESSION_ENDED: "session_ended",
  /** Payload: sessionId and the note's kind. */
  NOTE_ADDED: "note_added",
  /** The session's bugs went to Bug Triage. Payload: sessionId and how many. */
  BUGS_SENT: "bugs_sent",
  /** Payload: sessionId, the coverage and the time split. */
  SESSION_DEBRIEFED: "session_debriefed", // milestone
  /** Payload: sessionId. */
  SESSION_REMOVED: "session_removed",
} as const;

/** Notes to Actions. No payload carries the notes, an item's text, an owner or a quote. */
export const NOTES_TO_ACTIONS_ACTIONS = {
  /** Notes were pasted. Payload: noteId and the text's length. */
  NOTES_ADDED: "notes_added",
  /** Payload: noteId, the source (ai or rules) and how many items. */
  ITEMS_FOUND: "items_found",
  /** Payload: noteId and how many. */
  ITEMS_KEPT: "items_kept",
  /** Payload: noteId, the route and how many. */
  ITEMS_SENT: "items_sent",
  /** Payload: noteId, itemId and the item's kind. */
  ITEM_DROPPED: "item_dropped",
  /** Payload: noteId and itemId. */
  ITEM_ANSWERED: "item_answered",
  /** Every item was sent, dropped or answered. Payload: noteId and the counts by status. */
  NOTE_DONE: "note_done", // milestone
  /** The pasted text was cleared and the items kept. Payload: noteId. */
  NOTES_TEXT_FORGOTTEN: "notes_text_forgotten",
  /** Payload: noteId. */
  NOTES_REMOVED: "notes_removed",
} as const;

/** Product Canvas. Payloads hold ids, formats, sections, routes and counts, never a note's text or a requester. */
export const PRODUCT_CANVAS_ACTIONS = {
  /** Payload: canvasId and the format. */
  CANVAS_CREATED: "canvas_created",
  /** Payload: canvasId and the section changed. */
  CANVAS_UPDATED: "canvas_updated",
  /** Payload: canvasId and the format. */
  CANVAS_REMOVED: "canvas_removed",
  /** Drafted lines were added. Payload: canvasId, the source (ai or starter) and how many. */
  DRAFT_ACCEPTED: "draft_accepted",
  /** Payload: canvasId, the section and the route. */
  ITEM_SENT: "item_sent",
  /** An idea joined the inbox. Payload: canvasId and the idea's source kind. */
  IDEA_LOGGED: "idea_logged",
  /** Payload: the kept canvasId and how many were merged into it. */
  IDEAS_MERGED: "ideas_merged",
  /** Payload: canvasId and the idea's new status. */
  IDEA_TRIAGED: "idea_triaged",
  /** Payload: canvasId and the verdict. */
  CASE_DECIDED: "case_decided",
  /** A lean business case got a go. Payload: canvasId. */
  CASE_APPROVED: "case_approved", // milestone
  /** A pitch was bet on at the betting table. Payload: canvasId, the cycle and its weeks. */
  BET_PLACED: "bet_placed",
} as const;

/** Impact Map. Payloads hold ids, levels, routes and counts, never a node's text. */
export const IMPACT_MAP_ACTIONS = {
  /** Payload: mapId, and the productGoalId when it starts from one. */
  MAP_CREATED: "map_created",
  /** Payload: mapId. */
  MAP_UPDATED: "map_updated",
  /** Payload: mapId and its node count. */
  MAP_REMOVED: "map_removed",
  /** Payload: mapId, nodeId and its level (1 actor, 2 impact, 3 deliverable). */
  NODE_ADDED: "node_added",
  /** Payload: mapId and nodeId. */
  NODE_UPDATED: "node_updated",
  /** Payload: mapId, nodeId and how many nodes went with it. */
  NODE_REMOVED: "node_removed",
  /** The map's first focus impact was picked. Payload: mapId and nodeId. */
  FOCUS_SET: "focus_set", // milestone
  /** Payload: mapId and the new focus nodeId. */
  FOCUS_CHANGED: "focus_changed",
  /** Payload: mapId, nodeId and the route (backlog-story or epic). */
  DELIVERABLE_SENT: "deliverable_sent",
  /** An impact went to the Hypothesis Tracker. Payload: mapId and nodeId. */
  IMPACT_TESTED: "impact_tested",
  /** Payload: mapId, the source (ai or rules) and how many nodes. */
  DRAFT_ACCEPTED: "draft_accepted",
} as const;

/** Strategy Tree. Payloads hold ids, formats, levels, statuses and routes, never a node's text or owner. */
export const STRATEGY_TREE_ACTIONS = {
  /** Payload: treeId and the format (dibb, lean-value-tree or hoshin). */
  TREE_CREATED: "tree_created",
  /** Payload: treeId. */
  TREE_UPDATED: "tree_updated",
  /** Payload: treeId and the format. */
  TREE_REMOVED: "tree_removed",
  /** Payload: treeId, nodeId and its level. */
  NODE_ADDED: "node_added",
  /** Payload: treeId and nodeId. */
  NODE_UPDATED: "node_updated",
  /** Payload: treeId, nodeId and how many nodes went with it. */
  NODE_REMOVED: "node_removed",
  /** Payload: treeId, nodeId and the status. */
  STATUS_CHANGED: "status_changed",
  /** Every part is agreed or dropped. Payload: treeId and its node count. */
  TREE_AGREED: "tree_agreed", // milestone
  /** Payload: treeId, nodeId and the route (hypothesis or epic). */
  BET_SENT: "bet_sent",
  /** Payload: treeId and how many nodes. */
  DRAFT_ACCEPTED: "draft_accepted",
} as const;

/** Persona Library. Payloads hold ids, tiers and counts, never a persona's name or words. */
export const PERSONA_LIBRARY_ACTIONS = {
  /** Payload: personaId, its tier and how much is researched. */
  PERSONA_CREATED: "persona_created",
  /** Payload: personaId. */
  PERSONA_UPDATED: "persona_updated",
  /** Payload: personaId. */
  PERSONA_REMOVED: "persona_removed",
  /** A persona was drafted from interview notes. Payload: the source (ai or rules) and how many interviews. */
  PERSONA_DRAFTED: "persona_drafted",
} as const;

/** Product Metrics. Payloads hold ids, days, roles and counts. */
export const PRODUCT_METRICS_ACTIONS = {
  /** Payload: metricId and its role, HEART category or AARRR stage. */
  METRIC_ADDED: "metric_added",
  /** Payload: metricId. */
  METRIC_UPDATED: "metric_updated",
  /** Payload: metricId. */
  METRIC_REMOVED: "metric_removed",
  /** Payload: metricId and the day. */
  READING_ADDED: "reading_added",
  /** Payload: metricId and the day. */
  READING_REMOVED: "reading_removed",
  /** Readings were pasted. Payload: how many readings and how many metrics. */
  READINGS_IMPORTED: "readings_imported",
  /** A reading for every funnel stage on one day. Payload: the day and the stage count. */
  FUNNEL_PERIOD_ADDED: "funnel_period_added",
  /** Payload: metricId. */
  NORTH_STAR_SET: "north_star_set", // milestone
  /** Payload: how many metrics were removed. */
  METRICS_RESET: "metrics_reset",
} as const;

/** A/B Calculator. Payloads hold ids, sizes, days and verdicts. */
export const AB_CALCULATOR_ACTIONS = {
  /** Payload: testId, the people each version needs and the days planned. */
  TEST_SAVED: "test_saved",
  /** Payload: testId. */
  TEST_UPDATED: "test_updated",
  /** Payload: testId. */
  TEST_REMOVED: "test_removed",
  /** Visitors and conversions were typed. Payload: testId and whether the result is significant. */
  COUNTS_RECORDED: "counts_recorded",
  /** Ship, keep or rerun. Payload: testId and the decision. */
  DECISION_SET: "decision_set", // milestone
  /** Payload: how many tests were removed. */
  TESTS_RESET: "tests_reset",
} as const;

/** EBM Dashboard. Payloads hold ids, value areas, days and counts, never the goal's text. */
export const EBM_DASHBOARD_ACTIONS = {
  /** Payload: metricId, its key value area, and its source when read from the toolkit. */
  MEASURE_ADDED: "measure_added",
  /** Payload: metricId. */
  MEASURE_UPDATED: "measure_updated",
  /** Payload: metricId. */
  MEASURE_REMOVED: "measure_removed",
  /** Payload: metricId and the day. */
  READING_ADDED: "reading_added",
  /** Payload: whether the goal and its why are written. */
  STRATEGIC_GOAL_SET: "strategic_goal_set",
  /** Payload: reviewId, the area to focus on next and how many areas were measured. */
  REVIEW_RECORDED: "review_recorded", // milestone
  /** Payload: how many measures and reviews were removed. */
  EBM_RESET: "ebm_reset",
} as const;

/** Flow Insights. Payloads hold ids, types and counts. */
export const FLOW_INSIGHTS_ACTIONS = {
  /** Payload: the item's id, whether it is a story or a card, and its type. */
  WORK_TYPE_SET: "work_type_set",
  /** Several items were sorted at once. Payload: how many. */
  WORK_TYPES_SORTED: "work_types_sorted",
  /** Payload: the four target percentages, or none when cleared. */
  TARGET_SPLIT_SET: "target_split_set",
} as const;

/** Improve (an A3 or an Improvement Kata). Payloads hold ids, methods, days and routes, never the text. */
export const IMPROVE_ACTIONS = {
  /** Payload: itemId, its method (a3 or kata), and the analysisId when a Root Cause analysis started it. */
  ITEM_CREATED: "item_created",
  /** Payload: itemId. */
  ITEM_UPDATED: "item_updated",
  /** Payload: itemId and its method. */
  ITEM_REMOVED: "item_removed",
  /** Payload: itemId and the status (closed or dropped). */
  ITEM_CLOSED: "item_closed",
  /** A countermeasure or an experiment. Payload: itemId and stepId. */
  STEP_ADDED: "step_added",
  /** Payload: itemId and stepId. */
  STEP_DONE: "step_done",
  /** Payload: itemId, stepId and the route (retro-action or backlog-story). */
  STEP_SENT: "step_sent",
  /** Payload: itemId and the day. */
  READING_LOGGED: "reading_logged",
  /** Payload: itemId and obstacleId. */
  OBSTACLE_ADDED: "obstacle_added",
  /** Payload: itemId and obstacleId. */
  OBSTACLE_CLEARED: "obstacle_cleared",
  /** Payload: itemId, obstacleId and the route. */
  OBSTACLE_SENT: "obstacle_sent",
  /** A coaching talk was walked through. Payload: itemId and the next coaching day. */
  COACHING_DONE: "coaching_done",
  /** Payload: itemId and how many targets it has reached. */
  TARGET_REACHED: "target_reached", // milestone
} as const;

/** Kickoff. Payloads hold ids, formats, sections, routes and counts, never an item's text or a participant. */
export const KICKOFF_ACTIONS = {
  /** Payload: kickoffId and the format. */
  KICKOFF_CREATED: "kickoff_created",
  /** Payload: kickoffId. */
  KICKOFF_UPDATED: "kickoff_updated",
  /** Payload: kickoffId and the format. */
  KICKOFF_REMOVED: "kickoff_removed",
  /** Payload: kickoffId and the section. */
  ITEM_ADDED: "item_added",
  /** Payload: kickoffId, the source (ai or starter) and how many. */
  ITEMS_DRAFTED: "items_drafted",
  /** Answers from the room's phones were added. Payload: kickoffId, the section and how many. */
  ITEMS_COLLECTED: "items_collected",
  /** The trade-offs were put in order. Payload: kickoffId and the slider count. */
  SLIDERS_SET: "sliders_set",
  /** Payload: kickoffId, the section and the route. */
  ITEM_SENT: "item_sent",
  /** Payload: kickoffId, the format and the item count. */
  KICKOFF_AGREED: "kickoff_agreed", // milestone
} as const;

/** Team Time. Ids and counts only, never names or time zones. */
export const TEAM_TIME_ACTIONS = {
  /** Payload: personId and the people count. */
  PERSON_SAVED: "person_saved",
  /** Payload: personId. */
  PERSON_REMOVED: "person_removed",
  /** Payload: pollId, its slot count and the minutes. */
  POLL_CREATED: "poll_created",
  /** Payload: pollId and its answer count. */
  POLL_ANSWERED: "poll_answered",
  /** Payload: pollId and slotId. */
  SLOT_CHOSEN: "slot_chosen", // milestone
  /** Payload: pollId. */
  POLL_REMOVED: "poll_removed",
  /** Payload: rotationId, its option count and the mode. */
  ROTATION_SAVED: "rotation_saved",
  /** Payload: rotationId. */
  ROTATION_REMOVED: "rotation_removed",
  /** Payload: rotationId and optionId. */
  OCCURRENCE_HELD: "occurrence_held",
  /** Payload: rotationId. */
  OCCURRENCE_SKIPPED: "occurrence_skipped",
  /** Payload: how many people, polls and rotations were removed. */
  TEAM_TIME_RESET: "team_time_reset",
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
  `premortem:${PREMORTEM_ACTIONS.RISKS_SENT}`,
  `six-hats:${SIX_HATS_ACTIONS.SESSION_CLOSED}`,
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
  `sprint-metrics:${SPRINT_METRICS_ACTIONS.SPRINT_CLOSED}`,
  `sprint:${SPRINT_COCKPIT_ACTIONS.SPRINT_CLOSED}`,
  `sprint-planning:${SPRINT_PLANNING_ACTIONS.SPRINT_COMMITTED}`,
  `epic-roadmap:${EPIC_ROADMAP_ACTIONS.ROADMAP_RESET}`,
  `refinement:${REFINEMENT_ACTIONS.REFINEMENT_RESET}`,
  `story-mapper:${STORY_MAPPER_ACTIONS.STORY_MAP_RESET}`,
  `estimation-guide:${ESTIMATION_GUIDE_ACTIONS.GUIDE_RESET}`,
  `health-dashboard:${HEALTH_DASHBOARD_ACTIONS.SUMMARY_GENERATED}`,
  `dependency-map:${DEPENDENCY_MAP_ACTIONS.MAP_RESET}`,
  // Phase 12-14 — engineering excellence
  `dora-scorecard:${DORA_ACTIONS.DORA_RESET}`,
  `space-pulse:${SPACE_ACTIONS.SPACE_RESET}`,
  `devex-survey:${DEVEX_ACTIONS.DEVEX_RESET}`,
  `slo-builder:${SLO_ACTIONS.SLO_RESET}`,
  `platform-maturity:${PLATFORM_MATURITY_ACTIONS.ASSESSMENT_SAVED}`,
  // Phase 12-14 — incidents & reliability
  `incident-commander:${INCIDENT_ACTIONS.INCIDENT_OPENED}`,
  `incident-commander:${INCIDENT_ACTIONS.INCIDENT_RESOLVED}`,
  `post-mortem:${POST_MORTEM_ACTIONS.POSTMORTEM_PUBLISHED}`,
  `oncall-roster:${ONCALL_ACTIONS.ONCALL_RESET}`,
  `release-readiness:${RELEASE_READINESS_ACTIONS.RELEASE_SHIPPED}`,
  `runbook-scorer:${RUNBOOK_SCORER_ACTIONS.RUNBOOK_RESET}`,
  // Phase 13-14 — security & compliance
  `threat-model:${THREAT_MODEL_ACTIONS.THREAT_RESET}`,
  `vuln-burndown:${VULN_ACTIONS.VULN_RESOLVED}`,
  `control-map:${CONTROL_MAP_ACTIONS.CONTROL_RESET}`,
  `a11y-tracker:${A11Y_ACTIONS.ISSUE_RESOLVED}`,
  // Phase 13-14 — quality engineering
  `test-pyramid:${TEST_PYRAMID_ACTIONS.PYRAMID_RESET}`,
  `flaky-tests:${FLAKY_TEST_ACTIONS.TEST_QUARANTINED}`,
  `flaky-tests:${FLAKY_TEST_ACTIONS.TEST_FIXED}`,
  `code-review-metrics:${CODE_REVIEW_ACTIONS.CODE_REVIEW_RESET}`,
  `quality-cost:${QUALITY_COST_ACTIONS.QUALITY_COST_RESET}`,
  // Phase 12-14 — workshops & facilitation
  `working-agreement:${WORKING_AGREEMENT_ACTIONS.CHARTER_PUBLISHED}`,
  `design-sprint:${DESIGN_SPRINT_ACTIONS.SPRINT_STARTED}`,
  `design-sprint:${DESIGN_SPRINT_ACTIONS.SPRINT_COMPLETED}`,
  `riskiest-assumption:${RISKIEST_ASSUMPTION_ACTIONS.TEST_GENERATED}`,
  `wardley-map:${WARDLEY_ACTIONS.WARDLEY_RESET}`,
  // Phase 12-14 — additions to existing categories
  `jtbd-mapper:${JTBD_ACTIONS.JTBD_RESET}`,
  `async-standup:${ASYNC_STANDUP_ACTIONS.DIGEST_GENERATED}`,
  `one-on-one:${ONE_ON_ONE_ACTIONS.ONE_ON_ONE_RESET}`,
  `psych-safety:${PSYCH_SAFETY_ACTIONS.ASSESSMENT_SAVED}`,
  `tech-radar:${TECH_RADAR_ACTIONS.BLIP_MOVED}`,
  `onboarding-tracker:${ONBOARDING_TRACKER_ACTIONS.MILESTONE_LOGGED}`,
  `rfc-tracker:${RFC_TRACKER_ACTIONS.RFC_DECIDED}`,
  `stakeholder-map:${STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_RESET}`,
  `adkar:${ADKAR_ACTIONS.STAGE_ADVANCED}`,
  `feature-flag-tracker:${FEATURE_FLAG_ACTIONS.FLAG_RETIRED}`,
  // Phase 19 — AI / LLM PM
  `llm-eval-tracker:${LLM_EVAL_ACTIONS.REGRESSION_ACKED}`,
  `prompt-registry:${PROMPT_REGISTRY_ACTIONS.PROMPT_PUBLISHED}`,
  `ai-feature-spec:${AI_FEATURE_SPEC_ACTIONS.SPEC_PUBLISHED}`,
  `hallucination-log:${HALLUCINATION_ACTIONS.HALLUCINATION_RESOLVED}`,
  `ai-safety-checklist:${AI_SAFETY_ACTIONS.REVIEW_COMPLETED}`,
  `model-migration:${MODEL_MIGRATION_ACTIONS.MIGRATION_COMPLETED}`,
  `ai-red-team:${AI_RED_TEAM_ACTIONS.FINDING_RESOLVED}`,
  `model-card:${MODEL_CARD_ACTIONS.CARD_SAVED}`,
  // Phase 20 — Prioritization
  `buy-a-feature:${BUY_FEATURE_ACTIONS.GAME_RESET}`,
  `hundred-dollar-test:${HUNDRED_DOLLAR_ACTIONS.TEST_RESET}`,
  // Phase 21 — Decision Frameworks
  `daci:${DACI_ACTIONS.DECISION_DECIDED}`,
  `rapid-decision:${RAPID_ACTIONS.DECISION_DECIDED}`,
  `ooda-loop:${OODA_ACTIONS.CYCLE_COMPLETED}`,
  // Phase 22 — Canvas
  `canvas:${CANVAS_ACTIONS.BOARD_CREATED}`,
  `canvas:${CANVAS_ACTIONS.BOARD_DELETED}`,
  `canvas:${CANVAS_ACTIONS.TEMPLATE_APPLIED}`,
  `canvas:${CANVAS_ACTIONS.IMPORT_PERFORMED}`,
  `canvas:${CANVAS_ACTIONS.CANVAS_RESET}`,
  `kudos:${KUDOS_ACTIONS.KUDOS_SENT}`,
  // Phase 42 — the tools plan's phase 1
  `interrupt-buffer:${INTERRUPT_BUFFER_ACTIONS.EMERGENCY_STARTED}`,
  `product-goal:${PRODUCT_GOAL_ACTIONS.GOAL_ACHIEVED}`,
  `root-cause:${ROOT_CAUSE_ACTIONS.ROOT_CAUSE_FOUND}`,
  // Phase 43 — the tools plan's phase 2
  `example-mapping:${EXAMPLE_MAPPING_ACTIONS.SENT_TO_STORY}`,
  `relative-sizing:${RELATIVE_SIZING_ACTIONS.SIZES_APPLIED}`,
  `bug-triage:${BUG_TRIAGE_ACTIONS.TRIAGE_DONE}`,
  `hill-chart:${HILL_CHART_ACTIONS.SCOPE_DONE}`,
  `test-sessions:${TEST_SESSIONS_ACTIONS.SESSION_DEBRIEFED}`,
  `notes-to-actions:${NOTES_TO_ACTIONS_ACTIONS.NOTE_DONE}`,
  `product-canvas:${PRODUCT_CANVAS_ACTIONS.CASE_APPROVED}`,
  `impact-map:${IMPACT_MAP_ACTIONS.FOCUS_SET}`,
  `strategy-tree:${STRATEGY_TREE_ACTIONS.TREE_AGREED}`,
  `product-metrics:${PRODUCT_METRICS_ACTIONS.NORTH_STAR_SET}`,
  `ab-calculator:${AB_CALCULATOR_ACTIONS.DECISION_SET}`,
  `ebm-dashboard:${EBM_DASHBOARD_ACTIONS.REVIEW_RECORDED}`,
  `improve:${IMPROVE_ACTIONS.TARGET_REACHED}`,
  `kickoff:${KICKOFF_ACTIONS.KICKOFF_AGREED}`,
  `team-time:${TEAM_TIME_ACTIONS.SLOT_CHOSEN}`,
  `kanban:${KANBAN_ACTIONS.WORKFLOW_VERSION_SAVED}`,
  `pi-planning:${PI_PLANNING_ACTIONS.PI_CLOSED}`,
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
