/**
 * Pure helpers for choosing which tools to offer the model on a given turn.
 *
 * Tool trimming (selectTurnToolIds below, used by client.ts pickTurnTools)
 * offers the open tool's actions plus the KB's top matches for the user's
 * request, never the whole registry. Two correctness constraints the naive
 * "rank the latest message" approach got wrong:
 *
 *  1. Stateless follow-ups ("rename it", "add 3 more") carry almost no KB signal
 *     on their own, so ranking must consider the recent user context, not just
 *     the last line. → recentUserText.
 *  2. The request body replays the whole transcript, including prior assistant
 *     tool_calls. An OpenAI-compatible endpoint rejects a tool_call whose
 *     function name is absent from `tools`, so the offered set MUST stay a
 *     superset of everything the history already references. → toolNamesInHistory.
 */

import type { ChatMessage } from "./types";

/**
 * Concatenate the text of the last `n` user messages (most recent last). Used to
 * rank tools with enough context that a pronoun-y follow-up inherits the nouns
 * from the turn before it. Returns "" when there are no user-text messages.
 */
export function recentUserText(messages: ChatMessage[], n = 2): string {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && texts.length < n; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = m.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (t) texts.push(t);
  }
  return texts.reverse().join(" ").trim();
}

/**
 * The tool names referenced by every assistant `tool_use` block in the history.
 * These must remain available in the trimmed tool list or the wire is invalid.
 * Names are returned verbatim (as the model emitted them — typically the
 * underscore "claude" form); the caller normalises via the registry.
 */
export function toolNamesInHistory(messages: ChatMessage[]): string[] {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.content) {
      if (c.type === "tool_use") names.add(c.name);
    }
  }
  return Array.from(names);
}

/** Most tool schemas offered per turn (tools already used in the chat may add to it). */
export const MAX_TOOLS_PER_TURN = 64;

/**
 * Action groups a page works through beyond the two its id names by default
 * (see pageActionGroups). An action group is an action's `toolId`, e.g.
 * "workspace.retro_board". Taken from each tool action file's "Backing CRUD"
 * header and from what the page itself reads and writes.
 *
 * Pages whose own data has no agent actions at all (tech-radar,
 * stakeholder-map, icebreaker, …) are left out on purpose: they get
 * CORE_WORKSPACE_GROUPS' reads instead.
 */
