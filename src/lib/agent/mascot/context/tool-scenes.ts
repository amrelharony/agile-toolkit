/**
 * Amr in each tool: the scenes he greets you with when you open it, and the
 * scenes its key moments play.
 *
 * A tool's page is `/<toolId>` (src/lib/constants/tools.ts). Opening it gives a
 * once-a-day greeting with its first `open` scene, and its `open` scenes join his
 * idle pastimes while you're there (moments.ts). Its moments come from the
 * history log (each tool's actions in src/lib/history/event-actions.ts) and from
 * a few events nothing logs: a timer running out (`timer_finished`), a vote
 * round revealed (`round_revealed`), and the named events tools emit for sound
 * (src/lib/sonification/emit.ts, dashes read as underscores) listed in EMITTED.
 *
 * Most of these scenes come from the tool sheets (docs/mascot/context-sheets.json,
 * S65 on). A scene plays only once its sheet has been drawn and built into a pack
 * (shippedScene), so rows can name scenes before their art exists. Pure data.
 */

export interface ToolScenes {
  toolId: string;
  /** The greeting when the tool opens first, then his pastimes on its page. */
  open: readonly string[];
  /** Scenes by the tool's logged action or emitted event; one is picked at random. */
  actions: Readonly<Record<string, readonly string[]>>;
}

const STICKY = ["sticky", "sticky.think", "sticky.goofy"] as const;

/**
 * The emitted events Amr answers. Only these: most emitted sounds echo an action
 * the tool also logs, and he shouldn't react twice. The last two are the
 * celebrations a tool asks for (lib/celebrate/cheer.ts, CHEER_MOMENTS): a row
 * may give them a scene, but only for a tool whose cheer() call asks for that
 * one (its tests check); without a scene he cheers or dances.
 */
export const EMITTED: ReadonlySet<string> = new Set([
  "okr_achieved",
  "validated",
  "invalidated",
  "completed",
  "round_revealed",
  "amr_cheer",
  "amr_dance",
]);

