/**
 * Sprint Planning's "Import from Jira (CSV)": what a Jira Cloud CSV export
 * would add to the backlog, which stories' points it would change, and
 * what it leaves out and why, before anything is saved. Pure.
 *
 * - The export is read by the one Jira reader (lib/jira/csv-export.ts),
 *   built against Atlassian's documented export format; no live Jira site
 *   was checked. Files from other trackers may work: untested.
 * - Each issue becomes a backlog story: its summary the title (cut to 200
 *   characters, as a typed one), its points, its assignee the owner, its
 *   key the ticket key, the first 500 characters of its description the
 *   notes, and, when the team typed its Jira site address, a link to the
 *   issue (https://<site>/browse/<KEY>). No status is mapped: every story
 *   lands in the backlog.
 * - An issue whose key a story already has (matched in upper case) isn't
 *   added again. Importing the export again changes points only: a story
 *   takes the export's points when they differ, unless the export has none
 *   for it or it is done (its points were counted with its sprint).
 */

import type { Story } from "@/lib/stores/workspace-types";
import {
  JIRA_SOURCE_TOOL,
  jiraKeyMatch,
  readJiraCsv,
  type JiraColumn,
  type JiraRowError,
} from "@/lib/jira/csv-export";
import { STORY_TICKET_KEY_MAX, storyLink, storyNotes } from "@/lib/stories/fields";
import { storedBytes } from "@/lib/stores/storage-room";
import { fmt, storiesCount } from "./view";

/** The most of an issue's description a story keeps as its notes. */
export const JIRA_NOTES_MAX = 500;

/** A story title's limit, as in the add form. */
const TITLE_MAX = 200;

/** A new story the import adds to the backlog. */
export interface JiraNewStory {
  /** The line of the file its row starts on. */
  line: number;
  key: string;
  title: string;
  points?: number;
  owner?: string;
  notes?: string;
  link?: string;
}

/** A story already here whose points the import changes. */
export interface JiraPointsChange {
  line: number;
  key: string;
  storyId: string;
  title: string;
  /** Its points before (absent: not sized). */
  from?: number;
  to: number;
}

/** A row whose story is already here and stays as it is. */
export interface JiraAlreadyHere {
  line: number;
  key: string;
  title: string;
  why: string;
}

export interface JiraImportPreview {
  /** The file's columns that make part of a story, and what each becomes. */
  mapped: { header: string; becomes: string }[];
  /** Columns the reader knows that this import leaves out, and why. */
  unused: { header: string; why: string }[];
  /** Every other column, as the file names it. */
  ignored: string[];
  add: JiraNewStory[];
  update: JiraPointsChange[];
  unchanged: JiraAlreadyHere[];
  /** Rows that can't be imported, and why. */
  errors: JiraRowError[];
  /** Data rows read (after the header, up to the reader's cap). */
  rows: number;
  /** Data rows past the cap, not read. */
  overCap: number;
  /** Why nothing can be read at all, or null. */
  problem: string | null;
  /** New stories whose title was cut to 200 characters. */
  titlesCut: number;
  /** New stories whose notes keep only the first 500 characters of the description. */
  notesCut: number;
}

const EMPTY: JiraImportPreview = {
  mapped: [],
  unused: [],
  ignored: [],
  add: [],
  update: [],
  unchanged: [],
  errors: [],
  rows: 0,
  overCap: 0,
  problem: null,
  titlesCut: 0,
  notesCut: 0,
};

/** What each known column becomes in a story here (the key's depends on the site). */
const BECOMES: Partial<Record<JiraColumn, string>> = {
  summary: "the title",
  points: "the points",
  assignee: "the owner",
  description: `the notes, its first ${JIRA_NOTES_MAX} characters`,
};

/** Why each known column that makes no part of a story is left out. */
const NOT_USED: Partial<Record<JiraColumn, string>> = {
  status: "not used, since every story lands in the backlog",
  priority: "not used, since the backlog keeps its own order",
  labels: "not used",
  dueDate: "not used",
};

/** "1 row", "3 rows" */
export const rowsText = (n: number) => (n === 1 ? "1 row" : `${n} rows`);

/** A long cell, short enough to name in a message. */
const clip = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/* ── The site address ────────────────────────────────────────────────── */

export type JiraSiteRead = { ok: true; site: string | null } | { ok: false; error: string };

/**
 * The typed Jira site address as the start of an issue link
 * ("https://your-team.atlassian.net"), null when it is blank, or why it
 * can't be used. https only: "http://" is refused, and an address with no
 * scheme is taken as https. A link to any page of the site (a board, an
 * issue) gives the site itself.
 */
