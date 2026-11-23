/**
 * Bug Triage's export: the grid as a table of counts, the open bugs by cell
 * (capped, so a share link stays under the snapshot limit), the queue, and
 * the bugs closed in the last 30 days by reason. The CSV lists every bug,
 * for importing into a tracker.
 */

import { localDay } from "@/lib/sprints/series";
import type { BugReport } from "@/lib/stores/workspace-types";
import { BUG_CLOSE_REASONS, BUG_PRIORITIES, BUG_SEVERITIES } from "@/lib/stores/workspace-types";
import {
  CLOSE_REASON_LABEL,
  PRIORITY_LABEL,
  ROUTE_PLACE,
  SEVERITY_LABEL,
  STATUS_LABEL,
  ageDays,
  bugLinks,
  cellOf,
  fixByDay,
  gridCounts,
  isBugRoute,
  oneLine,
  overTarget,
  triageQueue,
  type BugLinkSlices,
  type BugRoute,
  type LinkState,
} from "@/lib/bug-triage/model";

/** At most this many open bugs are listed; the rest are counted. */
export const MARKDOWN_BUGS_MAX = 100;
/** Closed bugs from this many days back are counted by reason. */
export const CLOSED_WINDOW_DAYS = 30;

const STATE_WORD: Readonly<Record<LinkState, string>> = {
  live: "there",
  done: "done",
  gone: "gone",
};

/** A table cell or list line: one line, pipes escaped. */
const cell = (v: string) => oneLine(v).replace(/\|/g, "\\|");

/** Where a bug went, in words: "the backlog (done)". */
export function wentText(bug: BugReport, slices: BugLinkSlices): string {
  return bugLinks(bug, slices)
    .filter(({ link }) => isBugRoute(link.route))
    .map(({ link, state }) => `${ROUTE_PLACE[link.route as BugRoute]} (${STATE_WORD[state]})`)
    .join(", ");
}

function bugLine(bug: BugReport, slices: BugLinkSlices, today: string): string {
  const age = ageDays(bug, today);
  const went = wentText(bug, slices);
  return [
    `- ${cell(bug.title)}`,
    bug.severity ? ` — ${SEVERITY_LABEL[bug.severity]}` : "",
    bug.priority ? ` × ${PRIORITY_LABEL[bug.priority]}` : "",
    `, ${age === 1 ? "1 day" : `${age} days`} old`,
    overTarget(bug, today) ? ", over target" : "",
    went ? `, went to ${went}` : "",
  ].join("");
}

export function toMarkdown({
  bugs,
  slices,
  today,
}: {
  bugs: readonly BugReport[];
  slices: BugLinkSlices;
  today: string;
}): string {
  const out: string[] = [`# Bug triage — ${today}`, ""];
  const grid = gridCounts(bugs);
  out.push(
    "## The grid (open bugs)",
    "",
    `| Severity | ${BUG_PRIORITIES.map((p) => PRIORITY_LABEL[p]).join(" | ")} |`,
    `|---|${BUG_PRIORITIES.map(() => "---:").join("|")}|`,
    ...BUG_SEVERITIES.map(
      (s) => `| ${SEVERITY_LABEL[s]} | ${BUG_PRIORITIES.map((p) => grid[s][p]).join(" | ")} |`
    ),
    ""
  );

  const queue = triageQueue(bugs);
  const placed: BugReport[] = [];
  for (const s of BUG_SEVERITIES) {
    for (const p of BUG_PRIORITIES) {
      placed.push(...bugs.filter((b) => cellOf(b)?.severity === s && cellOf(b)?.priority === p));
    }
  }
  const open = [...placed, ...queue];
  let listed = 0;
  const listCapped = (title: string, list: BugReport[]) => {
    if (list.length === 0) return;
    out.push(`## ${title} (${list.length})`, "");
    for (const b of list) {
      if (listed >= MARKDOWN_BUGS_MAX) break;
      out.push(bugLine(b, slices, today));
      listed += 1;
    }
    out.push("");
  };
  listCapped("On the grid", placed);
  listCapped("To triage", queue);
  if (open.length > listed) out.push(`And ${open.length - listed} more open bugs.`, "");

  const closedSince = BUG_CLOSE_REASONS.map((r) => ({
    reason: r,
    n: bugs.filter(
      (b) =>
        b.status === "closed" &&
        b.closeReason === r &&
        ageDays({ createdAt: b.closedAt ?? b.updatedAt }, today) <= CLOSED_WINDOW_DAYS
    ).length,
  })).filter((x) => x.n > 0);
  if (closedSince.length > 0) {
    out.push(
      `## Closed in the last ${CLOSED_WINDOW_DAYS} days`,
      "",
      ...closedSince.map((x) => `- ${CLOSE_REASON_LABEL[x.reason]}: ${x.n}`),
      ""
    );
  }
  return out.join("\n").trimEnd() + "\n";
}

/** Every bug as a CSV row, oldest first, for a tracker's import. */
export function bugsCsv(
  bugs: readonly BugReport[],
  slices: BugLinkSlices,
  today: string
): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: [
      "Title",
      "Status",
      "Severity",
      "Priority",
      "Area",
      "Reported by",
      "Age (days)",
      "Fix by",
      "Over target",
      "Went to",
      "Close reason",
      "Logged",
    ],
    rows: bugs.map((b) => [
      b.title,
      STATUS_LABEL[b.status],
      b.severity ? SEVERITY_LABEL[b.severity] : "",
      b.priority ? PRIORITY_LABEL[b.priority] : "",
      b.area ?? "",
      b.reportedBy ?? "",
      ageDays(b, today),
      fixByDay(b) ?? "",
      overTarget(b, today) ? "yes" : "",
      wentText(b, slices),
      b.closeReason ? CLOSE_REASON_LABEL[b.closeReason] : "",
      // The day it was logged where the person is, as its age counts it.
      localDay(b.createdAt) ?? "",
    ]),
  };
}