export const PAGE_ACTION_GROUPS: Readonly<Record<string, readonly string[]>> = {
  // The A/B Calculator saves its tests and links them to hypotheses.
  "ab-calculator": ["workspace.ab_test", "tool.hypothesis_tracker"],
  adkar: ["workspace.adkar_doc"],
  "agentic-workflow": ["workspace.agent_workflow", "workspace.agent_node"],
  "ai-red-team": ["workspace.red_team_finding"],
  "async-standup": ["workspace.async_update"],
  // DEEP checks read the stories and the backlog, and write Given/When/Then on stories.
  "backlog-health": ["workspace.story", "workspace.backlog_item"],
  // Bug Triage plans bugs as backlog stories and logs fix-now ones as interrupts.
  "bug-triage": ["workspace.bug_report", "workspace.story", "workspace.interrupt_item"],
  burndown: [
    "workspace.sprint",
    "workspace.sprint_series",
    "workspace.story",
    "workspace.ceremony_cadence",
  ],
  "buy-a-feature": ["workspace.buy_a_feature_game", "workspace.prioritization"],
  canvas: ["workspace.whiteboard"],
  "capacity-planner": ["workspace.capacity_plan", "workspace.sprint"],
  // The timer's agenda comes from the shared ceremony cadence; its speakers
  // from the team roster.
  "ceremony-timer": [
    "tool.ceremony_cadence",
    "workspace.ceremony_cadence",
    "workspace.team_member",
  ],
  "code-review-metrics": ["workspace.code_review_log"],
  "cost-of-delay": ["workspace.prioritization"],
  "cumulative-flow": ["workspace.story", "workspace.sprint", "workspace.kanban_board"],
  "cycle-time": ["workspace.story", "workspace.sprint", "workspace.kanban_board"],
  cynefin: ["workspace.cynefin_item"],
  daci: ["workspace.daci_decision", "workspace.decision"],
  "decision-log": ["workspace.decision"],
  "dod-builder": ["workspace.definition_of_done"],
  // The EBM measures are product metrics; its experiments are hypotheses.
  "ebm-dashboard": [
    "workspace.ebm_board",
    "workspace.product_metric",
    "tool.hypothesis_tracker",
    "tool.product_metrics",
  ],
  eisenhower: ["workspace.prioritization"],
  // Rules and examples go to the story as Given/When/Then.
  "example-mapping": ["workspace.example_map", "workspace.story"],
  // The cost ticker can count the team from the roster.
  "facilitator-timers": ["workspace.team_member"],
  "feature-flag-tracker": ["workspace.feature_flag"],
  "flaky-tests": ["workspace.flaky_test_board"],
  // Flow Insights' targets live on the Definition of Workflow.
  "flow-insights": ["workspace.workflow_definition"],
  "hallucination-log": ["workspace.hallucination"],
  // A stuck scope is raised as an impediment.
  "hill-chart": ["workspace.impediment"],
  "hitl-quality": ["workspace.hitl_review"],
  "hundred-dollar-test": ["workspace.allocation_round", "workspace.prioritization"],
  "ice-score": ["workspace.prioritization"],
  "impact-map": ["workspace.strategy_map"],
  impediments: ["workspace.impediment"],
  // An A3 links a Root Cause analysis, and plans one carried on from it.
  improve: ["workspace.improvement", "workspace.root_cause_analysis"],
  // Interrupts, and the buffer each sprint keeps for them.
  "interrupt-buffer": ["workspace.interrupt_item", "workspace.sprint"],
  "jtbd-mapper": ["workspace.job_story"],
  // The Definition of Workflow is the Kanban board's.
  kanban: ["workspace.kanban_board", "workspace.workflow_definition"],
  "kano-model": ["workspace.prioritization"],
  "llm-eval-tracker": ["workspace.llm_eval"],
  maturity: ["workspace.maturity_assessment", "workspace.scalars"],
  // The /model-comparison matrix is the model registry's page.
  "model-comparison": ["tool.model_registry", "workspace.model"],
  "mood-tracker": ["workspace.mood_entry", "workspace.mood_pulse", "workspace.mood_tracker_doc"],
  moscow: ["workspace.prioritization"],
  // Each kept item goes to the tool that tracks it.
  "notes-to-actions": [
    "workspace.meeting_note",
    "workspace.retro_board",
    "workspace.decision",
    "workspace.impediment",
    "workspace.story",
    "workspace.bug_report",
  ],
  "nps-csat": ["workspace.nps_response"],
  okrs: ["workspace.okr"],
  "one-on-one": ["workspace.team_member"],
  "ooda-loop": ["workspace.ooda_cycle"],
  "parking-lot": ["workspace.parking_lot_item"],
  "persona-library": ["workspace.persona"],
  // PI dependencies link to Scrum of Scrums entries.
  "pi-planning": ["workspace.sos_entry"],
  // Names come from the team roster.
  picker: ["workspace.team_member"],
  "planning-poker": ["workspace.poker_estimation_log"],
  "polarity-map": ["workspace.polarity"],
  premortem: ["workspace.release_readiness", "workspace.epic_roadmap"],
  prioritizer: ["workspace.backlog_item"],
  // A canvas's assumptions go to the Hypothesis Tracker.
  "product-canvas": ["tool.hypothesis_tracker"],
  "product-metrics": ["workspace.product_metric"],
  "prompt-registry": ["workspace.prompt"],
  "psych-safety": ["workspace.psych_safety_log"],
  raci: ["workspace.raci_matrix"],
  "rapid-decision": ["workspace.decision"],
  refinement: [
    "workspace.story",
    "workspace.backlog_item",
    "workspace.poker_estimation_log",
    "tool.backlog_health",
  ],
  // Velocity reads the sprints; the item count reads finished stories, Flow-board cards and the roadmap's epics.
  "release-planner": [
    "workspace.sprint",
    "workspace.story",
    "workspace.kanban_board",
    "workspace.epic_roadmap",
  ],
  retro: ["workspace.retro_board"],
  "retro-actions": ["workspace.retro_board"],
  "rice-scoring": ["workspace.prioritization"],
  "risk-register": ["workspace.risk"],
  "rlhf-log": ["workspace.rlhf_pair"],
  "root-cause": ["workspace.root_cause_analysis"],
  "scrum-of-scrums": ["workspace.sos_entry"],
  "six-hats": ["workspace.six_hats_thought", "workspace.six_hats_session"],
  "skills-matrix": ["workspace.team_member"],
  "sm-notebook": ["workspace.notebook_entry"],
  // The goal check also reads impediments and the interrupt buffer.
  sprint: [
    "workspace.sprint",
    "workspace.sprint_series",
    "workspace.story",
    "workspace.ceremony_cadence",
    "workspace.impediment",
    "workspace.interrupt_item",
  ],
  "sprint-compare": ["workspace.sprint_series", "workspace.sprint"],
  "sprint-goal": ["tool.product_goal"],
  "sprint-metrics": ["workspace.sprint", "workspace.story"],
  "sprint-planning": [
    "workspace.sprint",
    "workspace.story",
    "workspace.ceremony_cadence",
    "tool.interrupt_buffer",
    "tool.product_goal",
  ],
  standup: ["workspace.standup_entry"],
  "story-mapper": ["workspace.story_map"],
  // A strategy tree's bets are tested in the Hypothesis Tracker.
  "strategy-tree": ["workspace.strategy_map", "workspace.hypothesis_tracker"],
  // Groups are mixed from the team roster, by role or skill.
  "team-mixer": ["workspace.team_member"],
  "team-time": [
    "workspace.team_time_person",
    "workspace.team_time_poll",
    "workspace.team_time_rotation",
  ],
  // The page's default group is workspace.test_sessions, so its own CRUD is listed.
  "test-sessions": ["workspace.test_session", "workspace.bug_report", "workspace.story"],
  "token-cost-tracker": ["workspace.token_spend"],
  "user-interviews": ["workspace.user_interview_log"],
  "value-effort-matrix": ["workspace.prioritization"],
  "value-stream": ["workspace.value_stream_stage"],
  "vector-store-inventory": ["workspace.vector_collection"],
  velocity: ["workspace.sprint"],
  "weighted-decision": [
    "workspace.weighted_matrix",
    "workspace.weighted_criterion",
    "workspace.weighted_option",
  ],
  wsjf: ["workspace.prioritization"],
};