export function readJiraSite(raw: string): JiraSiteRead {
  const text = raw.trim();
  if (!text) return { ok: true, site: null };
  const example = "such as your-team.atlassian.net";
  if (/^http:\/\//i.test(text)) {
    return { ok: false, error: `Use the site's https address, ${example}.` };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: `Enter your Jira site's address, ${example}.` };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: `Use the site's https address, ${example}.` };
  }
  if (/\s/.test(text) || !url.hostname.includes(".") || url.username || url.password) {
    return { ok: false, error: `Enter your Jira site's address, ${example}.` };
  }
  return { ok: true, site: url.origin };
}

/**
 * The site address an earlier import linked stories to, as the user types
 * it ("your-team.atlassian.net"), so importing again needs no retyping. ""
 * when no story links to an issue that way.
 */
export function jiraSiteFrom(stories: readonly Story[]): string {
  for (let i = stories.length - 1; i >= 0; i--) {
    const { link, ticketKey } = stories[i];
    if (!link || !ticketKey) continue;
    try {
      const url = new URL(link);
      if (
        url.protocol === "https:" &&
        url.pathname === `/browse/${encodeURIComponent(ticketKey)}`
      ) {
        return url.host;
      }
    } catch {
      // Not a web address: no site in it.
    }
  }
  return "";
}

/** The link to issue `key` on `site` (from readJiraSite), when it makes a valid story link. */
export function jiraIssueLink(site: string, key: string): string | undefined {
  return storyLink(`${site}/browse/${encodeURIComponent(key)}`);
}

/* ── The preview ─────────────────────────────────────────────────────── */

/**
 * What importing the export in `text` would do, against the `stories` the
 * workspace holds now. `site` is the Jira site (readJiraSite), for links;
 * null leaves the stories without one.
 */
export function previewJiraImport(
  text: string,
  { stories, site }: { stories: readonly Story[]; site: string | null }
): JiraImportPreview {
  const read = readJiraCsv(text);
  const mapped: JiraImportPreview["mapped"] = [];
  const unused: JiraImportPreview["unused"] = [];
  for (const { column, header } of read.found) {
    if (column === "key") {
      mapped.push({
        header,
        becomes: site
          ? "the ticket key, and the link to the issue"
          : "the ticket key. Add your site address below for a link to the issue.",
      });
    } else if (BECOMES[column]) {
      mapped.push({ header, becomes: BECOMES[column] });
    } else {
      unused.push({ header, why: NOT_USED[column] ?? "not used" });
    }
  }
  const ignored = read.ignored.map(({ header, count }) =>
    count > 1 ? `${header} (${count} columns)` : header
  );
  const base: JiraImportPreview = {
    ...EMPTY,
    mapped,
    unused,
    ignored,
    rows: read.rows,
    overCap: read.overCap,
    problem: read.problem,
  };
  if (read.problem) return base;

  // The first story with a key stands for it.
  const byKey = new Map<string, Story>();
  for (const story of stories) {
    const key = story.ticketKey?.trim();
    if (key && !byKey.has(jiraKeyMatch(key))) byKey.set(jiraKeyMatch(key), story);
  }

  const add: JiraNewStory[] = [];
  const update: JiraPointsChange[] = [];
  const unchanged: JiraAlreadyHere[] = [];
  const errors: JiraRowError[] = [...read.errors];
  let titlesCut = 0;
  let notesCut = 0;
  for (const issue of read.issues) {
    const { line, key, storyPoints } = issue;
    if (key.length > STORY_TICKET_KEY_MAX) {
      errors.push({
        line,
        reason: `the issue key “${clip(key)}” is longer than ${STORY_TICKET_KEY_MAX} characters`,
      });
      continue;
    }
    const here = byKey.get(jiraKeyMatch(key));
    if (here) {
      const same = { line, key, title: here.title };
      if (here.status === "done") {
        unchanged.push({ ...same, why: "done, so its points stay as its sprint counted them" });
      } else if (storyPoints === undefined) {
        unchanged.push({ ...same, why: "no points in the file" });
      } else if (here.points === storyPoints) {
        unchanged.push({ ...same, why: "same points" });
      } else {
        update.push({
          ...same,
          storyId: here.id,
          ...(here.points !== undefined ? { from: here.points } : {}),
          to: storyPoints,
        });
      }
      continue;
    }
    const title = issue.summary.slice(0, TITLE_MAX).trimEnd();
    if (issue.summary.length > TITLE_MAX) titlesCut += 1;
    const description = (issue.description ?? "").replace(/\r\n?/g, "\n").trim();
    if (description.length > JIRA_NOTES_MAX) notesCut += 1;
    const notes = storyNotes(description.slice(0, JIRA_NOTES_MAX));
    const link = site ? jiraIssueLink(site, key) : undefined;
    add.push({
      line,
      key,
      title,
      ...(storyPoints !== undefined ? { points: storyPoints } : {}),
      ...(issue.assignee ? { owner: issue.assignee } : {}),
      ...(notes ? { notes } : {}),
      ...(link ? { link } : {}),
    });
  }
  errors.sort((a, b) => a.line - b.line);
  return { ...base, add, update, unchanged, errors, titlesCut, notesCut };
}

