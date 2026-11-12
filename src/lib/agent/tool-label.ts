/**
 * Plain words for a tool call's name, worked out when the chat draws it.
 *
 * The model calls an action by its wire name, the registry id with every dot
 * turned into an underscore (claudeNameFromId): `tool_retro_actions_add`,
 * `tool_planning_poker_cast_vote`, `workspace_team_member_create`,
 * `intent_plan_sprint`. MCP and the registry use the dotted id
 * (`tool.retro_actions.add`). Both forms come in here and leave as
 * { tool: "Retro Actions", verb: "Add" }, ready for "Retro Actions · Add".
 *
 * The underscored form can't be turned back into the id by splitting (an
 * action name holds underscores too, registry.ts idFromClaudeName), and the
 * registry's reverse map is owner-only code. So after a `tool` prefix this
 * tries the longest run of words, joined with "-", against the tool catalog
 * (`retro-actions` before `retro`), and what is left is the verb. Groups that
 * aren't one tool (workspace entities, intents, a tool the catalog doesn't
 * list) fall back to plain words: "Workspace · Create team member".
 *
 * Nothing is stored: the label is derived at render time, so saved threads
 * and old rows read the same. A raw id is never returned. Pure, with no
 * registry import (lib/constants/tools already ships with the tool finder),
 * so the visitor chat may use it (test/agent/bundle-boundary.test.ts).
 */

import { getToolById } from "@/lib/constants/tools";

export interface ToolLabel {
  /** The tool's name from the catalog ("Retro Board"), or plain words for a group that isn't one tool ("Workspace"). */
  tool: string;
  /** What the call does, in sentence case ("Add card"). Empty when the name holds nothing after the tool. */
  verb: string;
}

/** The label for a name that holds no words at all. */
const NO_NAME: ToolLabel = { tool: "Tool", verb: "" };

/** What workspace entities and cross-tool intents are filed under. */
const WORKSPACE = "Workspace";

/**
 * Words that keep their own spelling: acronyms (OKR, WSJF, DoD, NPS),
 * framework names, and a few short forms said in full. Keyed in lower case.
 */
const SPELLED: Readonly<Record<string, string>> = {
  a11y: "accessibility",
  adkar: "ADKAR",
  adr: "ADR",
  adrs: "ADRs",
  ai: "AI",
  api: "API",
  cd3: "CD3",
  cfd: "CFD",
  ci: "CI",
  csat: "CSAT",
  cynefin: "Cynefin",
  daci: "DACI",
  devex: "DevEx",
  dod: "DoD",
  dor: "DoR",
  dora: "DORA",
  eisenhower: "Eisenhower",
  hitl: "HITL",
  id: "ID",
  ids: "IDs",
  jira: "Jira",
  jtbd: "JTBD",
  kano: "Kano",
  kpi: "KPI",
  kpis: "KPIs",
  kr: "KR",
  krs: "KRs",
  llm: "LLM",
  llms: "LLMs",
  moscow: "MoSCoW",
  mvp: "MVP",
  nps: "NPS",
  okr: "OKR",
  okrs: "OKRs",
  ooda: "OODA",
  pi: "PI",
  qa: "QA",
  raci: "RACI",
  rfc: "RFC",
  rfcs: "RFCs",
  rice: "RICE",
  rlhf: "RLHF",
  roi: "ROI",
  scrum: "Scrum",
  sla: "SLA",
  sli: "SLI",
  slo: "SLO",
  slos: "SLOs",
  sos: "SoS",
  sre: "SRE",
  ui: "UI",
  url: "URL",
  ux: "UX",
  wardley: "Wardley",
  wip: "WIP",
  wsjf: "WSJF",
};

/** Workspace entity words said another way ("scalars" holds the team's name and maturity level). */
const ENTITY_WORDS: Readonly<Record<string, string>> = { scalars: "settings" };

/** Whole verbs said more plainly: every tool's read of its own data is `list_state`. */
const VERB_PHRASES: Readonly<Record<string, string>> = { "list state": "Read" };

/** Plurals English doesn't make with an s. */
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  analysis: "analyses",
  criterion: "criteria",
  person: "people",
};

/**
 * Words an action name starts its verb with. Used only where the name doesn't
 * mark where the verb starts: an underscored workspace name, or a tool the
 * catalog doesn't list.
 */
const VERBS: ReadonlySet<string> = new Set([
  "add",
  "advance",
  "archive",
  "assign",
  "cancel",
  "cast",
  "check",
  "classify",
  "close",
  "commit",
  "compare",
  "complete",
  "compute",
  "create",
  "decide",
  "delete",
  "deprecate",
  "derive",
  "digest",
  "export",
  "find",
  "forecast",
  "get",
  "link",
  "list",
  "log",
  "mark",
  "move",
  "open",
  "persist",
  "place",
  "post",
  "promote",
  "publish",
  "raise",
  "rate",
  "record",
  "refund",
  "remove",
  "rename",
  "reopen",
  "reset",
  "resolve",
  "retire",
  "reveal",
  "save",
  "score",
  "send",
  "set",
  "ship",
  "start",
  "suggest",
  "summarize",
  "supersede",
  "take",
  "toggle",
  "unlink",
  "update",
]);