/**
 * Other pages' groups a page only reads: only their category "read" actions
 * are offered (for a CRUD group, `.list`). A group the page or its verbs
 * write stays in PAGE_ACTION_GROUPS; a page's own default groups are never
 * listed here.
 */
export const PAGE_READ_GROUPS: Readonly<Record<string, readonly string[]>> = {
  // Its details form links a product metric.
  "ab-calculator": ["workspace.product_metric"],
  // The digests and the Hand-overs panel read Team Time's places.
  "async-standup": ["workspace.team_time_person"],
  "bug-triage": ["workspace.sprint"],
  "ebm-dashboard": ["tool.product_goal"],
  // Its Three-point check reads Planning Poker's three_point verb.
  "estimation-guide": ["tool.planning_poker"],
  "flow-insights": [
    "workspace.story",
    "workspace.sprint",
    "workspace.kanban_board",
    "workspace.capacity_plan",
  ],
  "hill-chart": ["workspace.story", "workspace.epic_roadmap"],
  "hypothesis-tracker": [
    "workspace.product_metric",
    "workspace.ab_test",
    "workspace.story",
    "workspace.okr",
    "workspace.epic_roadmap",
    "tool.product_metrics",
    "tool.ab_calculator",
  ],
  "impact-map": ["workspace.persona", "workspace.product_goal"],
  impediments: ["workspace.story", "workspace.kanban_board"],
  kanban: ["workspace.impediment", "workspace.story"],
  kickoff: ["workspace.team_member", "tool.product_goal"],
  "notes-to-actions": ["workspace.team_member"],
  "persona-library": ["workspace.user_interview_log", "workspace.strategy_map"],
  // PI Planning's verbs only read risks this phase.
  "pi-planning": ["workspace.risk"],
  "product-canvas": ["tool.product_goal"],
  "product-metrics": ["tool.product_goal"],
  // Options come from backlog items, stories and retro cards. Value poker's
  // write to a backlog item still reaches it through the KB ranking.
  "quick-vote": ["workspace.backlog_item", "workspace.story", "workspace.retro_board"],
  // Similar stories and the three-point check read Planning Poker's verbs.
  refinement: ["tool.planning_poker"],
  // Unsized stories to size; "Save sizes" writes through the page's own verb.
  "relative-sizing": ["workspace.story"],
  "release-readiness": ["workspace.story"],
  standup: ["workspace.team_time_person"],
  "team-time": ["workspace.team_member"],
  "test-sessions": ["workspace.team_member"],
  // The core-hours template reads Team Time's people, on each clock.
  "working-agreement": ["workspace.team_time_person"],
};

/** Amr's verbs for a live Audience Wall room (`registerLiveWall`), for pages that host one. */
const WALL_ROOM_VERBS = ["room_status", "open_round", "set_open", "reveal", "lower_hands"].map(
  (v) => `tool.audience_wall.${v}`
);

/** Single actions a page needs from a group it otherwise doesn't get. */
export const PAGE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  // The feedback room is an Audience Wall room; Amr's room verbs reach it.
  "sprint-review": WALL_ROOM_VERBS,
  // Kickoff borrows the same room to collect answers from phones.
  kickoff: WALL_ROOM_VERBS,
};

/**
 * The workspace's main collections. Their reads are what a page with no agent
 * actions of its own gets, so "what's in my workspace?" still has something to
 * call there.
 */
export const CORE_WORKSPACE_GROUPS: readonly string[] = [
  "workspace.sprint",
  "workspace.story",
  "workspace.backlog_item",
  "workspace.team_member",
  "workspace.impediment",
  "workspace.risk",
  "workspace.okr",
  "workspace.decision",
];