/** The stories the preview's new rows become, in file order, each in the backlog. */
export function jiraStories(add: readonly JiraNewStory[], newId: () => string): Story[] {
  return add.map((row) => ({
    id: newId(),
    title: row.title,
    status: "backlog" as const,
    ticketKey: row.key,
    sourceRef: { tool: JIRA_SOURCE_TOOL, id: row.key },
    ...(row.points !== undefined ? { points: row.points } : {}),
    ...(row.owner ? { owner: row.owner } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.link ? { link: row.link } : {}),
  }));
}

/** Room for the stamps the store adds to each new story (its createdAt), counted as stored. */
const STAMP_BYTES = 100;

/** About what the new stories add to the browser's storage, counted as the store saves them. */
export function jiraImportBytes(preview: Pick<JiraImportPreview, "add">): number {
  if (preview.add.length === 0) return 0;
  const sample = jiraStories(preview.add, () => "story_00000000");
  return storedBytes(JSON.stringify(sample)) + preview.add.length * STAMP_BYTES;
}

/* ── Words ───────────────────────────────────────────────────────────── */

/** What the import will do, said under the box. "" before there is anything to read. */
export function jiraImportSummary(p: JiraImportPreview): string {
  if (p.problem) return "";
  const add = p.add.length;
  const update = p.update.length;
  const kept = p.unchanged.length;
  const bad = p.errors.length;
  if (add + update + kept + bad === 0) {
    return p.rows === 0 && p.mapped.length > 0 ? "No issues under the header row yet." : "";
  }
  const parts = [add > 0 ? `${storiesCount(add)} to add to the backlog.` : "No new stories."];
  if (update > 0) parts.push(`Points change on ${storiesCount(update)} already here.`);
  if (kept > 0) {
    parts.push(
      kept === 1
        ? "1 story already here stays as it is."
        : `${storiesCount(kept)} already here stay as they are.`
    );
  }
  if (bad > 0) parts.push(`${rowsText(bad)} can't be imported.`);
  if (p.titlesCut > 0) {
    parts.push(
      `${p.titlesCut} ${p.titlesCut === 1 ? "title is" : "titles are"} longer than ${TITLE_MAX} characters and will be cut.`
    );
  }
  if (p.notesCut > 0) {
    parts.push(
      `${p.notesCut} ${p.notesCut === 1 ? "description is" : "descriptions are"} longer than ${JIRA_NOTES_MAX} characters: the notes keep the first ${JIRA_NOTES_MAX}.`
    );
  }
  return parts.join(" ");
}

/** The import button: what clicking it does. */
export function jiraImportLabel(p: Pick<JiraImportPreview, "add" | "update">): string {
  const add = p.add.length;
  const update = p.update.length;
  if (add > 0 && update > 0) return `Import ${storiesCount(add)}, update ${update}`;
  if (add > 0) return `Import ${storiesCount(add)}`;
  if (update > 0) return `Update points on ${storiesCount(update)}`;
  return "Import";
}

/** "PAY-12 “Pay with a saved card”: 3 to 5 points" */
export function pointsChangeText(c: JiraPointsChange): string {
  const from = c.from === undefined ? "not sized" : fmt(c.from);
  return `${c.key} “${c.title}”: ${from} to ${fmt(c.to)} ${c.to === 1 ? "point" : "points"}`;
}

/** The Undo toast after an import of `added` new stories and `updated` points changes. */
export function jiraImportToast(
  added: number,
  updated: number
): { label: string; description?: string } {
  if (added === 0) {
    return { label: `Updated points on ${storiesCount(updated)} from the Jira CSV` };
  }
  return {
    label: `Added ${storiesCount(added)} to the backlog from the Jira CSV`,
    ...(updated > 0
      ? { description: `Points changed on ${storiesCount(updated)} already here.` }
      : {}),
  };
}