/** A name's words, in lower case: any run of letters and digits. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Words as a sentence-case phrase, acronyms and names kept as they are spelled. */
function phrase(words: readonly string[]): string {
  const plain = VERB_PHRASES[words.join(" ")];
  if (plain) return plain;
  return words
    .map((word, i) => {
      const spelled = SPELLED[word] ?? word;
      // A word with its own capitals (OKR, DoD) stays as it is, even first.
      if (spelled !== spelled.toLowerCase() || i > 0) return spelled;
      return spelled.charAt(0).toUpperCase() + spelled.slice(1);
    })
    .join(" ");
}

/** One English plural, for a list's entity ("story" → "stories", "series" stays). */
function pluralWord(word: string): string {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  if (word.endsWith("s")) return word;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/** An entity in the plural, on its head noun ("definition of done" → "definitions of done"). */
function plural(words: readonly string[]): string[] {
  if (words.length === 0) return [];
  const of = words.indexOf("of");
  const head = of > 0 ? of - 1 : words.length - 1;
  return words.map((word, i) => (i === head ? pluralWord(word) : word));
}

/** The catalog tool that the longest run of these words, from the start, names. */
function longestTool(words: readonly string[]): { name: string; rest: string[] } | null {
  for (let n = words.length; n >= 1; n--) {
    const tool = getToolById(words.slice(0, n).join("-"));
    if (tool) return { name: tool.name, rest: words.slice(n) };
  }
  return null;
}

/**
 * A `tool` group: its tool from the catalog, then the verb. `segment` and
 * `after` are set for a dotted name, whose dots say exactly where the tool's
 * part ends.
 */
function toolGroup(words: string[], segment: string[] | null, after: string[] | null): ToolLabel {
  if (segment && after) {
    const tool = getToolById(segment.join("-"));
    if (tool) return { tool: tool.name, verb: phrase(after) };
    if (segment.length > 0) return { tool: phrase(segment), verb: phrase(after) };
  }
  const found = longestTool(words);
  if (found) return { tool: found.name, verb: phrase(found.rest) };
  if (words.length === 0) return NO_NAME;
  // A tool the catalog doesn't list: its words run up to the first verb word.
  const at = words.findIndex((word, i) => i > 0 && VERBS.has(word));
  const cut = at === -1 ? 1 : at;
  return { tool: phrase(words.slice(0, cut)), verb: phrase(words.slice(cut)) };
}

/**
 * A workspace entity: "Workspace", then the verb and the entity ("Create
 * team member", "List sprints"). A verb of more than one word names its own
 * object ("Set team name").
 */
function workspaceGroup(
  words: string[],
  segment: string[] | null,
  after: string[] | null
): ToolLabel {
  let entity: string[];
  let action: string[];
  if (segment && after) {
    entity = segment;
    action = after;
  } else {
    // The verb is the last verb word that isn't the entity's first.
    let at = -1;
    for (let i = words.length - 1; i >= 1; i--) {
      if (VERBS.has(words[i])) {
        at = i;
        break;
      }
    }
    entity = at === -1 ? words : words.slice(0, at);
    action = at === -1 ? [] : words.slice(at);
  }
  entity = entity.map((word) => ENTITY_WORDS[word] ?? word);
  if (action.length === 0) return { tool: WORKSPACE, verb: phrase(entity) };
  if (action.length > 1 || entity.length === 0) return { tool: WORKSPACE, verb: phrase(action) };
  const object = action[0] === "list" ? plural(entity) : entity;
  return { tool: WORKSPACE, verb: phrase([action[0], ...object]) };
}

/** Plain words for a tool call's wire name (underscored or dotted). Never a raw id. */
export function toolLabel(wireName: string): ToolLabel {
  const name = typeof wireName === "string" ? wireName : "";
  const words = wordsOf(name);
  if (words.length === 0) return NO_NAME;
  const [group, ...rest] = words;
  // A dotted name: its second part is the tool or entity, the rest the verb.
  const parts = name.split(".");
  const dotted = parts.length > 2;
  const segment = dotted ? wordsOf(parts[1]) : null;
  const after = dotted ? wordsOf(parts.slice(2).join(" ")) : null;

  if (group === "tool") return toolGroup(rest, segment, after);
  if (group === "workspace") return workspaceGroup(rest, segment, after);
  if (group === "intent") return { tool: WORKSPACE, verb: phrase(rest) };
  // No known group: a tool's own words first ("retro_add_card"), else just words.
  const found = longestTool(words);
  if (found) return { tool: found.name, verb: phrase(found.rest) };
  return { tool: NO_NAME.tool, verb: phrase(words) };
}
