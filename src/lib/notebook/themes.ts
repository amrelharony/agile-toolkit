/**
 * Themes in a coach's notes without AI: a note's own tags, plus the themes
 * its words point to ("blocked on sandbox access" is about blockers). The
 * tag fallback (`keywordTags`), the weekly read without AI and the next-step
 * rule all use these, so the page, Amr's actions and the fallbacks agree.
 *
 * Each theme may name the toolkit tool that helps with it. Those ids are
 * registry ids (src/lib/constants/tools.ts; test/notebook checks every one),
 * and the page still resolves them through getToolById (./tools) before it
 * shows a link. Pure, no tool registry import: the AI task's fallback runs
 * in the browser bundle.
 */

import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { KIND_TAGS, eventLabel, normTag, normTags } from "./model";
import { NOTE_TEMPLATES } from "./templates";

export interface NoteTheme {
  /** The tag the theme goes by. */
  tag: string;
  /** Words in a note that point to it. */
  words: RegExp;
  /** The tool that helps with it, by registry id. */
  tool?: string;
  /** Why that tool, finishing "Try it: …" (one plain sentence, no full stop). */
  why?: string;
}

/** The themes a note's words can point to. Our own list; tags typed by hand count as well. */
export const NOTE_THEMES: readonly NoteTheme[] = [
  {
    tag: "blockers",
    words: /\b(block(?:ed|er|ers|ing)?|stuck|waiting (?:on|for)|impediments?)\b/i,
    tool: "impediments",
    why: "the Impediment Tracker keeps each blocker visible and owned until it's gone",
  },
  {
    tag: "participation",
    words:
      /\b(quiet(?:er|est)?|silent|didn'?t speak|did not speak|one-line updates?|dominat\w*|talked over|same (?:two|few) people)\b/i,
    tool: "liberating-structures",
    why: "Liberating Structures such as 1-2-4-All give every voice a turn",
  },
  {
    tag: "safety",
    words: /\b(afraid|fear\w*|blam\w*|defensive|psychological safety|trust)\b/i,
    tool: "psych-safety",
    why: "a psychological safety check shows how safe the team feels to speak up",
  },
  {
    tag: "conflict",
    words: /\b(conflicts?|argu\w*|disagree\w*|tension|friction)\b/i,
    tool: "working-agreement",
    why: "a working agreement gives the team its own rules for disagreeing well",
  },
  {
    tag: "timebox",
    words:
      /\b(over ?ran|ran (?:long|over)|overtime|started late|late start|timebox\w*|too long)\b/i,
    tool: "ceremony-timer",
    why: "the Ceremony Timer keeps each part of an event to its timebox",
  },
  {
    tag: "estimation",
    words: /\b(estimat\w*|story points?|sizing|sized|re-?estimat\w*)\b/i,
    tool: "planning-poker",
    why: "Planning Poker brings different ideas of the work out before the number",
  },
  {
    tag: "interruptions",
    words: /\b(unplanned|interrupt(?:ion|ions|ed|s)?|urgent requests?|firefight\w*|ad[- ]hoc)\b/i,
    tool: "interrupt-buffer",
    why: "an interrupt buffer plans room for unplanned work and shows how much arrives",
  },
  {
    tag: "sprint goal",
    words: /\bsprint goals?\b/i,
    tool: "sprint-goal",
    why: "Sprint Goal helps the team write one goal it can focus on and check against",
  },
  {
    tag: "wellbeing",
    words: /\b(tired|stress\w*|burn(?:ed|t)? ?out|overwork\w*|exhausted|morale|stretched)\b/i,
    tool: "mood-tracker",
    why: "the Mood Tracker shows how the team feels over the sprint, not just today",
  },
  {
    tag: "stakeholders",
    words: /\b(stakeholders?|management|customers?|clients?|sales)\b/i,
    tool: "stakeholder-map",
    why: "a stakeholder map shows who needs what from the team, and how often",
  },
  {
    tag: "dependencies",
    words: /\b(dependenc\w*|other teams?|another team|hand-?offs?)\b/i,
    tool: "dependency-map",
    why: "the Dependency Map shows what waits on whom across teams",
  },
  {
    tag: "quality",
    words: /\b(bugs?|defects?|regressions?|flaky|incidents?|rework)\b/i,
    tool: "dod-builder",
    why: "a shared Definition of Done says what finished means before work starts",
  },
  {
    tag: "kudos",
    words: /\b(thank\w*|kudos|well done|great job|shout-?outs?|celebrat\w*)\b/i,
    tool: "kudos",
    why: "Kudos makes good work visible to the whole team",
  },
  {
    tag: "follow-through",
    words: /\b(retro actions?|action items?|follow[- ]?(?:up|through)s?)\b/i,
    tool: "retro-actions",
    why: "Retro Actions tracks each action to done across retros",
  },
  {
    tag: "meetings",
    words: /\b(too many meetings|meeting load|calendars? (?:is|are) full|back-to-back)\b/i,
    tool: "meeting-audit",
    why: "a meeting audit weighs each recurring meeting's cost against its purpose",
  },
  {
    tag: "coaching",
    words: /\b(coach\w*|mentor\w*|career|growth)\b/i,
    tool: "one-on-one",
    why: "One-on-One keeps each person's agenda and follow-ups between your talks",
  },
  {
    tag: "focus",
    words:
      /\b(wip|work in progress|context switch\w*|multitask\w*|bottlenecks?|too many things)\b/i,
    tool: "kanban",
    why: "a Kanban board with WIP limits shows where work piles up",
  },
  {
    tag: "refinement",
    words: /\b(backlog|refine\w*|unclear stor\w*|acceptance criteria|vague)\b/i,
    tool: "refinement",
    why: "Refinement gets stories clear, small and testable before planning",
  },
  {
    tag: "experiment",
    words: /\b(experiment\w*|trial|tried|hypothes\w*)\b/i,
    tool: "hypothesis-tracker",
    why: "the Hypothesis Tracker keeps each experiment's bet, measure and result",
  },
  {
    tag: "recurring",
    words:
      /\b(again and again|keeps? happening|recurr\w*|root cause|same problem|third (?:day|time))\b/i,
    tool: "root-cause",
    why: "Root Cause takes a problem that keeps coming back through 5 Whys",
  },
  {
    tag: "onboarding",
    words: /\b(new joiners?|onboard\w*|new hires?|new starters?)\b/i,
    tool: "onboarding-tracker",
    why: "the Onboarding Tracker gives a new joiner a plan and a buddy",
  },
  {
    tag: "skills",
    words:
      /\b(knowledge silos?|bus factor|only (?:one person|he|she|they) knows?|pair(?:ing|ed)?|skills?)\b/i,
    tool: "skills-matrix",
    why: "a skills matrix shows where the team depends on one person",
  },
];

const THEME_BY_TAG: ReadonlyMap<string, NoteTheme> = new Map(NOTE_THEMES.map((t) => [t.tag, t]));

/**
 * Tags typed by hand that mean one of the themes ("blocker" is "blockers"),
 * so the counts and the tool for them come out the same.
 */
const TAG_ALIASES: Readonly<Record<string, string>> = {
  blocker: "blockers",
  blocked: "blockers",
  impediment: "blockers",
  impediments: "blockers",
  estimate: "estimation",
  estimates: "estimation",
  interrupts: "interruptions",
  interruption: "interruptions",
  scope: "interruptions",
  dependency: "dependencies",
  stakeholder: "stakeholders",
  "psychological safety": "safety",
  goal: "sprint goal",
  "sprint-goal": "sprint goal",
  experiments: "experiment",
  meeting: "meetings",
};

/** The theme a tag stands for, when it is one. */
export function themeOf(tag: string): NoteTheme | undefined {
  const t = normTag(tag);
  return THEME_BY_TAG.get(TAG_ALIASES[t] ?? t);
}

/** The tool id that helps with a tag's theme, if the theme names one. */
export const themeTool = (tag: string): string | undefined => themeOf(tag)?.tool;

/** A line as prompts are matched: lower case, curly apostrophes made straight (same length). */
const promptKey = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'");

/** The templates' prompts ("what i'll follow up:"), longest first. */
const TEMPLATE_PROMPTS: readonly string[] = Array.from(
  new Set(
    NOTE_TEMPLATES.flatMap((t) => t.body.split("\n"))
      .map((l) => promptKey(l.trim()))
      .filter(Boolean)
  )
).sort((a, b) => b.length - a.length);

/**
 * A note's words without the templates' prompts: a line that starts with
 * one ("What I'll follow up: chase the sandbox") keeps only what was written
 * after it, so a prompt alone never makes a theme or a tag ("follow up" is
 * the template's question, not something that happened).
 */
export function withoutPrompts(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const rest = line.trimStart();
      const key = promptKey(rest);
      const prompt = TEMPLATE_PROMPTS.find((p) => key.startsWith(p));
      return prompt ? rest.slice(prompt.length) : line;
    })
    .join("\n");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `phrase` appears in `text` as whole words ("ux" in "the UX review", not in "luxury"). */
