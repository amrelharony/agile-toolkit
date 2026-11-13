/**
 * A story's four text fields: notes, acceptance criteria, the link to its
 * issue in the team's tracker, and its ticket key. One place for the caps,
 * the cleaning every write path runs (the workspace store, the agents'
 * `workspace.story.*`), the details form's validation, and the text Planning
 * Poker shows for a queued story.
 *
 * Pure, with no browser or store imports: the pages, the store and the MCP
 * server's actions all read it.
 */

import { nanoid } from "nanoid";
import type { Story, StoryGwt } from "@/lib/stores/workspace-types";
import { TOOL_LIST_MAX, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import type { Validation } from "@/lib/utils/form";

export const STORY_NOTES_MAX = 2000;
export const STORY_CRITERIA_MAX = 2000;
export const STORY_LINK_MAX = 500;
export const STORY_TICKET_KEY_MAX = 50;

export const STORY_TEXT_FIELDS = ["notes", "acceptanceCriteria", "link", "ticketKey"] as const;
export type StoryTextField = (typeof STORY_TEXT_FIELDS)[number];

/** The four fields on their own: what the details form edits. */
export type StoryDetails = Partial<Pick<Story, StoryTextField>>;

/** Several lines of text: line ends made "\n", outer blank space removed, capped (never through a character). */
function block(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = cutText(value.replace(/\r\n?/g, "\n").trim(), max).trimEnd();
  return text || undefined;
}

/** One line of text: runs of blank space become one space, capped (never through a character). */
function line(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = cutText(value.replace(/\s+/g, " ").trim(), max).trimEnd();
  return text || undefined;
}

// A blank or a control character has no place in a web address.
// eslint-disable-next-line no-control-regex
const NOT_IN_A_LINK = /[\s\u0000-\u001f\u007f]/;

/**
 * `value` as a story link, or undefined when it can't be one. Only an http
 * or https address with a host is kept, so the link is safe to put in an
 * `href`: "javascript:", "data:" and addresses with no scheme are refused.
 */
export function storyLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > STORY_LINK_MAX || NOT_IN_A_LINK.test(text)) return undefined;
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    const url = new URL(text);
    const web = url.protocol === "http:" || url.protocol === "https:";
    return web && url.hostname ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Text that arrived as a description (a backlog item's, a story-map card's), as notes. */
export function storyNotes(description: unknown): string | undefined {
  return block(description, STORY_NOTES_MAX);
}

function cleaned(story: StoryDetails): Record<StoryTextField, string | undefined> {
  return {
    notes: block(story.notes, STORY_NOTES_MAX),
    acceptanceCriteria: block(story.acceptanceCriteria, STORY_CRITERIA_MAX),
    link: storyLink(story.link),
    ticketKey: line(story.ticketKey, STORY_TICKET_KEY_MAX),
  };
}

/**
 * `story` with its four text fields cleaned: trimmed, capped, a link that
 * isn't http or https dropped, and no key left behind for an empty one. Its
 * Given/When/Then rows are cleaned too (`cleanGwt`). The same object when
 * there is nothing to clean, so a write that doesn't touch them costs
 * nothing. The last line of defence: forms say what is wrong before saving,
 * and the agents' schema rejects a bad value.
 */
export function cleanStoryFields<T extends StoryDetails & { gwt?: StoryGwt[] }>(story: T): T {
  const clean = cleaned(story);
  let out: T | undefined;
  for (const key of STORY_TEXT_FIELDS) {
    if (!(key in story)) continue;
    const value = clean[key];
    if (value !== undefined && story[key] === value) continue;
    out ??= { ...story };
    if (value === undefined) delete (out as StoryDetails)[key];
    else (out as StoryDetails)[key] = value;
  }
  if ("gwt" in story) {
    const gwt = cleanGwt(story.gwt);
    if (gwt === undefined || gwt !== story.gwt) {
      out ??= { ...story };
      if (gwt === undefined) delete out.gwt;
      else out.gwt = gwt;
    }
  }
  return out ?? story;
}

/* ── Given / When / Then ─────────────────────────────────────────────── */

/** Scenarios a story keeps, and the length of each part (the agents' schema caps). */
export const STORY_GWT_MAX = TOOL_LIST_MAX.gwt;
export const GWT_PART_MAX = TOOL_TEXT_MAX.text;

