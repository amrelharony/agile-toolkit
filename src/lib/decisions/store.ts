/**
 * Writes to the decision records, in the browser. Each helper reads the
 * workspace at the moment it writes (never a React copy that may be
 * stale), so the Decision Log, a hand-off and RFC Tracker's push open in
 * the same tab can't number two records alike or undo each other's edit.
 *
 * Records live in workspace.decisions only. An old DACI or RAPID row is
 * read through (lib/decisions/model allDecisions) until its first save,
 * which writes a Decision under the same id and leaves the old row behind
 * as the backup; a delete removes the id from all three collections, so a
 * read-through row can't come back.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DACIDecision,
  Decision,
  RAPIDDecision,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import { allDecisions, nextDecisionNumber } from "./model";
import { DECISION_LOG_KEY, DECISION_LOG_MOVED_KEY, withPendingDecisionLog } from "./legacy-log";

/** A new record's id (the shape the Decision Log and hand-offs always used). */
export function newDecisionId(): string {
  return nanoid(8);
}

/** A cloud-persisted value as this browser holds it (mirrored to localStorage), or null. */
function readLocal(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/**
 * Every record the Decision Log lists right now: the workspace's, the old
 * DACI and RAPID rows read through, and the Decision Log blob's rows still
 * waiting for the page's one-time move, as they will read once moved.
 */
export function currentDecisions(): Decision[] {
  const ws = useWorkspaceStore.getState();
  return withPendingDecisionLog(
    allDecisions(ws.decisions, ws.daciDecisions, ws.rapidDecisions),
    readLocal(DECISION_LOG_KEY),
    idsOf(readLocal(DECISION_LOG_MOVED_KEY))
  );
}

/**
 * Save a record under its id. A record that was an old DACI or RAPID row
 * shadows it from now on; the old row stays behind, as the standup merge
 * leaves old async updates.
 */
export function saveDecision(d: Decision): Decision {
  useWorkspaceStore.getState().upsertDecision(d);
  return d;
}

/**
 * Save several records in one store write (the Decision Log's move: rows
 * added, gaps filled and numbers given at once): each replaces the record
 * with its id, and new ones go at the end.
 */
export function saveDecisions(list: readonly Decision[]): void {
  if (list.length === 0) return;
  useWorkspaceStore.setState((s) => {
    const byId = new Map(list.map((d) => [d.id, d]));
    const kept = s.decisions.map((d) => {
      const next = byId.get(d.id);
      if (next) byId.delete(d.id);
      return next ?? d;
    });
    return { decisions: [...kept, ...Array.from(byId.values())] };
  });
}

/**
 * Save a new record with the next number in the log (one sequence across
 * the templates, never reused): one past the highest in `all`, which
 * defaults to the records as they are now. Returns the record as saved.
 */
export function createDecision(
  input: Omit<Decision, "number">,
  all: readonly Decision[] = currentDecisions()
): Decision {
  return saveDecision({ ...input, number: nextDecisionNumber(all) });
}

/** What `removeDecisionRecord` took away, so Undo can put it back. */
export interface DecisionRecordSnapshot {
  id: string;
  decision?: Decision;
  daci?: DACIDecision;
  rapid?: RAPIDDecision;
  /** Canvas cards the removes unpinned, with the link each had. */
  cards: { id: string; sourceRef: NonNullable<WhiteboardObject["sourceRef"]> }[];
}

/** The canvas tools a decision record's cards can point at it through. */
const CARD_TOOLS = new Set(["decision", "daci", "rapid"]);

/**
 * Remove a record from all three collections (the record, and the old DACI
 * or RAPID row under its id, so a read-through row can't come back) and
 * return what went, for `restoreDecisionRecord`. Canvas cards pinned to it
 * are unpinned by the removes; the snapshot keeps their links.
 */
export function removeDecisionRecord(id: string): DecisionRecordSnapshot {
  const ws = useWorkspaceStore.getState();
  const decision = ws.decisions.find((d) => d.id === id);
  const daci = (ws.daciDecisions ?? []).find((d) => d.id === id);
  const rapid = (ws.rapidDecisions ?? []).find((r) => r.id === id);
  const cards = (ws.whiteboardObjects ?? []).flatMap((o) =>
    o.sourceRef && CARD_TOOLS.has(o.sourceRef.tool) && o.sourceRef.entityId === id
      ? [{ id: o.id, sourceRef: o.sourceRef }]
      : []
  );
  if (decision) ws.removeDecision(id);
  if (daci) ws.removeDACIDecision(id);
  if (rapid) ws.removeRAPIDDecision(id);
  return {
    id,
    ...(decision ? { decision } : {}),
    ...(daci ? { daci } : {}),
    ...(rapid ? { rapid } : {}),
    cards,
  };
}

/**
 * Put back what `removeDecisionRecord` took (Undo). A row that came back
 * under the id since (another device's copy) is left as it is, and a card
 * is re-pinned only while it is still there and unpinned.
 */
export function restoreDecisionRecord(snapshot: DecisionRecordSnapshot): void {
  const ws = useWorkspaceStore.getState();
  const { id, decision, daci, rapid, cards } = snapshot;
  if (decision && !ws.decisions.some((d) => d.id === id)) ws.upsertDecision(decision);
  if (daci && !(ws.daciDecisions ?? []).some((d) => d.id === id)) ws.upsertDACIDecision(daci);
  if (rapid && !(ws.rapidDecisions ?? []).some((r) => r.id === id)) ws.upsertRAPIDDecision(rapid);
  if (cards.length === 0) return;
  const objects = new Map(
    (useWorkspaceStore.getState().whiteboardObjects ?? []).map((o) => [o.id, o])
  );
  const at = new Date().toISOString();
  const back = cards.flatMap(({ id: objectId, sourceRef }) => {
    const o = objects.get(objectId);
    // version + updatedAt bump so peers accept the change (last write wins).
    return o && !o.sourceRef ? [{ ...o, sourceRef, version: o.version + 1, updatedAt: at }] : [];
  });
  if (back.length > 0) useWorkspaceStore.getState().upsertWhiteboardObjects(back);
}
