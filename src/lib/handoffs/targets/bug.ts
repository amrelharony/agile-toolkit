/**
 * Hand-off target: a bug to triage (Bug Triage).
 *
 * A send logs a new bug report (workspace.bugReports) with the item's first
 * line as its title, its description as what happened, its product area and
 * who raised it, keeping where it came from (`sourceRef`: a test session's
 * note, meeting notes). It is done once the bug is closed. Bug Triage's
 * builder refines this file, keeping its exports.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { TOOL_TEXT_MAX, type BugReport } from "@/lib/stores/workspace-types";
import { BUG_ID_PREFIX } from "@/lib/bug-triage/ids";
import type { HandoffRoute, HandoffSource } from "../types";

/** A new bug id, as the workspace CRUD makes them. */
export const newBugId = (): string => `${BUG_ID_PREFIX}${nanoid(8)}`;

/** Where "Open" goes for a bug: Bug Triage, with that bug open. */
export function bugHref(id: string): string {
  return `/bug-triage?bug=${encodeURIComponent(id)}`;
}

/** Text on one line: runs of white space (line breaks too) become one space. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** `text` trimmed and cut to `max`, or undefined when blank. */
const capped = (text: string | undefined, max: number) => {
  const t = (text ?? "").trim().slice(0, max);
  return t === "" ? undefined : t;
};

/**
 * The bug a send logs: the title's first line as one line, the description
 * as what happened, the area and who raised it, new and untriaged.
 */
export function buildBugReport(
  src: HandoffSource,
  id: string = newBugId(),
  now: string = new Date().toISOString()
): BugReport {
  const firstLine = src.title.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const actual = capped(src.description, TOOL_TEXT_MAX.text);
  const area = capped(src.area, TOOL_TEXT_MAX.short);
  const reportedBy = capped(src.raisedBy, TOOL_TEXT_MAX.short);
  return {
    id,
    title: oneLine(firstLine).slice(0, TOOL_TEXT_MAX.short),
    ...(actual ? { actual } : {}),
    ...(area ? { area } : {}),
    ...(reportedBy ? { reportedBy } : {}),
    status: "new",
    sourceRef: src.sourceRef,
    createdAt: now,
    updatedAt: now,
  };
}

const find = (id: string) =>
  (useWorkspaceStore.getState().bugReports ?? []).find((b) => b.id === id);

export const bugRoute: HandoffRoute = {
  id: "bug",
  label: "Bug to triage",
  doneLabel: "Added to Bug Triage",
  targetToolId: "bug-triage",
  targetHref: bugHref,
  send: (src) => {
    const bug = buildBugReport(src);
    useWorkspaceStore.getState().upsertBugReport(bug);
    return bug.id;
  },
  remove: (id) => {
    if (find(id)) useWorkspaceStore.getState().removeBugReport(id);
  },
  exists: (id) => Boolean(find(id)),
  isDone: (id) => find(id)?.status === "closed",
};
