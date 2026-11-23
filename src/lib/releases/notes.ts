/**
 * Release notes from the stories a release ships: which done stories to
 * suggest linking (done since the previous ship, up to this one's ship day,
 * and not linked by another release), the template the notes start from
 * without AI (New, Fixed and Changed, each story's title cleaned, ticket
 * keys only for the team), the check on what AI drafts (no story it wasn't
 * given, every story covered), the text and the Markdown. A story is
 * classed by `storyKind` (lib/stories/kind), as Flow Insights classes it.
 * Pure and server-safe: the page and Amr's verbs read it.
 */

import {
  TOOL_TEXT_MAX,
  type Release,
  type ReleaseReadiness,
  type Story,
} from "@/lib/stores/workspace-types";
import { shipEvents } from "./model";
import { storyKind, type StoryKind } from "@/lib/stories/kind";
import { isExampleId } from "@/lib/utils/example-id";

/** At most this many stories go into one draft: the newest done. */
export const NOTES_STORIES_MAX = 40;
export const NOTES_HEADLINE_MAX = 120;
export const NOTES_INTRO_MAX = 400;
export const NOTES_SECTIONS_MAX = 4;
export const NOTES_SECTION_TITLE_MAX = 60;
export const NOTES_ITEMS_MAX = 10;
export const NOTES_ITEM_MAX = 160;
export const NOTES_ITEM_STORIES_MAX = 5;
export const NOTES_STORY_TITLE_MAX = 200;
export const NOTES_STORY_NOTES_MAX = 300;
export const NOTES_EPIC_MAX = 200;
export const NOTES_KEY_MAX = 50;
export const NOTES_ID_MAX = 64;
/** The saved notes' cap. */
export const NOTES_TEXT_MAX = TOOL_TEXT_MAX.releaseNotes;

export type NotesAudience = "customers" | "team";
export const NOTES_AUDIENCES = ["customers", "team"] as const satisfies readonly NotesAudience[];
export const AUDIENCE_LABEL: Record<NotesAudience, string> = {
  customers: "Customers",
  team: "The team",
};

/** The section each kind of story goes in, in this order. */
export const KIND_SECTION: Record<StoryKind, string> = {
  new: "New",
  fix: "Fixed",
  change: "Changed",
};
const KIND_ORDER: readonly StoryKind[] = ["new", "fix", "change"];
/** The template's section for stories the AI's draft left out. */
export const ALSO_SECTION = "Also in this release";

/** One story as a draft reads it. */
export interface NotesStory {
  id: string;
  title: string;
  notes?: string;
  epic?: string;
  kind: StoryKind;
  key?: string;
}

/** What a draft is made from. */
export interface NotesInput {
  release: string;
  /** YYYY-MM-DD: the ship day, or today for one not shipped yet. */
  date: string;
  audience: NotesAudience;
  rolledBack: boolean;
  stories: NotesStory[];
}

