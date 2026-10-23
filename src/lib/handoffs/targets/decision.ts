/**
 * Hand-off target: a decision to record.
 *
 * Until DACI, RAPID and the Decision Log merge into one decision record (a
 * later phase), the closest slice is the Decision Log: a proposed ADR whose
 * title is the item and whose context is its description, with the
 * decision itself left for the team to write. Like the Risk Register, the
 * Decision Log edits its own cloud blob (`agile-toolkit:decision-log`) and
 * exchanges rows with `workspace.decisions` through Import / Push, so a
 * hand-off writes both under one id: the blob, so the log lists it, and the
 * workspace row, so dashboards and agents see it. Import skips ids it
 * already has, so the two never double up.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Decision } from "@/lib/stores/workspace-types";
import { setCloudPersistedValue } from "@/lib/sync/use-cloud-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { HandoffRoute, HandoffSource } from "../types";

/** MUST match the key the Decision Log passes to usePersisted. */
export const DECISION_LOG_KEY = "agile-toolkit:decision-log";

export const DECISION_TITLE_MAX = 300;
export const DECISION_TEXT_MAX = 4000;

/** The Decision Log's blob as stored, or [] when absent or unreadable. Rows are kept as they are. */
export function readDecisionLog(): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DECISION_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasId(row: unknown, id: string): boolean {
  return Boolean(row) && typeof row === "object" && (row as { id?: unknown }).id === id;
}

export function buildDecision(src: HandoffSource, id = nanoid(8)): Decision {
  const context = (src.description ?? "").trim().slice(0, DECISION_TEXT_MAX);
  return {
    id,
    title: src.title.trim().slice(0, DECISION_TITLE_MAX),
    ...(context ? { context } : {}),
    decision: "",
    status: "proposed",
    date: todayLocalISO(),
    sourceRef: src.sourceRef,
  };
}

export const decisionRoute: HandoffRoute = {
  id: "decision",
  label: "Decision record",
  doneLabel: "Added to the Decision Log",
  targetToolId: "decision-log",
  targetHref: () => "/decision-log",
  send: (src) => {
    const decision = buildDecision(src);
    // Newest first, the way the log adds its own.
    setCloudPersistedValue(DECISION_LOG_KEY, [decision, ...readDecisionLog()]);
    useWorkspaceStore.getState().upsertDecision(decision);
    return decision.id;
  },
  remove: (id) => {
    const blob = readDecisionLog();
    if (blob.some((d) => hasId(d, id))) {
      setCloudPersistedValue(
        DECISION_LOG_KEY,
        blob.filter((d) => !hasId(d, id))
      );
    }
    if (useWorkspaceStore.getState().decisions.some((d) => d.id === id)) {
      useWorkspaceStore.getState().removeDecision(id);
    }
  },
  exists: (id) =>
    readDecisionLog().some((d) => hasId(d, id)) ||
    useWorkspaceStore.getState().decisions.some((d) => d.id === id),
  // Decided: accepted (or later replaced). Read from the log first, as the team edits it there.
  isDone: (id) => {
    const row = readDecisionLog().find((d) => hasId(d, id)) as Decision | undefined;
    const status =
      row?.status ?? useWorkspaceStore.getState().decisions.find((d) => d.id === id)?.status;
    return status === "accepted" || status === "superseded" || status === "deprecated";
  },
};
