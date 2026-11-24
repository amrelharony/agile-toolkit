/**
 * A persona drafted from research notes without AI: the Persona Library's
 * "Draft without AI", and the fallback of the persona-library.from_notes
 * task. Plain keyword rules over the notes' sentences:
 *
 *   - goals: sentences that say what someone wants or needs (want, need,
 *     hope, try to, so that);
 *   - frustrations: what gets in their way (frustrated, hard, slow, can't,
 *     confusing, waste, worry, stuck);
 *   - habits: what they do regularly (usually, every, often, daily,
 *     weekly, on my phone);
 *   - the role from "as a …" or "I'm a …";
 *   - the quote: the first quoted line, else the first frustration said in
 *     the first person;
 *   - tags: the words more than one sentence uses (Audience Wall's word
 *     cloud), leaving out the "Participant N" pseudonyms of interview notes;
 *   - a made-up first name from a built-in list, never one in `names`.
 *
 * Every string is cut to the draft's caps, so a draft always fits the
 * persona form. The page takes contact details out (redactPii) before the
 * notes reach this or the AI. Pure: no zod, no store, no React.
 */

import { PERSONA_TIERS, type PersonaTier } from "@/lib/stores/workspace-types";
import { wordCloud } from "@/lib/audience-wall/words";
import { hashSeed } from "@/lib/utils/random";

/** The notes a draft reads: at least a few words, at most 6,000 characters. */
export const PERSONA_NOTES_MIN = 20;
export const PERSONA_NOTES_MAX = 6000;
/** The names already used, which a draft avoids. */
export const PERSONA_NAMES_MAX = 30;
export const PERSONA_NAME_ITEM_MAX = 200;

/** A draft's caps: tighter than the CRUD's, so any draft fits the form. */
export const DRAFT_NAME_MAX = 60;
export const DRAFT_ROLE_MAX = 120;
export const DRAFT_SUMMARY_MAX = 300;
export const DRAFT_POINT_MAX = 200;
export const DRAFT_POINTS_MAX = 5;
export const DRAFT_QUOTE_MAX = 200;
export const DRAFT_CONTEXT_MAX = 500;
export const DRAFT_TAG_MAX = 40;
export const DRAFT_TAGS_MAX = 6;

/** What a draft asks for. */
export interface PersonaDraftInput {
  notes: string;
  tier: PersonaTier;
  /** Names already in the library, to avoid. */
  names: string[];
}

/** A drafted persona, before the person edits and saves it. */
export interface PersonaDraft {
  name: string;
  role: string;
  summary?: string;
  goals: string[];
  pains: string[];
  behaviours: string[];
  quote?: string;
  context?: string;
  tags: string[];
}

/** The role a draft gives when the notes don't say one. */
export const ROLE_TO_CONFIRM = "Role to confirm";

/** Made-up first names a draft picks from (none is anyone in particular). */
export const PERSONA_NAMES: readonly string[] = [
  "Ada",
  "Alex",
  "Amara",
  "Ari",
  "Bea",
  "Bo",
  "Cal",
  "Cleo",
  "Dana",
  "Dev",
  "Eli",
  "Elif",
  "Esme",
  "Femi",
  "Finn",
  "Gia",
  "Gus",
  "Hana",
  "Hugo",
  "Ines",
  "Isla",
  "Ivo",
  "Jade",
  "Kai",
  "Lena",
  "Leo",
  "Lior",
  "Mara",
  "Milo",
  "Nia",
  "Noor",
  "Omar",
  "Pia",
  "Quinn",
  "Rafa",
  "Rosa",
  "Sami",
  "Sana",
  "Tess",
  "Theo",
  "Uma",
  "Vera",
  "Wren",
  "Yara",
  "Yusuf",
  "Zane",
  "Zara",
];

const GOAL =
  /\b(?:want|wants|wanted|need|needs|needed|hope|hopes|hoping|try to|tries to|trying to|so that|would like)\b/i;