/**
 * Every action group a page tool works through, its own first: "retro" →
 * tool.retro, workspace.retro, then PAGE_ACTION_GROUPS' extras such as
 * workspace.retro_board. Tool ids use dashes, action groups underscores.
 * Groups the registry doesn't have are harmless; they just match nothing.
 */
export function pageActionGroups(toolId: string): string[] {
  const stem = toolId.replace(/-/g, "_");
  const groups = [`tool.${stem}`, `workspace.${stem}`, ...(PAGE_ACTION_GROUPS[toolId] ?? [])];
  return Array.from(new Set(groups));
}

/** An action's group: its `toolId`, or its id up to the last dot. */
function actionGroup(a: { id: string; toolId?: string }): string {
  return a.toolId ?? a.id.slice(0, Math.max(0, a.id.lastIndexOf(".")));
}

/** A table's entry for `toolId` (never an inherited key such as "constructor"). */
function entryOf(table: Readonly<Record<string, readonly string[]>>, toolId: string) {
  return Object.prototype.hasOwnProperty.call(table, toolId) ? table[toolId] : [];
}

/**
 * The open page's actions, reads first then writes: the actions of its own
 * groups (`pageActionGroups`), then the reads of the groups it only reads
 * (PAGE_READ_GROUPS), then its single verbs (PAGE_ACTIONS); group order,
 * registry order within one, each action once. A page whose own groups have
 * no actions at all also gets the reads of CORE_WORKSPACE_GROUPS, after its
 * read groups', so "what's in my workspace?" still has something to call.
 */
export function pageActions<A extends { id: string; category: string; toolId?: string }>(
  toolId: string,
  actions: readonly A[]
): A[] {
  const inGroups = (groups: readonly string[]) =>
    groups.flatMap((g) => actions.filter((a) => actionGroup(a) === g));
  const isRead = (a: A) => a.category === "read";
  const own = inGroups(pageActionGroups(toolId));
  const reads = inGroups(entryOf(PAGE_READ_GROUPS, toolId)).filter(isRead);
  const core = own.length === 0 ? inGroups(CORE_WORKSPACE_GROUPS).filter(isRead) : [];
  const singles = entryOf(PAGE_ACTIONS, toolId).flatMap((id) => actions.filter((a) => a.id === id));
  const seen = new Set<string>();
  const all: A[] = [];
  for (const a of [...own, ...reads, ...core, ...singles]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    all.push(a);
  }
  return [...all.filter(isRead), ...all.filter((a) => !isRead(a))];
}

/**
 * Choose the action ids to offer the model this turn, most important first.
 * The whole registry (~830 actions, ~590 KB of JSON, ~150k tokens) is never
 * sent: it was slow, and too big for the gateway.
 *
 *  1. Every action the conversation already called — always, even past `max`:
 *     dropping one would make the request body invalid (see the file header).
 *  2. The open page's actions (`pageActions`: its own groups, the groups it
 *     only reads and its single verbs), reads first. A page with no own
 *     actions also gets the reads of CORE_WORKSPACE_GROUPS.
 *  3. The KB's ranked matches for the recent user text.
 *  4. The cross-tool intents (`intent.*`), so a vague ask on the home page
 *     still has the broad helpers such as "summarise my workspace".
 *
 * Tiers 2–4 stop at `max` in total, on top of tier 1 — a long conversation
 * that already used many tools still gets the page's actions and fresh picks.
 * Ids the registry doesn't know are skipped.
 */
export function selectTurnToolIds(opts: {
  /** The registry's actions (`registry.list()`), in registry order. */
  actions: ReadonlyArray<{ id: string; category: string; toolId?: string }>;
  /** The open page's tool id (e.g. "planning-poker"), or null on other pages. */
  toolId?: string | null;
  /** KB-ranked action ids, best first. */
  rankedIds?: readonly string[];
  /** Dotted ids of actions the conversation already called. */
  historyIds?: readonly string[];
  max?: number;
}): string[] {
  const max = opts.max ?? MAX_TOOLS_PER_TURN;
  const known = new Set(opts.actions.map((a) => a.id));
  const picked: string[] = [];
  const seen = new Set<string>();
  /** Picks from tiers 2–4 (history doesn't count toward `max`). */
  let chosen = 0;
  const add = (id: string, required = false) => {
    if (seen.has(id) || !known.has(id)) return;
    if (!required && chosen >= max) return;
    if (!required) chosen++;
    seen.add(id);
    picked.push(id);
  };

  for (const id of opts.historyIds ?? []) add(id, true);

  // Reads first, then writes; group order, registry order within one.
  if (opts.toolId) for (const a of pageActions(opts.toolId, opts.actions)) add(a.id);

  for (const id of opts.rankedIds ?? []) add(id);

  for (const a of opts.actions) if (a.id.startsWith("intent.")) add(a.id);

  return picked;
}
