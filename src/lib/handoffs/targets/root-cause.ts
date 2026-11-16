/**
 * Hand-off target: a root-cause analysis.
 *
 * A send opens a new analysis in Root Cause (workspace.rootCauseAnalyses)
 * with the item's title as the problem's name and its description as the
 * problem, keeping where it came from (`sourceRef`). A contributing factor
 * from Post-Mortem also fills `postMortemId`, and a retro card
 * `retroBoardId`, so the analysis links back to the post-mortem or retro
 * it came from. The analysis starts on 5 Whys, empty: the team asks why.
 * It is done once it has a root cause and a countermeasure.
 *
 * The route id is "root-cause", registered in HANDOFF_ROUTES
 * (lib/handoffs/registry.ts), so sendHandoff and liveLink reach it too.
 * `openRootCause` is what a source that keeps no links of its own (a
 * post-mortem's contributing factors are plain strings) calls: it reuses
 * the analysis already made from the same item rather than opening a
 * second one, and its Undo removes a new one again.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffRef, RootCauseAnalysis } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { ROOT_CAUSE_ID_PREFIX, blankAnalysis, readAnalyses } from "@/lib/root-cause/model";
import type { HandoffRoute, HandoffSource } from "../types";

/** The route, typed to its own id (HANDOFF_ROUTES holds it under "root-cause"). */
export type RootCauseRoute = Omit<HandoffRoute, "id"> & { id: "root-cause" };

/** Where "Open" goes for an analysis: Root Cause, with that analysis open. */
export function rootCauseHref(id: string): string {
  return `/root-cause?analysis=${encodeURIComponent(id)}`;
}

/** A new analysis id, as the workspace CRUD makes them. */
export const newRootCauseId = (): string => `${ROOT_CAUSE_ID_PREFIX}${nanoid(8)}`;

/**
 * The analysis a send makes: the title names the problem, the description
 * (or the title) states it, and the source's own links ride along: a
 * post-mortem's id (its sourceRef `doc`) as `postMortemId`, a retro card's
 * board as `retroBoardId`.
 */
export function buildRootCauseAnalysis(
  src: HandoffSource,
  id: string = newRootCauseId(),
  now: string = new Date().toISOString()
): RootCauseAnalysis {
  const ref = src.sourceRef;
  return blankAnalysis(
    {
      title: src.title,
      problem: (src.description ?? "").trim() || src.title,
      sourceRef: ref,
      ...(ref.tool === "post-mortem" && ref.doc ? { postMortemId: ref.doc } : {}),
      ...(ref.tool === "retro" && ref.doc ? { retroBoardId: ref.doc } : {}),
    },
    id,
    now
  );
}

// A synced row can hold anything: read each one as Root Cause does.
const all = () => readAnalyses(useWorkspaceStore.getState().rootCauseAnalyses);
const find = (id: string) => all().find((a) => a.id === id);

/** Whether two refs name the same item (tool, item and document). */
export function sameRef(a: HandoffRef | undefined, b: HandoffRef): boolean {
  return Boolean(a && a.tool === b.tool && a.id === b.id && (a.doc ?? "") === (b.doc ?? ""));
}

/** The analysis already opened from `ref`, newest first, if any. */
export function analysisFrom(
  ref: HandoffRef,
  list: readonly RootCauseAnalysis[] = all()
): RootCauseAnalysis | undefined {
  return [...list]
    .filter((a) => sameRef(a.sourceRef, ref))
    .sort((x, y) => (y.updatedAt ?? "").localeCompare(x.updatedAt ?? ""))[0];
}

export const rootCauseRoute: RootCauseRoute = {
  id: "root-cause",
  label: "Root-cause analysis",
  // Said where the item was (Post-Mortem stays open): it was added, not opened.
  doneLabel: "Added to Root Cause",
  targetToolId: "root-cause",
  targetHref: rootCauseHref,
  send: (src) => {
    const analysis = buildRootCauseAnalysis(src);
    useWorkspaceStore.getState().upsertRootCauseAnalysis(analysis);
    return analysis.id;
  },
  remove: (id) => {
    if (find(id)) useWorkspaceStore.getState().removeRootCauseAnalysis(id);
  },
  exists: (id) => Boolean(find(id)),
  // Done once the team has named the root cause and agreed what to change.
  isDone: (id) => {
    const a = find(id);
    return Boolean(a?.rootCause?.trim() && a.countermeasure?.trim());
  },
};

/**
 * Open `src` in Root Cause: the analysis already made from the same item
 * (its sourceRef), or a new one, with Undo. Returns the analysis id and
 * whether it is new; null for a blank title.
 */
export function openRootCause(src: HandoffSource): { id: string; created: boolean } | null {
  if (!src.title.trim()) return null;
  const existing = analysisFrom(src.sourceRef);
  if (existing) return { id: existing.id, created: false };
  let id = "";
  undoable({
    label: rootCauseRoute.doneLabel,
    description: `“${src.title.trim().slice(0, 40)}”`,
    // Opening an analysis makes something new and destroys nothing.
    kind: "success",
    id: `handoff:root-cause:${nanoid(6)}`,
    apply: () => {
      id = rootCauseRoute.send(src);
    },
    revert: () => rootCauseRoute.remove(id),
  });
  return { id, created: true };
}