const PAIN =
  /(?:frustrat|\bhard\b|\bslow\b|\bcan'?t\b|\bcan’t\b|\bcannot\b|confus|\bwast|\bworr|\bstuck\b)/i;
const HABIT = /(?:\busually\b|\bevery\b|\boften\b|\bdaily\b|\bweekly\b|\bon my phone\b)/i;
const FIRST_PERSON = /(?:^|[^A-Za-z])(?:I|I'm|I’m|[Mm]y|[Mm]e)(?![A-Za-z])/;

/** Words after "as a" or "I'm a" that start a phrase, not a role ("as a result", "I'm a bit"). */
const NOT_A_ROLE = new Set([
  "bit",
  "little",
  "lot",
  "result",
  "rule",
  "whole",
  "matter",
  "bonus",
  "favour",
  "favor",
  "start",
  "test",
  "way",
]);
/** Words that are a role only with more after them ("as a team, we…", but "a team lead"). */
const NOT_A_ROLE_ALONE = new Set(["team", "group", "family", "company", "business"]);

/**
 * The pseudonyms interview notes carry (interviewNotes): a "Participant N:"
 * line opens each interview, and "Participant N" stands in for the
 * participant's own name in the text. Neither says anything about the
 * persona, so neither becomes a tag.
 */
const PSEUDONYM_HEAD = /^Participant \d+:$/i;
const PSEUDONYM = /\bParticipant \d+\b/gi;

/** `text` as one line cut to `max`. */
const cut = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

/** The notes as sentences: by line, then by sentence end, bullets and wrapping quotes stripped. */
export function noteSentences(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .flatMap((l) => l.split(/(?<=[.!?]["”’)]?)\s+/))
    .map((s) =>
      s
        .replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "")
        .replace(/^[\s"“”']+|[\s"“”']+$/g, "")
        .trim()
    )
    .filter((s) => s.length >= 4);
}

/** The role the notes give: "as a shift nurse" or "I'm a shift nurse"; null when none. */
export function roleFromNotes(notes: string): string | null {
  const patterns = [/\bI(?:'m|’m| am) an? ([^,.;:!?\n]{2,80})/i, /\bas an? ([^,.;:!?\n]{2,80})/i];
  for (const re of patterns) {
    const m = notes.match(re);
    if (!m) continue;
    // "a nurse and I work nights" and "a nurse on nights I plan…" → the role alone;
    // "a parent who works shifts" stays whole.
    const phrase = m[1].replace(/\s+(?:and|but|so|because|I|we|she|he|they)\b.*$/i, "").trim();
    const words = phrase.toLowerCase().split(/\s+/);
    if (!phrase || NOT_A_ROLE.has(words[0])) continue;
    if (words.length === 1 && NOT_A_ROLE_ALONE.has(words[0])) continue;
    const role = cut(phrase, DRAFT_ROLE_MAX);
    return role.charAt(0).toLocaleUpperCase("en") + role.slice(1);
  }
  return null;
}

/** The first quoted line in the notes (8 characters or more), or null. */
function quotedLine(notes: string): string | null {
  const m = notes.match(/["“]([^"”\n]{8,})["”]/);
  return m ? cut(m[1], DRAFT_QUOTE_MAX) : null;
}

/**
 * A made-up first name that isn't in `names` (any case): from the built-in
 * list, starting at a place the notes pick (so two drafts from different
 * notes rarely share one), else "Persona N".
 */
export function draftName(names: readonly string[], seed = ""): string {
  const taken = new Set(names.map((n) => n.trim().toLowerCase()));
  const start = hashSeed(seed) % PERSONA_NAMES.length;
  for (let k = 0; k < PERSONA_NAMES.length; k++) {
    const name = PERSONA_NAMES[(start + k) % PERSONA_NAMES.length];
    if (!taken.has(name.toLowerCase())) return name;
  }
  for (let n = names.length + 1; ; n++) {
    const name = `Persona ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** The sentences up to DRAFT_POINTS_MAX, each once, cut to a point's cap. */
function points(sentences: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    const p = cut(s, DRAFT_POINT_MAX);
    if (!p || seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    out.push(p);
    if (out.length >= DRAFT_POINTS_MAX) break;
  }
  return out;
}

/**
 * A persona from notes, without AI. Throws on what the task's schema
 * refuses (too little or too much text, an unknown tier, too many names),
 * rather than answer with a draft the schema would refuse.
 */
export function personaFromNotes(
  notes: string,
  tier: PersonaTier,
  names: readonly string[]
): PersonaDraft {
  const text = (notes ?? "").trim();
  if (text.length < PERSONA_NOTES_MIN)
    throw new Error("Add a few sentences of notes first (20 characters or more).");
  if (text.length > PERSONA_NOTES_MAX) throw new Error("Notes are capped at 6,000 characters.");
  if (!(PERSONA_TIERS as readonly string[]).includes(tier))
    throw new Error("Unknown persona tier.");
  if (names.length > PERSONA_NAMES_MAX || names.some((n) => n.length > PERSONA_NAME_ITEM_MAX))
    throw new Error("Too many names to avoid.");

  const sentences = noteSentences(text);
  const goals: string[] = [];
  const pains: string[] = [];
  const habits: string[] = [];
  // Each sentence counts once: a frustration first, then a goal, then a habit.
  for (const s of sentences) {
    if (PAIN.test(s)) pains.push(s);
    else if (GOAL.test(s)) goals.push(s);
    else if (HABIT.test(s)) habits.push(s);
  }

  const quote = quotedLine(text) ?? pains.find((s) => FIRST_PERSON.test(s)) ?? null;
  const tagText = sentences
    .filter((s) => !PSEUDONYM_HEAD.test(s))
    .map((s) => s.replace(PSEUDONYM, " "));
  const tags = wordCloud(tagText, { max: 40 })
    .filter((w) => w.count > 1 && w.word.length >= 3)
    .slice(0, DRAFT_TAGS_MAX)
    .map((w) => cut(w.word.toLowerCase(), DRAFT_TAG_MAX));

  const draft: PersonaDraft = {
    name: cut(draftName(names, text), DRAFT_NAME_MAX),
    role: roleFromNotes(text) ?? ROLE_TO_CONFIRM,
    goals: points(goals),
    pains: points(pains),
    behaviours: points(habits),
    tags,
  };
  if (quote) draft.quote = cut(quote, DRAFT_QUOTE_MAX);
  return draft;
}