/** Every tool Amr has scenes for. */
export const TOOL_SCENES: readonly ToolScenes[] = [
  // ── The tool sheets (S65–S114) ──
  // Plan the sprint
  {
    toolId: "capacity-planner",
    open: ["capacity", "capacity.count"],
    actions: { plan_started: ["capacity.plan"], member_added: ["capacity.add"] },
  },
  {
    toolId: "sprint-goal",
    open: ["goal", "goal.think"],
    actions: { goal_saved: ["goal.hit"], criterion_added: ["goal.think"] },
  },
  {
    toolId: "refinement",
    open: ["refine"],
    actions: { story_updated: ["refine.tick"], story_added: ["refine.read"] },
  },
  {
    toolId: "walking-skeleton",
    open: ["skeleton", "skeleton.wave"],
    actions: { step_added: ["skeleton.build"], step_toggled: ["skeleton.walk"] },
  },
  {
    toolId: "release-planner",
    open: ["forecast"],
    actions: { release_updated: ["forecast.roll"] },
  },
  {
    toolId: "pi-planning",
    // Nothing logs a finished plan: he admires the full board between moves.
    open: ["pi", "pi.done"],
    actions: { item_assigned: ["pi.place"], team_added: ["pi.team"] },
  },
  { toolId: "epic-roadmap", open: ["roadmap"], actions: { epic_added: ["roadmap.add"] } },
  {
    toolId: "scrum-of-scrums",
    open: ["radio"],
    actions: { team_update_added: ["radio.update"], impediment_raised: ["radio.alert"] },
  },
  {
    toolId: "dependency-map",
    open: ["links"],
    actions: { edge_added: ["links.connect"], node_added: ["links.pin"] },
  },
  // Run the sprint
  {
    toolId: "impediments",
    open: ["blocker"],
    actions: { impediment_raised: ["blocker.raised"], impediment_resolved: ["blocker.cleared"] },
  },
  {
    toolId: "sprint-review",
    // Nothing logs the review's end: his thank-you is a pastime on its page.
    open: ["demo", "demo.thanks"],
    actions: { feedback_added: ["demo.feedback"], item_added: ["demo.present"] },
  },
  // Retrospect and improve
  {
    toolId: "retro-actions",
    open: ["todo"],
    actions: { action_done: ["todo.done"], action_added: ["todo.take"] },
  },
  {
    toolId: "premortem",
    open: ["crystal"],
    actions: {
      cause_added: ["crystal.note"],
      risks_sent: ["crystal.send"],
      completed: ["crystal.ready"],
      timer_finished: ["crystal.ready"],
    },
  },
  {
    toolId: "six-hats",
    open: ["hats"],
    actions: {
      round_advanced: ["hats.round"],
      thought_added: ["hats.idea"],
      session_closed: ["hats.done"],
      timer_finished: ["hats.done"],
    },
  },
  {
    toolId: "canvas",
    open: ["canvas"],
    actions: { object_added: ["canvas.draw"], template_applied: ["canvas.tada"] },
  },
  // Track delivery
  { toolId: "burndown", open: ["burndown"], actions: { day_logged: ["burndown.log"] } },
  { toolId: "cumulative-flow", open: ["bands"], actions: { snapshot_logged: ["bands.snapshot"] } },
  {
    toolId: "cycle-time",
    open: ["cycle"],
    actions: { item_added: ["cycle.add"] },
  },
  {
    toolId: "dora-scorecard",
    open: ["dora"],
    actions: { sample_logged: ["dora.check"], sample_derived: ["dora.check"] },
  },
  {
    toolId: "value-stream",
    open: ["conveyor"],
    actions: { stage_added: ["conveyor.add"], future_state_started: ["conveyor.flow"] },
  },
  {
    toolId: "feature-flag-tracker",
    open: ["toggles"],
    actions: { flag_added: ["toggles.flip"], flag_retired: ["toggles.retire"] },
  },
  // Team and people
  {
    toolId: "health-check",
    open: ["health"],
    actions: { check_saved: ["health.care"], round_revealed: ["health.reveal"] },
  },
  {
    toolId: "psych-safety",
    open: ["shield"],
    actions: { assessment_saved: ["shield.thanks"], round_revealed: ["shield.together"] },
  },
  {
    toolId: "mood-tracker",
    open: ["mood"],
    actions: { mood_logged: ["mood.share"], round_revealed: ["mood.share"] },
  },
  {
    toolId: "working-agreement",
    open: ["charter"],
    actions: { rule_added: ["charter.write"], charter_published: ["charter.publish"] },
  },
  {
    toolId: "dod-builder",
    open: ["done"],
    actions: { criterion_toggled: ["done.stamp"], criterion_added: ["done.tick"] },
  },
  {
    toolId: "skills-matrix",
    open: ["skills"],
    actions: { skill_added: ["skills.add"], person_added: ["skills.teach"] },
  },
  {
    toolId: "raci",
    open: ["raci"],
    actions: { role_added: ["raci.deal"], assignment_changed: ["raci.place"] },
  },
  { toolId: "one-on-one", open: ["chat"], actions: { meeting_logged: ["chat.note"] } },
  {
    toolId: "stakeholder-map",
    open: ["stakeholders"],
    actions: { stakeholder_added: ["stakeholders.place"] },
  },
  {
    toolId: "adkar",
    open: ["adkar"],
    actions: { stage_advanced: ["adkar.step"], initiative_added: ["adkar.climb"] },
  },
  // Prioritize and decide
  {
    toolId: "prioritizer",
    open: ["rank"],
    actions: { score_updated: ["rank.weigh"], order_saved: ["rank.done"] },
  },
  {
    toolId: "wsjf",
    open: ["scale"],
    actions: { item_added: ["scale.weigh"], item_updated: ["scale.weigh"] },
  },
  {
    toolId: "moscow",
    open: ["moscow"],
    actions: { item_added: ["moscow.sort"], item_updated: ["moscow.sort"] },
  },
  {
    toolId: "cost-of-delay",
    open: ["hourglass"],
    actions: { item_added: ["hourglass.flip"], item_updated: ["hourglass.flip"] },
  },
  {
    toolId: "value-effort-matrix",
    open: ["effort"],
    actions: { item_added: ["effort.place"], item_updated: ["effort.place"] },
  },
  {
    toolId: "kano-model",
    open: ["kano"],
    actions: { item_added: ["kano.ask"], round_revealed: ["kano.reveal"] },
  },
  {
    toolId: "buy-a-feature",
    open: ["buy"],
    actions: {
      purchase_recorded: ["buy.pay"],
      round_saved: ["buy.bag"],
      round_revealed: ["buy.bag"],
    },
  },
  {
    toolId: "eisenhower",
    open: ["eisenhower"],
    actions: { task_added: ["eisenhower.card"], task_moved: ["eisenhower.sort"] },
  },
  {
    toolId: "decision-log",
    open: ["gavel"],
    actions: { decision_added: ["gavel.record"], status_changed: ["gavel.bang"] },
  },
  {
    toolId: "cynefin",
    open: ["compass"],
    actions: { item_added: ["compass.think"], item_reclassified: ["compass.point"] },
  },
  // Outcomes and discovery
  {
    toolId: "okrs",
    open: ["okr"],
    actions: { check_in_recorded: ["okr.checkin"], okr_achieved: ["okr.achieved"] },
  },
  {
    toolId: "nps-csat",
    open: ["nps"],
    actions: { responses_imported: ["nps.read"], survey_added: ["nps.card"] },
  },
  {
    toolId: "hypothesis-tracker",
    open: ["lab"],
    actions: { hypothesis_added: ["lab.pour"], validated: ["lab.yes"], invalidated: ["lab.no"] },
  },
  {
    toolId: "user-interviews",
    open: ["interview"],
    actions: { interview_added: ["interview.note"], quote_sent: ["interview.quote"] },
  },
  {
    toolId: "opportunity-tree",
    open: ["tree"],
    actions: { node_added: ["tree.grow"], experiment_sent: ["tree.share"] },
  },
  {
    toolId: "riskiest-assumption",
    open: ["assume"],
    actions: { assumption_added: ["assume.doubt"], test_created: ["assume.test"] },
  },
  // Quality and risk
  {
    toolId: "risk-register",
    open: ["risk"],
    actions: { risk_added: ["risk.log"], risk_escalated: ["risk.escalate"] },
  },
  {
    toolId: "tech-debt",
    open: ["debt"],
    actions: { item_added: ["debt.pile"], item_resolved: ["debt.clean"] },
  },
  {
    toolId: "flaky-tests",
    open: ["flaky"],
    actions: { test_added: ["flaky.wobble"], test_fixed: ["flaky.fixed"] },
  },

  // ── Tools that borrow a tool sheet's scenes ──
  { toolId: "burnup", open: ["burndown"], actions: { day_logged: ["burndown.log"] } },
  { toolId: "maturity", open: ["health"], actions: { assessment_saved: ["health.care"] } },
  {
    toolId: "rice-scoring",
    open: ["rank"],
    actions: { item_added: ["rank.weigh"], item_updated: ["rank.weigh"] },
  },
  {
    toolId: "ice-score",
    open: ["rank"],
    actions: { item_added: ["rank.weigh"], item_updated: ["rank.weigh"] },
  },
  {
    toolId: "hundred-dollar-test",
    open: ["buy"],
    actions: { round_saved: ["buy.bag"], round_revealed: ["buy.bag"] },
  },
  {
    toolId: "daci",
    open: ["gavel"],
    actions: { decision_added: ["gavel.record"], decision_decided: ["gavel.bang"] },
  },
  {
    toolId: "rapid-decision",
    open: ["gavel"],
    actions: { decision_added: ["gavel.record"], decision_decided: ["gavel.bang"] },
  },
  { toolId: "async-standup", open: [], actions: { update_posted: ["timer.standup"] } },

  // ── Tools with the toolkit moments (S54–S59): no greeting, but their packs
  // load when the page opens, so the first reaction plays whole ──
  { toolId: "retro", open: [], actions: { card_added: STICKY, kudos_added: ["kudos"] } },
  { toolId: "kanban", open: [], actions: { card_added: STICKY } },
  { toolId: "story-mapper", open: [], actions: { card_added: STICKY } },
  {
    toolId: "planning-poker",
    open: [],
    actions: {
      vote_cast: ["poker"],
      votes_revealed: ["poker.reveal"],
      estimate_committed: ["poker.agree"],
    },
  },
  {
    toolId: "ceremony-timer",
    open: [],
    actions: {
      timer_started: ["timer"],
      timer_paused: ["timer.done"],
      timer_finished: ["timer.done"],
    },
  },
  {
    toolId: "icebreaker",
    open: [],
    actions: { timer_started: ["timer"], timer_finished: ["timer.done"] },
  },
  {
    toolId: "liberating-structures",
    open: [],
    actions: { step_timer_started: ["timer"], timer_finished: ["timer.done"] },
  },
  { toolId: "standup", open: [], actions: { entry_added: ["timer.standup"] } },
  { toolId: "release-readiness", open: [], actions: { release_shipped: ["ship"] } },
  {
    toolId: "design-sprint",
    open: [],
    actions: { sprint_started: ["ship.rocket"], sprint_completed: ["ship"] },
  },
  { toolId: "velocity", open: [], actions: { sprint_closed: ["ship"] } },
  { toolId: "sprint", open: [], actions: { sprint_closed: ["ship"] } },
  { toolId: "sprint-planning", open: [], actions: { sprint_committed: ["ship.rocket"] } },
  { toolId: "kudos", open: [], actions: { kudos_sent: ["kudos"] } },
];

const BY_TOOL = new Map(TOOL_SCENES.map((t) => [t.toolId, t]));

/** The tool whose page this is (`/<toolId>` or below it), if Amr has scenes for it. */
export function toolForPath(path: string): ToolScenes | undefined {
  const id = path.split("/")[1] ?? "";
  return id ? BY_TOOL.get(id) : undefined;
}

/** The scenes a tool's action or event can play, or none. */
export function toolActionScenes(toolId: string, action: string): readonly string[] {
  return BY_TOOL.get(toolId)?.actions[action] ?? [];
}

/** Every scene a tool's page may play: load their packs when it opens. */
export function toolPageScenes(path: string): readonly string[] {
  const t = toolForPath(path);
  if (!t) return [];
  return Array.from(new Set([...t.open, ...Object.values(t.actions).flat()]));
}
