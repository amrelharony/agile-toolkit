/**
 * Kickoff's AI task, the lite half pages import (no zod; the def, with its
 * schemas, is `kickoff.ts` and loads on first AI use):
 *   - kickoff.draft: lines for a kickoff's sections from its title and a
 *     short brief, with the Product Goal and the vision as context, and for
 *     Inception and Trade-offs a few more trade-offs that could give way.
 *
 * Without AI, `kickoffDraftFallback` answers: the brief's first sentence in
 * the format's lead section, then each section's starter line with
 * [brackets] to fill in, and the suggested extra sliders.
 *
 * The input is built from the kickoff here, and never holds a name: no
 * participant, no owner and no line of the team's people. At its caps (200
 * + 2,000 + 1,000 + 2,000 characters, 60 existing lines of 200 and 8 slider
 * labels of 60) it is about 17,700 characters, about 53 KB in 3-byte text,
 * under TOOL_AI_BODY_BUDGET (a golden test checks), so it needs no fitter.
 */

import { lazyAiTask } from "../task-ref";
import {
  KICKOFF_FORMAT_DEFS,
  PEOPLE_SECTION,
  SUGGESTED_SLIDERS,
  kickoffFormat,
} from "@/lib/kickoff/formats";
import { cutLine, oneLine, orderedSliders } from "@/lib/kickoff/model";
import { lineKey } from "@/lib/sectioned/model";
import { KICKOFF_BRIEF_MAX, TOOL_LIST_MAX, type Kickoff } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import type { KickoffDraftInput, KickoffDraftOutput } from "./kickoff";
export type { KickoffDraftInput, KickoffDraftOutput } from "./kickoff";

/* ── Caps ─────────────────────────────────────────────────────────── */

export const KICKOFF_DRAFT_TITLE_MAX = 200;
export const KICKOFF_DRAFT_BRIEF_MAX = KICKOFF_BRIEF_MAX;
export const KICKOFF_DRAFT_GOAL_MAX = 1000;
export const KICKOFF_DRAFT_VISION_MAX = 2000;
/** What's already there: the first lines of each section, so the draft doesn't repeat them. */
export const KICKOFF_DRAFT_EXISTING_MAX = 60;
export const KICKOFF_DRAFT_EXISTING_PER_SECTION = 6;
export const KICKOFF_DRAFT_EXISTING_LINE_MAX = 200;
/** The sliders already on the list (Inception and Trade-offs). */
export const KICKOFF_DRAFT_SLIDERS_IN_MAX = TOOL_LIST_MAX.kickoffSliders;
export const KICKOFF_DRAFT_SLIDER_MAX = 60;
/** What comes back. */
export const KICKOFF_DRAFT_ITEMS_MAX = 40;
export const KICKOFF_DRAFT_SECTION_MAX = 32;
export const KICKOFF_DRAFT_LINE_OUT_MAX = 200;
export const KICKOFF_DRAFT_SLIDERS_OUT_MAX = 4;

/* ── Building the input ───────────────────────────────────────────── */

export interface KickoffDraftContext {
  /** The active Product Goal's statement. */
  goal?: string;
  /** The product vision (Product Goal's page). */
  vision?: string;
}

/**
 * The draft's input from a kickoff: its format, title and brief, the goal
 * and the vision, the first six lines of each section in the format's
 * order (never the team's people), and the slider labels. Names, owners
 * and participants never go.
 */
export function kickoffDraftInputFor(k: Kickoff, ctx: KickoffDraftContext = {}): KickoffDraftInput {
  const format = KICKOFF_FORMAT_DEFS[k.format];
  const existing: string[] = [];
  for (const def of format.sections) {
    if (def.id === PEOPLE_SECTION) continue;
    const lines = (k.sections[def.id] ?? [])
      .map((i) => cutLine(i.text, KICKOFF_DRAFT_EXISTING_LINE_MAX))
      .filter(Boolean)
      .slice(0, KICKOFF_DRAFT_EXISTING_PER_SECTION);
    for (const line of lines) {
      if (existing.length >= KICKOFF_DRAFT_EXISTING_MAX) break;
      existing.push(line);
    }
  }
  const title = cutLine(k.title, KICKOFF_DRAFT_TITLE_MAX) || format.name;
  const goal = cutLine(ctx.goal ?? "", KICKOFF_DRAFT_GOAL_MAX);
  const vision = cutLine(ctx.vision ?? "", KICKOFF_DRAFT_VISION_MAX);
  const input: KickoffDraftInput = {
    format: k.format,
    title,
    brief: cutText((k.brief ?? "").trim(), KICKOFF_DRAFT_BRIEF_MAX).trim(),
    existing,
  };
  if (goal) input.goal = goal;
  if (vision) input.vision = vision;
  if (format.hasSliders) {
    input.sliders = orderedSliders(k)
      .map((s) => cutLine(s.label, KICKOFF_DRAFT_SLIDER_MAX))
      .filter(Boolean)
      .slice(0, KICKOFF_DRAFT_SLIDERS_IN_MAX);
  }
  return input;
}

/* ── The answer without AI ────────────────────────────────────────── */

/** The brief's first sentence, as one line ("" with no brief). */
export function firstSentence(brief: string): string {
  const text = oneLine(brief);
  if (!text) return "";
  return (text.split(/(?<=[.!?])\s/)[0] ?? "").trim();
}

/**
 * The draft without AI: the brief's first sentence in the lead section
 * (when there is a brief), then each section's starter line that isn't
 * there yet (never the team's people), at most 40; for Inception and
 * Trade-offs, the suggested extra sliders not on the list yet. A format
 * the catalog doesn't have throws: there is nothing to answer it with.
 */
export function kickoffDraftFallback(i: KickoffDraftInput): KickoffDraftOutput {
  const format = kickoffFormat(i.format);
  if (!format) throw new Error(`Kickoff has no "${String(i.format)}" format.`);
  const have = new Set(i.existing.map(lineKey));
  const items: KickoffDraftOutput["items"] = [];
  const sentence = cutLine(firstSentence(i.brief), KICKOFF_DRAFT_LINE_OUT_MAX);
  const lead = format.sections.find((d) => d.id === format.lead);
  let leadFilled = false;
  if (sentence && lead && lead.id !== PEOPLE_SECTION && !have.has(lineKey(sentence))) {
    items.push({ section: lead.id, text: sentence });
    leadFilled = lead.kind !== "list";
  }
  for (const def of format.sections) {
    if (def.id === PEOPLE_SECTION || !def.starter) continue;
    if (leadFilled && def.id === format.lead) continue;
    if (have.has(lineKey(def.starter))) continue;
    items.push({ section: def.id, text: cutLine(def.starter, KICKOFF_DRAFT_LINE_OUT_MAX) });
  }
  const out: KickoffDraftOutput = { items: items.slice(0, KICKOFF_DRAFT_ITEMS_MAX) };
  if (format.hasSliders) {
    const on = new Set((i.sliders ?? []).map(lineKey));
    const extra = SUGGESTED_SLIDERS.filter((s) => !on.has(lineKey(s))).slice(
      0,
      KICKOFF_DRAFT_SLIDERS_OUT_MAX
    );
    if (extra.length > 0) out.sliders = extra;
  }
  return out;
}

/* ── The ref ──────────────────────────────────────────────────────── */

export const kickoffDraftTask = lazyAiTask<KickoffDraftInput, KickoffDraftOutput>(
  { id: "kickoff.draft", toolId: "kickoff", fallback: kickoffDraftFallback },
  () => import("./kickoff").then((m) => m.kickoffDraftTask)
);
