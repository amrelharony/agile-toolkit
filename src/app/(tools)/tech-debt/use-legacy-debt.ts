"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { readCloudBlobs } from "@/lib/sync/cloud-blobs";
import {
  TECH_DEBT_KEY,
  TECH_DEBT_MOVED_KEY,
  planTechDebtMove,
  withPendingTechDebt,
  type TechDebtConflict,
} from "@/lib/tech-debt/legacy";
import { saveTechDebt } from "@/lib/tech-debt/store";
import { usePersisted } from "@/lib/utils/use-persisted";

const NO_IDS: string[] = [];
const NO_ITEMS: TechDebtItem[] = [];
const NO_CONFLICTS: TechDebtConflict[] = [];

/** The ids in a stored moved-ids record (anything else reads as none). */
const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

const sameConflict = (a: TechDebtConflict, b: TechDebtConflict) =>
  a.id === b.id && a.field === b.field;

export interface LegacyDebt {
  /**
   * Every item the page lists: the workspace's, and the old Tech Debt
   * page's rows still waiting to move, as they will read once moved.
   */
  records: TechDebtItem[];
  /** Whether rows of the old page are still waiting to move. */
  pending: boolean;
  /**
   * Values the old page and the workspace hold differently for the same
   * item. The move kept the workspace's; these are shown once, so the
   * team can take the old page's value instead.
   */
  conflicts: TechDebtConflict[];
  /** Stop showing one conflict (it was kept or replaced). */
  settleConflict: (c: TechDebtConflict) => void;
  /**
   * The ids of the items the old page never listed that the move found in
   * the workspace (an agent's): shown once, then none. The notice names
   * them so the team can find them.
   */
  appeared: string[];
  /** Stop showing the "appeared" notice. */
  dismissAppeared: () => void;
}

/**
 * The Tech Debt items, and the one-time move that brings the old page's
 * blob into workspace.techDebt, where agents, the anti-patterns, the
 * predictor and the next steps read them.
 *
 * Before Phase 8 the page kept its own cloud-synced blob and exchanged
 * rows with the workspace by hand (Import / Push). The move
 * (lib/tech-debt/legacy) adds the blob's rows the workspace lacks, fills
 * the gaps in the ones both hold (a resolvedAt only the blob has
 * included: resolved is the later status), and writes it all in one store
 * write, stamped, which also settles the rows it only reports, so both
 * notices show once. It waits until the workspace is safe to write
 * (useLegacyMigrationMode, and the owner's first cloud pull), plans on the
 * cloud's copy for the owner, and never deletes the blob: it is the
 * backup. The Risk Register's move, with debt fields.
 */
export function useLegacyDebt(): LegacyDebt {
  const [legacy] = usePersisted<unknown>(TECH_DEBT_KEY, null);
  const [moved, setMoved] = usePersisted<string[]>(TECH_DEBT_MOVED_KEY, NO_IDS);
  const stored = useWorkspaceStore((s) => s.techDebt) ?? NO_ITEMS;
  const known = useMemo(() => idsOf(moved), [moved]);

  const records = useMemo(
    () => withPendingTechDebt(stored, legacy, known),
    [stored, legacy, known]
  );
  const plan = useMemo(() => planTechDebtMove(legacy, stored, known), [legacy, stored, known]);
  const found = plan.toAdd.length > 0 || plan.toFill.length > 0 || plan.changed;
  // A row the move only stamps keeps its object, so it doesn't count as pending.
  const pending = records.length !== stored.length || records.some((t, i) => t !== stored[i]);

  const mode = useLegacyMigrationMode(found);
  const userId = useAuthOptional()?.user?.id ?? null;
  const [ready, setReady] = useState(false);
  const [conflicts, setConflicts] = useState<TechDebtConflict[]>(NO_CONFLICTS);
  const [appeared, setAppeared] = useState<string[]>(NO_IDS);

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
          ? await readCloudBlobs(userId, [TECH_DEBT_KEY, TECH_DEBT_MOVED_KEY])
          : null;
      if (cancelled) return;
      const source = cloud?.has(TECH_DEBT_KEY) ? cloud.get(TECH_DEBT_KEY) : legacy;
      const ids = Array.from(new Set([...known, ...idsOf(cloud?.get(TECH_DEBT_MOVED_KEY))]));
      // Planned again on the store as it is now: the render's copy may be stale.
      const now = planTechDebtMove(source, useWorkspaceStore.getState().techDebt ?? [], ids);
      // Reported before the save: once it has stamped the rows, the same
      // rows are never reported again.
      if (now.conflicts.length > 0) {
        setConflicts((list) => [
          ...list,
          ...now.conflicts.filter((c) => !list.some((x) => sameConflict(x, c))),
        ]);
      }
      if (now.appeared.length > 0) {
        setAppeared((ids) => [...ids, ...now.appeared.filter((id) => !ids.includes(id))]);
      }
      saveTechDebt([...now.toFill, ...now.toAdd]);
      if (now.moved.length !== known.length) setMoved(now.moved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, found, mode, userId, legacy, known, setMoved]);

  const settleConflict = useCallback(
    (c: TechDebtConflict) => setConflicts((list) => list.filter((x) => !sameConflict(x, c))),
    []
  );
  const dismissAppeared = useCallback(() => setAppeared(NO_IDS), []);

  return { records, pending, conflicts, settleConflict, appeared, dismissAppeared };
}