function mentions(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(phrase)}($|[^\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

/** The themes a note's words point to, by tag, in the themes' order. Template prompts don't count. */
export function keywordThemes(text: string): string[] {
  const words = withoutPrompts(text);
  return NOTE_THEMES.filter((t) => t.words.test(words)).map((t) => t.tag);
}

/**
 * Tags for a note without AI: first the notebook's own tags that the note
 * mentions (so the notebook keeps one vocabulary), then the themes its words
 * point to. Tags the note has already, kind tags, and a theme it already has
 * under another name ("blocker" for "blockers") are left out. At most `max`.
 * A template's prompts are not the note's words, so they suggest nothing.
 */
export function keywordTags(
  text: string,
  {
    known = [],
    current = [],
    max = 5,
  }: { known?: readonly string[]; current?: readonly string[]; max?: number } = {}
): string[] {
  const have = normTags(current);
  const haveThemes = new Set(have.map((t) => themeOf(t)?.tag).filter(Boolean));
  const out: string[] = [];
  const add = (tag: string) => {
    const t = normTag(tag);
    if (!t || KIND_TAGS.has(t) || have.includes(t) || out.includes(t)) return;
    const theme = themeOf(t)?.tag;
    if (theme && (haveThemes.has(theme) || out.some((o) => themeOf(o)?.tag === theme))) return;
    out.push(t);
  };
  const words = withoutPrompts(text);
  for (const tag of normTags(known)) if (mentions(words, tag)) add(tag);
  for (const tag of keywordThemes(words)) add(tag);
  return out.slice(0, Math.max(0, max));
}

/**
 * A note's themes: its own tags (a hand-typed alias read as its theme) and
 * the themes its words point to, each once. Kind tags aren't themes.
 */
export function noteThemes(e: Pick<NotebookEntry, "title" | "body" | "tags">): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    if (t && !KIND_TAGS.has(t) && !out.includes(t)) out.push(t);
  };
  for (const tag of normTags(e.tags ?? [])) add(themeOf(tag)?.tag ?? tag);
  for (const tag of keywordThemes(`${e.title ?? ""}\n${e.body ?? ""}`)) add(tag);
  return out;
}

export interface ThemeCount {
  tag: string;
  /** Notes with the theme. */
  notes: number;
  /** The events those notes came from, as people read them, in order of first note. */
  events: string[];
}

/** How many notes each theme came up in, most first, then A to Z. */
export function themeCounts(
  entries: readonly Pick<NotebookEntry, "title" | "body" | "tags" | "event">[]
): ThemeCount[] {
  const counts = new Map<string, ThemeCount>();
  for (const e of entries) {
    const label = eventLabel(e.event);
    for (const tag of noteThemes(e)) {
      const c = counts.get(tag) ?? { tag, notes: 0, events: [] };
      c.notes += 1;
      if (label && !c.events.includes(label)) c.events.push(label);
      counts.set(tag, c);
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag)
  );
}