export interface NotesItem {
  text: string;
  storyIds: string[];
}
export interface NotesSection {
  title: string;
  items: NotesItem[];
}
/** A draft: a headline, a short intro, and up to four sections. */
export interface ReleaseNotesDraft {
  headline: string;
  intro: string;
  sections: NotesSection[];
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A timestamp's local day, the day the suggestions count by (and the page shows). */
export function localDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The ids a release links, as stored (deduplicated). */
export function linkedIds(release: Pick<Release, "storyIds">): string[] {
  return Array.isArray(release.storyIds)
    ? Array.from(new Set(release.storyIds.filter((id) => typeof id === "string")))
    : [];
}

/** Ids every other release links. */
export function otherLinkedIds(doc: ReleaseReadiness | undefined, releaseId: string): Set<string> {
  const out = new Set<string>();
  for (const r of doc?.releases ?? [])
    if (r.id !== releaseId) linkedIds(r).forEach((id) => out.add(id));
  return out;
}

/** The day a release ships for the notes: the day it went out, or today. */
export const shipDayOf = (release: Pick<Release, "shippedDate">, today: string) =>
  (release.shippedDate ?? "").slice(0, 10) || today;

/** The latest ship of any release before this one's ship day (this ship itself aside). */
export function previousShipDay(
  doc: ReleaseReadiness | undefined,
  release: Pick<Release, "id" | "shippedDate">,
  today: string
): string | undefined {
  const day = shipDayOf(release, today);
  const before = shipEvents(doc)
    .filter((e) => !(e.releaseId === release.id && e.shippedDate === release.shippedDate))
    .map((e) => e.shippedDate.slice(0, 10))
    .filter((d) => d < day);
  return before.length > 0 ? before.reduce((a, b) => (b > a ? b : a)) : undefined;
}

/**
 * The done stories to suggest linking: done since the previous ship, up to
 * this release's ship day (or today), not linked here or by another
 * release, and never an example story for a real release (an example
 * release takes the example's own). Newest done first; done stories with
 * no date go last.
 */
export function suggestReleaseStories(
  release: Release,
  doc: ReleaseReadiness | undefined,
  stories: readonly Story[],
  today: string
): Story[] {
  const mine = new Set(linkedIds(release));
  const others = otherLinkedIds(doc, release.id);
  const until = shipDayOf(release, today);
  const after = previousShipDay(doc, release, today);
  const exampleRelease = isExampleId(release.id);
  const candidates = stories.filter(
    (s) =>
      s.status === "done" &&
      isExampleId(s.id) === exampleRelease &&
      !mine.has(s.id) &&
      !others.has(s.id)
  );
  const dated = candidates
    .map((s) => ({ s, day: localDay(s.doneAt) }))
    .filter((x): x is { s: Story; day: string } => Boolean(x.day))
    .filter((x) => x.day <= until && (!after || x.day > after))
    .sort((a, b) => (b.s.doneAt ?? "").localeCompare(a.s.doneAt ?? ""))
    .map((x) => x.s);
  const undated = candidates.filter((s) => !localDay(s.doneAt));
  return [...dated, ...undated];
}

/** A release's linked stories, done and not yet. */
export function linkedStoriesOf(
  release: Pick<Release, "storyIds">,
  stories: readonly Story[]
): { done: Story[]; notDone: Story[]; missing: string[] } {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const done: Story[] = [];
  const notDone: Story[] = [];
  const missing: string[] = [];
  for (const id of linkedIds(release)) {
    const s = byId.get(id);
    if (!s) missing.push(id);
    else if (s.status === "done") done.push(s);
    else notDone.push(s);
  }
  return { done, notDone, missing };
}

/** A story's title as notes read it: no ticket key in front, one line, a capital first. */
export function cleanTitle(title: string): string {
  const t = title
    .replace(/^\s*\[?[A-Z][A-Z0-9]+-\d+\]?\s*[:\-–—]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title.trim();
}

/**
 * One linked story as a draft reads it: its cleaned title and kind, its
 * epic, its notes only when asked for, and its ticket key only for the team.
 */
export function notesStoryOf(
  story: Story,
  opts: { audience: NotesAudience; includeNotes: boolean; epicTitle?: string }
): NotesStory {
  const notes = opts.includeNotes ? (story.notes ?? "").trim() : "";
  const key = opts.audience === "team" ? (story.ticketKey ?? "").trim() : "";
  const epic = (opts.epicTitle ?? "").trim();
  return {
    id: story.id.slice(0, NOTES_ID_MAX),
    title: cut(cleanTitle(story.title || "Untitled story"), NOTES_STORY_TITLE_MAX),
    kind: storyKind(story),
    ...(notes ? { notes: cut(notes, NOTES_STORY_NOTES_MAX) } : {}),
    ...(epic ? { epic: cut(epic, NOTES_EPIC_MAX) } : {}),
    ...(key ? { key: cut(key, NOTES_KEY_MAX) } : {}),
  };
}

/** The newest done stories first, at most NOTES_STORIES_MAX. */
export function newestDone(stories: readonly Story[]): Story[] {
  return [...stories]
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))
    .slice(0, NOTES_STORIES_MAX);
}

/** A story's line in the template: its title, its key for the team. */
function storyLine(s: NotesStory, audience: NotesAudience): string {
  return audience === "team" && s.key ? `${s.title} (${s.key})` : s.title;
}

/**
 * The stories as at most ten items: one each, or, past ten, several to an
 * item (at most five), so a big release still fits the caps.
 */
function itemsFor(stories: readonly NotesStory[], audience: NotesAudience): NotesItem[] {
  const per = Math.min(
    NOTES_ITEM_STORIES_MAX,
    Math.max(1, Math.ceil(stories.length / NOTES_ITEMS_MAX))
  );
  const items: NotesItem[] = [];
  for (let i = 0; i < stories.length && items.length < NOTES_ITEMS_MAX; i += per) {
    const group = stories.slice(i, i + per);
    items.push({
      text: cut(group.map((s) => storyLine(s, audience)).join("; "), NOTES_ITEM_MAX),
      storyIds: group.map((s) => s.id),
    });
  }
  return items;
}

/**
 * The notes without AI: a headline, an intro that says how many stories of
 * each kind (and that the release was rolled back, when it was), then New,
 * Fixed and Changed. For the team, stories are grouped by epic within each
 * section and keep their ticket keys. A draft with no stories throws: the
 * schema refuses it.
 */
