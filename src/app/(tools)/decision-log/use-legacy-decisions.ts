"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { allDecisions, numberUnnumbered } from "@/lib/decisions/model";
import {
  DECISION_LOG_KEY,
  DECISION_LOG_MOVED_KEY,
  planDecisionLogMove,
  withPendingDecisionLog,
  type DecisionLogConflict,
} from "@/lib/decisions/legacy-log";
import { saveDecisions } from "@/lib/decisions/store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DACIDecision, Decision, RAPIDDecision } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { readCloudBlobs } from "@/lib/sync/cloud-blobs";
import { usePersisted } from "@/lib/utils/use-persisted";

const NO_IDS: string[] = [];
const NO_DECISIONS: Decision[] = [];
const NO_DACI: DACIDecision[] = [];
const NO_RAPID: RAPIDDecision[] = [];
const NO_CONFLICTS: DecisionLogConflict[] = [];

/** The ids in a stored moved-ids record (anything else reads as none). */
const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/**
 * Everything the one-time move writes, in one list: the old DACI and RAPID
 * rows copied in as records under their own ids (the old rows stay behind,
 * shadowed, as the backup), the Decision Log blob's rows added and its
 * copies folded into the workspace's (lib/decisions/legacy-log), and a
 * number for every record without one, oldest first. Empty when there is
 * nothing to do, so a second run writes nothing.
 */
export function planDecisionMove(
  stored: readonly Decision[],
  daci: readonly DACIDecision[] | undefined,
  rapid: readonly RAPIDDecision[] | undefined,
  blob: unknown,
  moved: readonly string[]
): {
  writes: Decision[];
  moved: string[];
  movedChanged: boolean;
  conflicts: DecisionLogConflict[];
} {
  const all = allDecisions(stored, daci, rapid);
  const storedIds = new Set(stored.map((d) => d.id));
  const writes = new Map<string, Decision>();
  // DACI and RAPID rows no record replaced yet: copied in, read as records.
  for (const d of all) if (!storedIds.has(d.id)) writes.set(d.id, d);
  const plan = planDecisionLogMove(blob, all, moved);
  for (const d of [...plan.toFill, ...plan.toAdd]) writes.set(d.id, d);
  const after = [...all.map((d) => writes.get(d.id) ?? d), ...plan.toAdd];
  for (const d of numberUnnumbered(after)) writes.set(d.id, d);
  return {
    writes: Array.from(writes.values()),
    moved: plan.moved,
    movedChanged: plan.changed,
    conflicts: plan.conflicts,
  };
}

export interface LegacyDecisions {
  /**
   * Every record the log lists: the workspace's, the old DACI and RAPID rows
   * read through, and the old Decision Log's rows still waiting to move, as
   * they will read once moved.
   */
  records: Decision[];
  /** Whether rows of the old Decision Log are still waiting to move. */
  pending: boolean;
  /**
   * Text the old Decision Log page and the workspace hold differently for
   * the same record. The move kept the workspace's; these are shown once,
   * so the team can take the old page's text instead.
   */
  conflicts: DecisionLogConflict[];
  /** Stop showing one conflict (it was kept or replaced). */
  settleConflict: (c: DecisionLogConflict) => void;
}

/**
 * The Decision Log's records, and the one-time move that brings the old
 * storage into workspace.decisions, where DACI, RAPID, the hand-offs and
 * agents read them.
 *
 * Before the merge the Decision Log kept its own cloud-synced blob and DACI
 * and RAPID their own collections. The move copies the DACI and RAPID rows
 * in as records under their ids (the old rows stay behind as the backup),
 * brings the blob's rows in by id (a gap fill: lib/decisions/legacy-log),
 * numbers every record that has no number yet, oldest first, and writes
 * all of it in one store write. It waits until the workspace is safe to
 * write (useLegacyMigrationMode, and the owner's first cloud pull), plans
 * on the cloud's copy of the blob and its moved-ids record for the owner,
 * and never deletes the blob: it is the backup. Agent- and CRUD-created
 * records without a number are numbered by the same pass on the next
 * visit.
 *
 * Text the two copies of a record held differently (edited on the old
 * page after a Push) is reported once in `conflicts`, before the moved
 * ids are written: the workspace's text was kept, and the page offers the
 * old page's instead.
 */
export function useLegacyDecisions(): LegacyDecisions {
  const [legacy] = usePersisted<unknown>(DECISION_LOG_KEY, null);
  const [moved, setMoved] = usePersisted<string[]>(DECISION_LOG_MOVED_KEY, NO_IDS);
  const stored = useWorkspaceStore((s) => s.decisions) ?? NO_DECISIONS;
  const daci = useWorkspaceStore((s) => s.daciDecisions) ?? NO_DACI;
  const rapid = useWorkspaceStore((s) => s.rapidDecisions) ?? NO_RAPID;
  const known = useMemo(() => idsOf(moved), [moved]);

  const base = useMemo(() => allDecisions(stored, daci, rapid), [stored, daci, rapid]);
  const records = useMemo(() => withPendingDecisionLog(base, legacy, known), [base, legacy, known]);
  const plan = useMemo(
    () => planDecisionMove(stored, daci, rapid, legacy, known),
    [stored, daci, rapid, legacy, known]
  );
  const found = plan.writes.length > 0 || plan.movedChanged;
  const pending = records.length !== base.length || records.some((d, i) => d !== base[i]);

  const mode = useLegacyMigrationMode(found);
  const userId = useAuthOptional()?.user?.id ?? null;
  const [ready, setReady] = useState(false);
  const [conflicts, setConflicts] = useState<DecisionLogConflict[]>(NO_CONFLICTS);

  useEffect(() => {
    if (mode === "local") {
      setReady(true);
      return;
    }
    if (mode !== "cloud") return;
    let cancelled = false;
    void syncEngine.whenReady().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (!ready || !found) return;
    let cancelled = false;
    void (async () => {
      const cloud =
        mode === "cloud" && userId
          ? await readCloudBlobs(userId, [DECISION_LOG_KEY, DECISION_LOG_MOVED_KEY])
          : null;
      if (cancelled) return;
      const source = cloud?.has(DECISION_LOG_KEY) ? cloud.get(DECISION_LOG_KEY) : legacy;
      const ids = Array.from(new Set([...known, ...idsOf(cloud?.get(DECISION_LOG_MOVED_KEY))]));
      // Planned again on the store as it is now: the render's copy may be stale.
      const ws = useWorkspaceStore.getState();
      const now = planDecisionMove(
        ws.decisions ?? [],
        ws.daciDecisions,
        ws.rapidDecisions,
        source,
        ids
      );
      // Reported before the moved ids are written: once they are, the
      // same rows are never planned (or reported) again.
      if (now.conflicts.length > 0) {
        setConflicts((list) => [
          ...list,
          ...now.conflicts.filter((c) => !list.some((x) => x.id === c.id && x.field === c.field)),
        ]);
      }
      saveDecisions(now.writes);
      if (now.moved.length !== known.length) setMoved(now.moved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, found, mode, userId, legacy, known, setMoved]);

  const settleConflict = useCallback(
    (c: DecisionLogConflict) =>
      setConflicts((list) => list.filter((x) => !(x.id === c.id && x.field === c.field))),
    []
  );

  return { records, pending, conflicts, settleConflict };
}