export const GWT_PARTS = ["given", "when", "then"] as const;
export type GwtPart = (typeof GWT_PARTS)[number];

/** One part as written: line ends made "\n", outer blank space gone, capped. */
function gwtPart(value: unknown): string {
  if (typeof value !== "string") return "";
  return cutText(value.replace(/\r\n?/g, "\n").trim(), GWT_PART_MAX).trimEnd();
}

/**
 * Given/When/Then rows as stored: each part trimmed and capped, a row with
 * no words in it dropped, a row with no id (or an id an earlier row has)
 * given a fresh one, and at most STORY_GWT_MAX rows. Undefined when none is
 * left (a story keeps no empty list). The same array when nothing changed.
 */
export function cleanGwt(value: unknown): StoryGwt[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: StoryGwt[] = [];
  let changed = false;
  for (const raw of value) {
    if (out.length >= STORY_GWT_MAX) {
      changed = true;
      break;
    }
    const row = (raw ?? {}) as Partial<StoryGwt>;
    const given = gwtPart(row.given);
    const when = gwtPart(row.when);
    const then = gwtPart(row.then);
    if (!given && !when && !then) {
      changed = true;
      continue;
    }
    let id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) id = newGwtId(seen);
    seen.add(id);
    const next: StoryGwt = { id, given, when, then };
    if (
      next.id !== row.id ||
      next.given !== row.given ||
      next.when !== row.when ||
      next.then !== row.then
    ) {
      changed = true;
      out.push(next);
    } else {
      out.push(raw as StoryGwt);
    }
  }
  if (out.length === 0) return undefined;
  return changed || out.length !== value.length ? out : (value as StoryGwt[]);
}

/** A short id no row in `taken` has: "gwt_k3f9a2". */
export function newGwtId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const id = `gwt_${nanoid(8)}`;
    if (!taken.has(id)) return id;
  }
}

/** Whether the story has any Given/When/Then row. */
export function hasStoryGwt(story: { gwt?: readonly StoryGwt[] }): boolean {
  return Array.isArray(story.gwt) && story.gwt.length > 0;
}

/** `story` with its rows set to `gwt` (cleaned); none left removes the key. */
export function withStoryGwt<T extends { gwt?: StoryGwt[] }>(
  story: T,
  gwt: readonly StoryGwt[] | undefined
): T {
  const next: T = { ...story };
  const clean = cleanGwt(gwt ? [...gwt] : undefined);
  if (clean === undefined) delete next.gwt;
  else next.gwt = clean;
  return next;
}

