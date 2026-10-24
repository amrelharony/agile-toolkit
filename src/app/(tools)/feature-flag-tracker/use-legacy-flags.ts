"use client";

import { useEffect, useMemo, useState } from "react";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { FLAGS_LEGACY_KEY, FLAGS_MOVED_KEY, planLegacyMove } from "@/lib/flags/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FeatureFlag } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { usePersisted } from "@/lib/utils/use-persisted";

const NO_IDS: string[] = [];

/**
 * The one-time move of the tracker's old blob into workspace.featureFlags,
 * where Release Readiness, the next steps and agents can read the flags.
 *
 * The blob was cloud-synced and only loads once a page asks for it, so the
 * move lives here: it reads the blob, waits until the workspace is safe to
 * write (useLegacyMigrationMode, and the owner's first cloud pull, so a
 * moved flag can't beat a newer one from another device), then adds the
 * flags the workspace doesn't have, by id (lib/flags planLegacyMove). It
 * never overwrites a workspace row and leaves the blob as it is, as the
 * backup. Returns true while flags are still waiting to move.
 */
export function useLegacyFlagMove(flags: readonly FeatureFlag[]): boolean {
  const [legacy] = usePersisted<unknown>(FLAGS_LEGACY_KEY, null);
  const [moved, setMoved] = usePersisted<string[]>(FLAGS_MOVED_KEY, NO_IDS);
  const plan = useMemo(() => planLegacyMove(legacy, flags, moved), [legacy, flags, moved]);
  const found = plan.toMove.length > 0 || plan.changed;
  const mode = useLegacyMigrationMode(found);
  const [ready, setReady] = useState(false);

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
    // Planned again on the store as it is now: the render's copy may be stale.
    const { featureFlags, upsertFeatureFlag } = useWorkspaceStore.getState();
    const now = planLegacyMove(legacy, featureFlags ?? [], moved);
    now.toMove.forEach(upsertFeatureFlag);
    if (now.changed) setMoved(now.moved);
  }, [ready, found, legacy, moved, setMoved]);

  return plan.toMove.length > 0;
}