export function draftReleaseNotes(input: NotesInput): ReleaseNotesDraft {
  if (input.stories.length === 0) throw new Error("Link the stories it ships first.");
  const byKind = (k: StoryKind) => {
    const list = input.stories.filter((s) => s.kind === k);
    // For the team, by epic (stories with no epic last), keeping their order within one.
    return input.audience === "team"
      ? [...list].sort(
          (a, b) =>
            Number(a.epic === undefined) - Number(b.epic === undefined) ||
            (a.epic ?? "").localeCompare(b.epic ?? "")
        )
      : list;
  };
  const sections = KIND_ORDER.map((k) => ({
    title: KIND_SECTION[k],
    items: itemsFor(byKind(k), input.audience),
  })).filter((s) => s.items.length > 0);
  const counts = KIND_ORDER.map(
    (k) => [k, input.stories.filter((s) => s.kind === k).length] as const
  )
    .filter(([, n]) => n > 0)
    .map(([k, n]) =>
      k === "new"
        ? plural(n, "new thing", "new things")
        : k === "fix"
          ? plural(n, "fix", "fixes")
          : plural(n, "change")
    );
  const intro =
    input.audience === "customers"
      ? `Here is what's in ${input.release}: ${counts.join(", ")}.`
      : `${input.release} ships ${plural(input.stories.length, "story", "stories")}: ${counts.join(", ")}.`;
  return {
    headline: cut(`${input.release}: what's new`, NOTES_HEADLINE_MAX),
    intro: cut(
      input.rolledBack ? `${intro} It was rolled back; these notes say what it shipped.` : intro,
      NOTES_INTRO_MAX
    ),
    sections,
  };
}

/**
 * A draft checked against the stories it was given: unknown story ids go,
 * items left with none go, empty sections go, and the stories no item
 * covers come back from the template under "Also in this release", so
 * nothing is invented and nothing is lost.
 */
export function checkedDraft(draft: ReleaseNotesDraft, input: NotesInput): ReleaseNotesDraft {
  const known = new Set(input.stories.map((s) => s.id));
  const sections = draft.sections
    .map((s) => ({
      title: s.title,
      items: s.items
        .map((i) => ({ text: i.text, storyIds: i.storyIds.filter((id) => known.has(id)) }))
        .filter((i) => i.storyIds.length > 0 && i.text.trim() !== ""),
    }))
    .filter((s) => s.items.length > 0);
  const covered = (list: readonly NotesSection[]) =>
    new Set(list.flatMap((s) => s.items.flatMap((i) => i.storyIds)));
  if (input.stories.every((s) => covered(sections).has(s.id))) {
    return { ...draft, sections: sections.slice(0, NOTES_SECTIONS_MAX) };
  }
  const kept = sections.slice(0, NOTES_SECTIONS_MAX - 1);
  const left = input.stories.filter((s) => !covered(kept).has(s.id));
  return {
    ...draft,
    sections: [...kept, { title: ALSO_SECTION, items: itemsFor(left, input.audience) }],
  };
}

/** A draft as the text that is saved: the headline, the intro, then each section's items. */
export function draftText(draft: ReleaseNotesDraft): string {
  const parts = [draft.headline, "", draft.intro];
  for (const s of draft.sections) {
    parts.push("", s.title, ...s.items.map((i) => `- ${i.text}`));
  }
  return cut(parts.join("\n").trim(), NOTES_TEXT_MAX);
}

/**
 * The day notes were written for, when the release was reopened after
 * they were saved: the latest earlier ship's day; else null. A release
 * keeps no time for its reopen, so notes on a reopened release count as
 * the earlier ship's until they are saved on or after the day it shipped
 * again. Days are local, as ship days are.
 */
export function notesOutdatedFor(
  release: Pick<Release, "releaseNotes" | "previousShips" | "shippedDate">
): string | null {
  const notes = release.releaseNotes;
  const ships = release.previousShips ?? [];
  if (!notes || ships.length === 0) return null;
  const last = ships.map((s) => s.shippedDate.slice(0, 10)).reduce((a, b) => (b > a ? b : a));
  const current = release.shippedDate?.slice(0, 10);
  const written = localDay(notes.updatedAt);
  if (current && current >= last && written && written >= current) return null;
  return last;
}

/** One release's saved notes as a Markdown section. */
export function releaseNotesMarkdown(release: Pick<Release, "name" | "releaseNotes">): string {
  const notes = release.releaseNotes;
  if (!notes || !notes.text.trim()) return "";
  return [
    `## Release notes — ${release.name.replace(/\s*[\r\n]+\s*/g, " ").trim()}`,
    "",
    `_For ${notes.audience === "customers" ? "customers" : "the team"}._`,
    "",
    notes.text.trim(),
    "",
  ].join("\n");
}
