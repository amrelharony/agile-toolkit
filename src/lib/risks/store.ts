/**
 * Writes to the risks, in the browser. Each helper reads the workspace at
 * the moment it writes (never a React copy that may be stale), so the
 * register, the premortem's hand-off and an agent in the same tab can't
 * undo each other's edit.
 *
 * Risks live in workspace.risks only. A row of the old register blob the
 * page's one-time move hasn't handled yet is listed as it will read once
 * moved (currentRisks), so it can be edited before the move runs: its
 * first save writes the merged row to the workspace. A delete marks such a
 * row moved, so the move doesn't bring it back; the blob itself, the
 * backup, is never written here.
 *
 * Every save stamps `updatedAt`, which tells the move that the workspace's
 * copy is the newer one (lib/risks/legacy-register).
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk, WhiteboardObject } from "@/lib/stores/workspace-types";
import { setCloudPersistedValue } from "@/lib/sync/use-cloud-persisted";
import {
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  isPendingRiskRow,
  withPendingRisks,
} from "./legacy-register";

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
 * Every risk the register lists right now: the workspace's, and the old
 * blob's rows still waiting for the page's one-time move, as they will
 * read once moved.
 */
export function currentRisks(): Risk[] {
  return withPendingRisks(
    useWorkspaceStore.getState().risks ?? [],
    readLocal(RISK_REGISTER_KEY),
    idsOf(readLocal(RISK_REGISTER_MOVED_KEY))
  );
}

/**
 * Save several risks in one store write (the page's move: rows added and
 * gaps filled at once), each stamped `updatedAt`: each replaces the risk
 * with its id, and new ones go first, newest-first as the register always
 * listed them. Returns the rows as saved, in `list`'s order.
 */
export function saveRisks(list: readonly Risk[]): Risk[] {
  if (list.length === 0) return [];
  const at = new Date().toISOString();
  const saved = list.map((r) => ({ ...r, updatedAt: at }));
  useWorkspaceStore.setState((s) => {
    const byId = new Map(saved.map((r) => [r.id, r]));
    const kept = (s.risks ?? []).map((r) => {
      const next = byId.get(r.id);
      if (next) byId.delete(r.id);
      return next ?? r;
    });
    return { risks: [...Array.from(byId.values()), ...kept] };
  });
  return saved;
}

/** Save one risk under its id, stamped `updatedAt` (a new one goes first). Returns it as saved. */
export function saveRisk(r: Risk): Risk {
  return saveRisks([r])[0];
}

/**
 * Change one risk with `fn`, given the risk as the register lists it now
 * (currentRisks), so a row still waiting for the move is edited with its
 * old-page fields folded in. Returns the risk as saved, or null for an
 * unknown id (nothing is written).
 */
export function patchRisk(id: string, fn: (r: Risk) => Risk): Risk | null {
  const current = currentRisks().find((r) => r.id === id);
  return current ? saveRisk(fn(current)) : null;
}

/** What `removeRiskRecord` took away, so Undo can put it back. */
export interface RiskRecordSnapshot {
  id: string;
  /** The workspace row, when the workspace held one. */
  risk?: Risk;
  /**
   * Set when the id was a row of the register's old blob still waiting for
   * the page's move, which the delete marked moved: Undo unmarks it.
   */
  pendingBlobRow?: true;
  /** Canvas cards the remove unpinned, with the link each had. */
  cards: { id: string; sourceRef: NonNullable<WhiteboardObject["sourceRef"]> }[];
}

/** The canvas tool a risk's cards point at it through (workspace-store removeRisk). */
const CARD_TOOL = "risk";

/**
 * Remove a risk and return what went, for `restoreRiskRecord`. A row of the
 * old blob the move hasn't handled yet (only in the blob, or in both
 * through Push or the old hand-off) is marked moved first, so neither the
 * list nor the move brings it back; the blob itself, the backup, is
 * untouched. Canvas cards pinned to it are unpinned by the store's remove;
 * the snapshot keeps their links.
 */
export function removeRiskRecord(id: string): RiskRecordSnapshot {
  const ws = useWorkspaceStore.getState();
  const risk = (ws.risks ?? []).find((r) => r.id === id);
  const cards = (ws.whiteboardObjects ?? []).flatMap((o) =>
    o.sourceRef && o.sourceRef.tool === CARD_TOOL && o.sourceRef.entityId === id
      ? [{ id: o.id, sourceRef: o.sourceRef }]
      : []
  );
  const moved = idsOf(readLocal(RISK_REGISTER_MOVED_KEY));
  const pendingBlobRow = isPendingRiskRow(id, readLocal(RISK_REGISTER_KEY), moved);
  // Marked first, so no reader sees the blob's copy come back in between.
  if (pendingBlobRow) setCloudPersistedValue(RISK_REGISTER_MOVED_KEY, [...moved, id]);
  if (risk) ws.removeRisk(id);
  return {
    id,
    ...(risk ? { risk } : {}),
    ...(pendingBlobRow ? { pendingBlobRow: true as const } : {}),
    cards,
  };
}

/**
 * Put back what `removeRiskRecord` took (Undo): the workspace row exactly
 * as it was, unless a row came back under the id since (another device's
 * copy), which is left as it is; a blob row the delete marked moved is
 * waiting for the move again; a card is re-pinned only while it is still
 * there and unpinned.
 */
export function restoreRiskRecord(snapshot: RiskRecordSnapshot): void {
  const ws = useWorkspaceStore.getState();
  const { id, risk, pendingBlobRow, cards } = snapshot;
  if (risk && !(ws.risks ?? []).some((r) => r.id === id)) ws.upsertRisk(risk);
  if (pendingBlobRow) {
    const moved = idsOf(readLocal(RISK_REGISTER_MOVED_KEY));
    if (moved.includes(id)) {
      setCloudPersistedValue(
        RISK_REGISTER_MOVED_KEY,
        moved.filter((m) => m !== id)
      );
    }
  }
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
