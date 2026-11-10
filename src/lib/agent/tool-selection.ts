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
  adkar: ["workspace.adkar_doc"],
  "agentic-workflow": ["workspace.agent_workflow", "workspace.agent_node"],
  "ai-red-team": ["workspace.red_team_finding"],
  "async-standup": ["workspace.async_update"],
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
  eisenhower: ["workspace.prioritization"],
  "feature-flag-tracker": ["workspace.feature_flag"],
  "flaky-tests": ["workspace.flaky_test_board"],
  "hallucination-log": ["workspace.hallucination"],
  "hitl-quality": ["workspace.hitl_review"],
  "hundred-dollar-test": ["workspace.allocation_round", "workspace.prioritization"],
  "ice-score": ["workspace.prioritization"],
  impediments: ["workspace.impediment"],
  "jtbd-mapper": ["workspace.job_story"],
  kanban: ["workspace.kanban_board"],
  "kano-model": ["workspace.prioritization"],
  "llm-eval-tracker": ["workspace.llm_eval"],
  maturity: ["workspace.maturity_assessment", "workspace.scalars"],
  // The /model-comparison matrix is the model registry's page.
  "model-comparison": ["tool.model_registry", "workspace.model"],
  "mood-tracker": ["workspace.mood_entry", "workspace.mood_pulse", "workspace.mood_tracker_doc"],
  moscow: ["workspace.prioritization"],
  "nps-csat": ["workspace.nps_response"],
  okrs: ["workspace.okr"],
  "one-on-one": ["workspace.team_member"],
  "ooda-loop": ["workspace.ooda_cycle"],
  // PI dependencies link to Scrum of Scrums entries.
  "pi-planning": ["workspace.sos_entry"],
  "planning-poker": ["workspace.poker_estimation_log"],
  "polarity-map": ["workspace.polarity"],
  premortem: ["workspace.release_readiness", "workspace.epic_roadmap"],
  prioritizer: ["workspace.backlog_item"],
  "prompt-registry": ["workspace.prompt"],
  "psych-safety": ["workspace.psych_safety_log"],
  raci: ["workspace.raci_matrix"],
  "rapid-decision": ["workspace.decision"],
  refinement: ["workspace.story", "workspace.backlog_item", "workspace.poker_estimation_log"],
  retro: ["workspace.retro_board"],
  "retro-actions": ["workspace.retro_board"],
  "rice-scoring": ["workspace.prioritization"],
  "risk-register": ["workspace.risk"],
  "rlhf-log": ["workspace.rlhf_pair"],
  "scrum-of-scrums": ["workspace.sos_entry"],
  "six-hats": ["workspace.six_hats_thought", "workspace.six_hats_session"],
  "skills-matrix": ["workspace.team_member"],
  sprint: [
    "workspace.sprint",
    "workspace.sprint_series",
    "workspace.story",
    "workspace.ceremony_cadence",
  ],
  "sprint-compare": ["workspace.sprint_series", "workspace.sprint"],
  "sprint-metrics": ["workspace.sprint", "workspace.story"],
  "sprint-planning": ["workspace.sprint", "workspace.story", "workspace.ceremony_cadence"],
  standup: ["workspace.standup_entry"],
  "story-mapper": ["workspace.story_map"],
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

/**
 * Choose the action ids to offer the model this turn, most important first.
 * The whole registry (~830 actions, ~590 KB of JSON, ~150k tokens) is never
 * sent: it was slow, and too big for the gateway.
 *
 *  1. Every action the conversation already called — always, even past `max`:
 *     dropping one would make the request body invalid (see the file header).
 *  2. The open page's actions (`pageActionGroups`), reads first. A page with
 *     none gets the reads of CORE_WORKSPACE_GROUPS.
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

  if (opts.toolId) {
    // Group order first (the page's own groups lead), registry order within one.
    const inGroups = (groups: readonly string[]) =>
      groups.flatMap((g) => opts.actions.filter((a) => actionGroup(a) === g));
    let own = inGroups(pageActionGroups(opts.toolId));
    if (own.length === 0) {
      own = inGroups(CORE_WORKSPACE_GROUPS).filter((a) => a.category === "read");
    }
    for (const a of own) if (a.category === "read") add(a.id);
    for (const a of own) if (a.category !== "read") add(a.id);
  }

  for (const id of opts.rankedIds ?? []) add(id);

  for (const a of opts.actions) if (a.id.startsWith("intent.")) add(a.id);

  return picked;
}