/** One row as a sentence: "Given a saved card, when I pay, then it is charged once." */
export function gwtSentence(row: Pick<StoryGwt, GwtPart>): string {
  const parts = [
    row.given.trim() && `Given ${row.given.trim()}`,
    row.when.trim() && `when ${row.when.trim()}`,
    row.then.trim() && `then ${row.then.trim()}`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return "";
  const text = parts.join(", ").replace(/\s+/g, " ");
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The rows as Gherkin-style lines, one part a line, scenarios apart by a blank line. */
export function gwtLines(gwt: readonly StoryGwt[] | undefined): string[] {
  const out: string[] = [];
  for (const row of gwt ?? []) {
    if (out.length > 0) out.push("");
    if (row.given.trim()) out.push(`Given ${row.given.trim().replace(/\s+/g, " ")}`);
    if (row.when.trim()) out.push(`When ${row.when.trim().replace(/\s+/g, " ")}`);
    if (row.then.trim()) out.push(`Then ${row.then.trim().replace(/\s+/g, " ")}`);
  }
  return out;
}

/** The rows in one cell of a CSV or a table: sentences joined by " | ". */
export function gwtCell(gwt: readonly StoryGwt[] | undefined): string {
  return (gwt ?? []).map(gwtSentence).filter(Boolean).join(" | ");
}

/** One scenario as typed in its form. */
export type GwtDraft = Record<GwtPart, string>;

export const EMPTY_GWT_DRAFT: GwtDraft = { given: "", when: "", then: "" };

const GWT_LABEL: Record<GwtPart, string> = { given: "Given", when: "When", then: "Then" };

/**
 * A scenario needs all three parts, each within its cap: the form says what
 * is missing instead of saving half a scenario.
 */
export function validateGwtDraft(draft: GwtDraft): Validation<GwtDraft, GwtPart> {
  const errors: Partial<Record<GwtPart, string>> = {};
  const values = {} as GwtDraft;
  for (const part of GWT_PARTS) {
    const text = draft[part].replace(/\r\n?/g, "\n").trim();
    if (!text) errors[part] = `Write the “${GWT_LABEL[part]}” part.`;
    else if (text.length > GWT_PART_MAX)
      errors[part] = tooLong(`the “${GWT_LABEL[part]}” part`, GWT_PART_MAX);
    values[part] = text;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values };
}

/** Whether the story has any of the four. */
export function hasStoryDetails(story: StoryDetails): boolean {
  return STORY_TEXT_FIELDS.some((key) => Boolean(story[key]?.trim()));
}

/** `story` with the four fields set to `details`: a field left out is removed. */
export function withStoryDetails<T extends StoryDetails>(story: T, details: StoryDetails): T {
  const next: T = { ...story };
  const clean = cleaned(details);
  for (const key of STORY_TEXT_FIELDS) {
    const value = clean[key];
    if (value === undefined) delete (next as StoryDetails)[key];
    else (next as StoryDetails)[key] = value;
  }
  return next;
}

/* ── The details form ────────────────────────────────────────────────── */

/** The four fields as typed. */
export type StoryDetailsDraft = Record<StoryTextField, string>;

export function storyDetailsDraft(story: StoryDetails): StoryDetailsDraft {
  return {
    notes: story.notes ?? "",
    acceptanceCriteria: story.acceptanceCriteria ?? "",
    link: story.link ?? "",
    ticketKey: story.ticketKey ?? "",
  };
}

const tooLong = (what: string, max: number) =>
  `Keep ${what} to ${max.toLocaleString("en-GB")} characters or fewer.`;

/**
 * Every field is optional. What is typed must fit its cap, and a link must
 * be an http or https address: the form says so instead of dropping it.
 */
export function validateStoryDetails(
  draft: StoryDetailsDraft
): Validation<StoryDetails, StoryTextField> {
  const errors: Partial<Record<StoryTextField, string>> = {};
  const notes = draft.notes.replace(/\r\n?/g, "\n").trim();
  const criteria = draft.acceptanceCriteria.replace(/\r\n?/g, "\n").trim();
  const link = draft.link.trim();
  const ticketKey = draft.ticketKey.replace(/\s+/g, " ").trim();
  if (notes.length > STORY_NOTES_MAX) errors.notes = tooLong("the notes", STORY_NOTES_MAX);
  if (criteria.length > STORY_CRITERIA_MAX) {
    errors.acceptanceCriteria = tooLong("the acceptance criteria", STORY_CRITERIA_MAX);
  }
  if (link.length > STORY_LINK_MAX) errors.link = tooLong("the link", STORY_LINK_MAX);
  else if (link && !storyLink(link)) {
    errors.link = "Enter a web address that starts with http:// or https://.";
  }
  if (ticketKey.length > STORY_TICKET_KEY_MAX) {
    errors.ticketKey = tooLong("the ticket key", STORY_TICKET_KEY_MAX);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      ...(notes ? { notes } : {}),
      ...(criteria ? { acceptanceCriteria: criteria } : {}),
      ...(link ? { link } : {}),
      ...(ticketKey ? { ticketKey } : {}),
    },
  };
}

/* ── Planning Poker ──────────────────────────────────────────────────── */

/**
 * What Planning Poker shows under a queued story's title: its notes, then
 * its acceptance criteria under their own heading. Folded into the one
 * description the session already carries, so the live room's payload and
 * its validator keep their shape. At most 4,023 characters, inside the
 * session's 5,000. A visitor live room has a size limit for the whole
 * session, so it shortens these when a long queue joins it
 * (planning-poker/visitor-session.ts `fitStoriesToVisitorRoom`).
 */
export function storyPokerDescription(story: StoryDetails): string | undefined {
  const notes = block(story.notes, STORY_NOTES_MAX);
  const criteria = block(story.acceptanceCriteria, STORY_CRITERIA_MAX);
  const parts = [notes, criteria ? `Acceptance criteria:\n${criteria}` : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
