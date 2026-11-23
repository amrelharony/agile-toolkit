/**
 * Test Sessions' export: the newest 20 sessions, each with its charter as a
 * sentence, the tester, the story, its length against the time it ran, the
 * debrief, its notes by kind (30 per session, then a count), and its bugs
 * with where they went. Capped, so a share link stays under the snapshot
 * limit.
 */

import type { BugReport, Story, TestSession } from "@/lib/stores/workspace-types";
import { TEST_NOTE_KINDS } from "@/lib/stores/workspace-types";
import {
  COVERAGE_LABEL,
  NOTE_KIND_LABEL,
  STATUS_LABEL,
  bugLinkOf,
  charterSentence,
  minutesInText,
  minutesRan,
  notesOfKind,
} from "@/lib/test-sessions/model";

/** At most this many sessions are listed, newest first. */
export const MARKDOWN_SESSIONS_MAX = 20;
/** At most this many notes per session; the rest are counted. */
export const MARKDOWN_NOTES_MAX = 30;

const oneLine = (v: string) => v.replace(/\s+/g, " ").trim();

/** Where a bug note went: "in Bug Triage (closed)". */
function bugPlace(bugs: ReadonlyMap<string, BugReport>, targetId: string): string {
  const bug = bugs.get(targetId);
  if (!bug) return "sent, since removed from Bug Triage";
  return bug.status === "closed" ? "in Bug Triage (closed)" : "in Bug Triage";
}

export function toMarkdown({
  sessions,
  stories,
  bugs,
  today,
}: {
  sessions: readonly TestSession[];
  stories: readonly Pick<Story, "id" | "title">[];
  bugs: readonly BugReport[];
  today: string;
}): string {
  const storyTitle = new Map(stories.map((s) => [s.id, s.title]));
  const bugById = new Map(bugs.map((b) => [b.id, b]));
  const out: string[] = [`# Test sessions — ${today}`, ""];
  const shown = sessions.slice(0, MARKDOWN_SESSIONS_MAX);
  for (const s of shown) {
    out.push(`## ${oneLine(charterSentence(s.charter))}`, "");
    const ran = minutesRan(s);
    out.push(
      `- Status: ${STATUS_LABEL[s.status]}`,
      ...(s.tester ? [`- Tester: ${oneLine(s.tester)}`] : []),
      ...(s.storyId && storyTitle.has(s.storyId)
        ? [`- Story: ${oneLine(storyTitle.get(s.storyId) ?? "")}`]
        : []),
      ...(s.area ? [`- Area: ${oneLine(s.area)}`] : []),
      `- Length: ${s.minutes} min${ran !== null ? `, ran ${ran} min` : ""}`,
      ...(s.coverage ? [`- Covered: ${COVERAGE_LABEL[s.coverage]}`] : []),
      ...(s.split
        ? [`- Time: testing ${s.split.testing}%, bugs ${s.split.bugs}%, setup ${s.split.setup}%`]
        : []),
      ...(s.debrief ? [`- Debrief: ${oneLine(s.debrief)}`] : []),
      ""
    );
    let listed = 0;
    for (const kind of TEST_NOTE_KINDS) {
      const notes = notesOfKind(s, kind);
      if (notes.length === 0 || listed >= MARKDOWN_NOTES_MAX) continue;
      out.push(`### ${NOTE_KIND_LABEL[kind]}s`, "");
      for (const n of notes) {
        if (listed >= MARKDOWN_NOTES_MAX) break;
        const when = minutesInText(n, s);
        const link = kind === "bug" ? bugLinkOf(n) : undefined;
        out.push(
          `- ${oneLine(n.text)}${when ? ` (${when})` : ""}${
            kind === "bug" ? ` — ${link ? bugPlace(bugById, link.targetId) : "not sent yet"}` : ""
          }`
        );
        listed += 1;
      }
      out.push("");
    }
    if (s.notes.length > listed) out.push(`And ${s.notes.length - listed} more notes.`, "");
  }
  if (sessions.length > shown.length) {
    out.push(`And ${sessions.length - shown.length} older sessions.`, "");
  }
  return out.join("\n").trimEnd() + "\n";
}

/** Every session as a CSV row, newest first. */
export function sessionsCsv(sessions: readonly TestSession[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: [
      "Charter",
      "Status",
      "Tester",
      "Area",
      "Minutes",
      "Ran (min)",
      "Covered",
      "Notes",
      "Bugs",
      "Planned",
    ],
    rows: sessions.map((s) => [
      charterSentence(s.charter),
      STATUS_LABEL[s.status],
      s.tester ?? "",
      s.area ?? "",
      s.minutes,
      minutesRan(s) ?? "",
      s.coverage ? COVERAGE_LABEL[s.coverage] : "",
      s.notes.length,
      notesOfKind(s, "bug").length,
      s.createdAt.slice(0, 10),
    ]),
  };
}
