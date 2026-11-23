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
 * (shippedScene), so rows can name scenes before their art exists. The More tools
 * shelf's come from the expansion's tool lab (docs/mascot/expansion-sheets.json,
 * X025–X056), each bound only where docs/mascot/expansion-triggers.md says. Nine
 * cast encounters (X085–X104) play on the very action their trigger names, and
 * never greet: six beside the scene that action already plays, one picked at
 * random, and three (X097, X103, X104) as the only scene of an action no other
 * scene answers. Pure data.
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
  {
    toolId: "product-goal",
    open: ["goal", "goal.think"],
    actions: { goal_created: ["goal.think"], goal_achieved: ["goal.hit"] },
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
    actions: { action_done: ["todo.done", "x100"], action_added: ["todo.take"] },
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
    actions: { criterion_toggled: ["done.stamp"], criterion_added: ["done.tick", "x085"] },
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
  { toolId: "sm-notebook", open: ["chat"], actions: { note_added: ["chat.note"] } },
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
  // A measured result committed against the target is X097's evidence check; it claims no
  // verdict (validated and invalidated are moments of their own). A result cleared from the
  // field is logged apart (result_cleared), which nothing here answers.
  {
    toolId: "hypothesis-tracker",
    open: ["lab"],
    actions: {
      hypothesis_added: ["lab.pour"],
      result_recorded: ["x097"],
      validated: ["lab.yes"],
      invalidated: ["lab.no"],
    },
  },
  {
    toolId: "user-interviews",
    open: ["interview"],
    actions: { interview_added: ["interview.note"], quote_sent: ["interview.quote"] },
  },
  {
    toolId: "persona-library",
    open: ["interview"],
    actions: { persona_created: ["interview.note"] },
  },
  {
    toolId: "opportunity-tree",
    open: ["tree"],
    actions: { node_added: ["tree.grow"], experiment_sent: ["tree.share"] },
  },
  {
    toolId: "impact-map",
    open: ["goal.think"],
    actions: { node_added: ["tree.grow"], deliverable_sent: ["tree.share"] },
  },
  {
    toolId: "strategy-tree",
    open: ["tree"],
    actions: { node_added: ["tree.grow"], bet_sent: ["tree.share"] },
  },
  {
    toolId: "product-metrics",
    open: ["okr"],
    actions: { reading_added: ["okr.checkin"], north_star_set: ["goal.hit"] },
  },
  {
    toolId: "ab-calculator",
    open: ["lab"],
    actions: { counts_recorded: ["lab.pour"] },
  },
  {
    toolId: "ebm-dashboard",
    open: ["compass"],
    actions: { review_recorded: ["compass.think"] },
  },
  // A test created hasn't run: X095 stops before its cart crosses. test_generated, logged in
  // the same handler, stays unbound, so the test created is what he answers.
  {
    toolId: "riskiest-assumption",
    open: ["assume"],
    actions: { assumption_added: ["assume.doubt"], test_created: ["assume.test", "x095.setup"] },
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
    actions: { item_added: ["debt.pile"], item_resolved: ["debt.clean", "x099"] },
  },
  // A test the visitor marks fixed (X090, the repair) or quarantined (X103, set aside safely).
  {
    toolId: "flaky-tests",
    open: ["flaky"],
    actions: {
      test_added: ["flaky.wobble"],
      test_fixed: ["flaky.fixed", "x090"],
      test_quarantined: ["x103"],
    },
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
  { toolId: "async-standup", open: [], actions: { update_posted: ["timer.standup", "x094"] } },
  // wall_saved has no scene: the same tick cheers ("audience-wall", "result").
  { toolId: "audience-wall", open: [], actions: { themes_accepted: ["sticky.think"] } },
  // Amr thinks along while the team asks why or lays out causes.
  {
    toolId: "root-cause",
    open: [],
    actions: { why_added: ["sticky.think"], cause_added: ["sticky.think"] },
  },
  // A point parked is written on a sticky and stuck up; one sent on is a to-do taken.
  {
    toolId: "parking-lot",
    open: [],
    actions: { item_parked: ["sticky"], item_sent: ["todo.take"] },
  },
  // A card dealt is turned face up; a shuffle puts the deck back in his hand.
  // The round's last card cheers ("card-decks", "done") in the same tick, and
  // that wins. A star is logged both ways, so it gets no scene.
  {
    toolId: "card-decks",
    open: [],
    actions: { card_dealt: ["poker.reveal"], deck_shuffled: ["poker"] },
  },
  // A rule or an example on the map is a sticky stuck up; a question makes him think,
  // and a rule split off is a to-do taken. sent_to_story cheers ("example-mapping",
  // "done") in the same tick, as does the last open question answered: no scene.
  {
    toolId: "example-mapping",
    open: [],
    actions: {
      rule_added: ["sticky"],
      example_added: ["sticky"],
      question_added: ["sticky.think"],
      split_by_rule: ["todo.take"],
    },
  },
  // A live round saved turns the cards face up; stories sent to Poker are a to-do taken.
  // Save sizes cheers ("relative-sizing", "done") in the same tick: no scene.
  {
    toolId: "relative-sizing",
    open: [],
    actions: { round_saved: ["poker.reveal"], sent_to_poker: ["todo.take"] },
  },
  // A bug logged is written on a sticky; one sent on is a to-do taken. triage_done
  // cheers ("bug-triage", "done") in the same tick as the last placement: no scene.
  {
    toolId: "bug-triage",
    open: [],
    actions: { bug_logged: ["sticky"], bug_sent: ["todo.take"] },
  },
  // A note taken in a session goes on a sticky; its bugs sent on are a to-do taken.
  // session_debriefed cheers in the same tick: no scene. Hill Chart's scope_done
  // cheers ("hill-chart", "milestone") too, so it has no row.
  {
    toolId: "test-sessions",
    open: [],
    actions: { note_added: ["sticky"], bugs_sent: ["todo.take"] },
  },
  // Items sent from the notes are a to-do taken, as in the Parking Lot.
  { toolId: "notes-to-actions", open: [], actions: { items_sent: ["todo.take"] } },

  // ── The expansion's tool lab (X025–X056) ──
  // One sheet per tool on the More tools shelf. Opening the tool plays its sheet as the
  // catalog's illustrative preview; an action plays it only where the tool logs the very
  // event its trigger names (docs/mascot/expansion-triggers.md). A `.preview` stops
  // before an outcome the trigger keeps for an event the tool doesn't record.
  // The ring a new blip lands in, and which way a move goes, are only in the payload: a
  // blip added or moved to any ring, Hold included, plays the peg lifted, never seated inward.
  {
    toolId: "tech-radar",
    open: ["x025"],
    actions: { blip_added: ["x025.lift"], blip_moved: ["x025.lift"] },
  },
  // "Enters review" is rfc_updated, shared with reviewer and comment edits; a new RFC is
  // a draft, and rfc_decided is a decision, not the review offer the scene ends on.
  { toolId: "rfc-tracker", open: ["x026"], actions: {} },
  { toolId: "space-pulse", open: ["x027"], actions: { score_logged: ["x027"] } },
  { toolId: "devex-survey", open: ["x028"], actions: { response_logged: ["x028"] } },
  { toolId: "slo-builder", open: ["x029"], actions: { burn_logged: ["x029"] } },
  { toolId: "platform-maturity", open: ["x030"], actions: { assessment_saved: ["x030"] } },
  { toolId: "incident-commander", open: ["x031"], actions: { timeline_logged: ["x031"] } },
  {
    toolId: "post-mortem",
    open: ["x032"],
    actions: { postmortem_added: ["x032"], postmortem_published: ["x032"] },
  },
  {
    toolId: "oncall-roster",
    open: ["x033"],
    actions: { shift_added: ["x033"], page_logged: ["x033"] },
  },
  // runbook_scored is any field edit, the tested switch on or off alike: no test entry.
  { toolId: "runbook-scorer", open: ["x034"], actions: {} },
  { toolId: "threat-model", open: ["x035"], actions: { threat_added: ["x035"] } },
  // No recheck is recorded, so a resolved vulnerability gets the procedure up to it.
  {
    toolId: "vuln-burndown",
    open: ["x036.preview"],
    actions: { vuln_resolved: ["x036.preview"] },
  },
  { toolId: "control-map", open: ["x037"], actions: { evidence_added: ["x037"] } },
  // No keyboard retest is recorded: a resolved issue gets the fix, not the retested path.
  {
    toolId: "a11y-tracker",
    open: ["x038.preview"],
    actions: { issue_resolved: ["x038.preview"] },
  },
  {
    toolId: "wardley-map",
    open: ["x039"],
    actions: { component_added: ["x039"], link_added: ["x039"] },
  },
  // eval_logged is one score, not a comparison or a regression.
  { toolId: "llm-eval-tracker", open: ["x040.preview"], actions: {} },
  { toolId: "prompt-registry", open: ["x041"], actions: { prompt_drafted: ["x041"] } },
  // section_updated is logged whenever a field loses focus, changed or not.
  { toolId: "ai-feature-spec", open: ["x042"], actions: {} },
  // Marking one resolved attaches no source and records no correction.
  { toolId: "hallucination-log", open: ["x043.preview"], actions: {} },
  { toolId: "token-cost-tracker", open: ["x044"], actions: { spend_logged: ["x044"] } },
  // model_added is also logged when Run all starts a live compare, before any result.
  { toolId: "model-comparison", open: ["x045"], actions: {} },
  // A checklist update, ticked or unticked alike (which one is only in the payload, which
  // Amr never hears): the scene keeps a check open, never closes one.
  { toolId: "ai-safety-checklist", open: ["x046"], actions: { item_toggled: ["x046"] } },
  // step_toggled carries only the step's id, not whether it's now done, and Amr hears no
  // payload anyway.
  { toolId: "model-migration", open: ["x047"], actions: {} },
  { toolId: "agentic-workflow", open: ["x048"], actions: { workflow_added: ["x048"] } },
  // No rerun of the attack is recorded: a resolved finding gets the procedure up to it.
  {
    toolId: "ai-red-team",
    open: ["x049.preview"],
    actions: { finding_resolved: ["x049.preview"] },
  },
  // A disagreement or a low rating is only in the payload, which Amr never sees.
  { toolId: "hitl-quality", open: ["x050"], actions: {} },
  // A tie is logged the same way: the pair compared, no preference kept.
  { toolId: "rlhf-log", open: ["x051"], actions: { pair_logged: ["x051.compare"] } },
  {
    toolId: "vector-store-inventory",
    open: ["x052"],
    actions: { collection_added: ["x052"] },
  },
  { toolId: "model-card", open: ["x053"], actions: { card_saved: ["x053"] } },
  { toolId: "ooda-loop", open: ["x054"], actions: { cycle_completed: ["x054"] } },
  { toolId: "stacey-matrix", open: ["x055"], actions: { item_added: ["x055"] } },
  { toolId: "polarity-map", open: ["x056"], actions: { polarity_added: ["x056"] } },

  // ── Tools with the toolkit moments (S54–S59): no greeting, but their packs
  // load when the page opens, so the first reaction plays whole ──
  {
    toolId: "retro",
    open: [],
    actions: {
      card_added: STICKY,
      kudos_added: ["kudos"],
      // The Lean Coffee runner's timebox per topic.
      topic_started: ["timer"],
      topic_done: ["timer.done"],
    },
  },
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
    toolId: "facilitator-timers",
    open: [],
    actions: {
      timer_started: ["timer"],
      break_started: ["timer"],
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
  // A closed sprint's leftovers sent back to the backlog: off the carry-over loop (X104).
  {
    toolId: "sprint-planning",
    open: [],
    actions: { sprint_committed: ["ship.rocket"], stories_returned: ["x104"] },
  },
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
