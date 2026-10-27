"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import {
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  planRiskRegisterMove,
  withPendingRisks,
  type RiskRegisterConflict,
} from "@/lib/risks/legacy-register";
import { saveRisks } from "@/lib/risks/store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { readCloudBlobs } from "@/lib/sync/cloud-blobs";
import { usePersisted } from "@/lib/utils/use-persisted";

const NO_IDS: string[] = [];
const NO_RISKS: Risk[] = [];
const NO_CONFLICTS: RiskRegisterConflict[] = [];

/** The ids in a stored moved-ids record (anything else reads as none). */
const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

const sameConflict = (a: RiskRegisterConflict, b: RiskRegisterConflict) =>
  a.id === b.id && a.field === b.field;

export interface LegacyRisks {
  /**
   * Every risk the register lists: the workspace's, and the old register
   * page's rows still waiting to move, as they will read once moved.
   */
  records: Risk[];
  /** Whether rows of the old register page are still waiting to move. */
  pending: boolean;
  /**
   * Values the old register page and the workspace hold differently for
   * the same risk. The move kept the workspace's; these are shown once, so
   * the team can take the old page's value instead.
   */
  conflicts: RiskRegisterConflict[];
  /** Stop showing one conflict (it was kept or replaced). */
  settleConflict: (c: RiskRegisterConflict) => void;
  /**
   * How many risks the old page never listed the move found in the
   * workspace (an agent's, a premortem's sent after the old page was last
   * opened, or one the old page deleted from its own copy only): shown
   * once, then 0. They are listed like any other risk.
   */
  appeared: number;
  /** Stop showing the "appeared" notice. */
  dismissAppeared: () => void;
}

/**
 * The register's risks, and the one-time move that brings the old Risk
 * Register page's blob into workspace.risks, where agents, the premortem's
 * hand-off, the dashboards and the next steps read them.
 *
 * Before Phase 8 the page kept its own cloud-synced blob and exchanged
 * rows with the workspace by hand (Import / Push). The move
 * (lib/risks/legacy-register) adds the blob's rows the workspace lacks,
 * fills the gaps in the ones both hold, keeps the later status, and
 * writes it all in one store write, stamped, which also settles the rows
 * it only reports (values held differently, rows only the workspace had),
 * so both notices show once. It waits until the workspace is safe to
 * write (useLegacyMigrationMode, and the owner's first cloud pull), plans
 * on the cloud's copy of the blob and its moved-ids record for the owner,
 * and never deletes the blob: it is the backup. Modelled on the Decision
 * Log's move (decision-log/use-legacy-decisions.ts).
 */
export function useLegacyRisks(): LegacyRisks {
  const [legacy] = usePersisted<unknown>(RISK_REGISTER_KEY, null);
  const [moved, setMoved] = usePersisted<string[]>(RISK_REGISTER_MOVED_KEY, NO_IDS);
  const stored = useWorkspaceStore((s) => s.risks) ?? NO_RISKS;
  const known = useMemo(() => idsOf(moved), [moved]);

  const records = useMemo(() => withPendingRisks(stored, legacy, known), [stored, legacy, known]);
  const plan = useMemo(() => planRiskRegisterMove(legacy, stored, known), [legacy, stored, known]);
  const found = plan.toAdd.length > 0 || plan.toFill.length > 0 || plan.changed;
  // A row the move only stamps keeps its object, so it doesn't count as pending.
  const pending = records.length !== stored.length || records.some((r, i) => r !== stored[i]);

  const mode = useLegacyMigrationMode(found);
  const userId = useAuthOptional()?.user?.id ?? null;
  const [ready, setReady] = useState(false);
  const [conflicts, setConflicts] = useState<RiskRegisterConflict[]>(NO_CONFLICTS);
  const [appeared, setAppeared] = useState(0);

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
          ? await readCloudBlobs(userId, [RISK_REGISTER_KEY, RISK_REGISTER_MOVED_KEY])
          : null;
      if (cancelled) return;
      const source = cloud?.has(RISK_REGISTER_KEY) ? cloud.get(RISK_REGISTER_KEY) : legacy;
      const ids = Array.from(new Set([...known, ...idsOf(cloud?.get(RISK_REGISTER_MOVED_KEY))]));
      // Planned again on the store as it is now: the render's copy may be stale.
      const now = planRiskRegisterMove(source, useWorkspaceStore.getState().risks ?? [], ids);
      // Reported before the save: once it has stamped the rows, the same
      // rows are never reported again.
      if (now.conflicts.length > 0) {
        setConflicts((list) => [
          ...list,
          ...now.conflicts.filter((c) => !list.some((x) => sameConflict(x, c))),
        ]);
      }
      if (now.appeared.length > 0) setAppeared((n) => n + now.appeared.length);
      saveRisks([...now.toFill, ...now.toAdd]);
      if (now.moved.length !== known.length) setMoved(now.moved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, found, mode, userId, legacy, known, setMoved]);

  const settleConflict = useCallback(
    (c: RiskRegisterConflict) => setConflicts((list) => list.filter((x) => !sameConflict(x, c))),
    []
  );
  const dismissAppeared = useCallback(() => setAppeared(0), []);

  return { records, pending, conflicts, settleConflict, appeared, dismissAppeared };
}
