/**
 * Hand-off target: an interrupt in the running sprint (Interrupt Buffer).
 *
 * A send logs unplanned work (workspace.interruptItems) in the active sprint:
 * the item's title on one line, its kind as the source says or as the title
 * reads (`classifyInterrupt`), its points as its size, and whether it
 * couldn't wait, keeping where it came from (`sourceRef`: a bug fixed now).
 * With no sprint running there is nowhere to log it, so the route says so
 * (`problem`) and the send paths skip the item. It is done once resolved.
 * Bug Triage's builder refines this file, keeping its exports.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { TOOL_TEXT_MAX, type InterruptItem, type Sprint } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { INTERRUPT_SIZE_MAX, classifyInterrupt } from "@/lib/sprints/interrupts";
import type { HandoffRoute, HandoffSource } from "../types";

/** Why a send can't go: there is no active sprint to log it in. */
export const NO_SPRINT_RUNNING = "No sprint is running";

/** The sprint interrupts land in: the newest active one that isn't the example's. */
export function activeSprintOf(sprints: readonly Sprint[]): Sprint | undefined {
  return sprintsNewestFirst(sprints).find((s) => !isExampleId(s.id) && s.status === "active");
}

/** The interrupt a send logs in `sprintId`, now. */
export function buildInterruptItem(
  src: HandoffSource,
  sprintId: string,
  id: string = `interrupt_${nanoid(8)}`,
  now: string = new Date().toISOString()
): InterruptItem {
  const title = src.title.replace(/\s+/g, " ").trim().slice(0, TOOL_TEXT_MAX.text);
  const points = src.points;
  const size =
    typeof points === "number" && Number.isFinite(points)
      ? Math.min(INTERRUPT_SIZE_MAX, Math.max(0, points))
      : undefined;
  return {
    id,
    sprintId,
    title,
    kind: src.interrupt?.kind ?? classifyInterrupt(title).kind,
    ...(size !== undefined ? { size } : {}),
    emergency: src.interrupt?.emergency ?? false,
    loggedAt: now,
    sourceRef: src.sourceRef,
  };
}

const find = (id: string) =>
  (useWorkspaceStore.getState().interruptItems ?? []).find((i) => i.id === id);

/** The Interrupt Buffer for an interrupt's sprint (built here: sprintHref lives in a client module). */
function interruptHref(id: string): string {
  const sprintId = find(id)?.sprintId;
  return sprintId
    ? `/interrupt-buffer?sprint=${encodeURIComponent(sprintId)}`
    : "/interrupt-buffer";
}

const runningSprint = () => activeSprintOf(useWorkspaceStore.getState().sprints);

export const interruptRoute: HandoffRoute = {
  id: "interrupt",
  label: "Interrupt in this sprint",
  doneLabel: "Logged as an interrupt",
  targetToolId: "interrupt-buffer",
  targetHref: interruptHref,
  problem: () => (runningSprint() ? null : NO_SPRINT_RUNNING),
  send: (src) => {
    const sprint = runningSprint();
    if (!sprint) throw new Error(NO_SPRINT_RUNNING);
    const item = buildInterruptItem(src, sprint.id);
    useWorkspaceStore.getState().upsertInterruptItem(item);
    return item.id;
  },
  remove: (id) => {
    if (find(id)) useWorkspaceStore.getState().removeInterruptItem(id);
  },
  exists: (id) => Boolean(find(id)),
  isDone: (id) => Boolean(find(id)?.resolvedAt),
};
