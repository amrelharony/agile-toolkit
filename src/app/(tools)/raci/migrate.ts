"use client";

import { useEffect, useState } from "react";
import {
  migrateLegacyKeysNow,
  runLegacyKeyMigration,
  type LegacyKeyMigrationResult,
  type MigrateLegacyKeysOptions,
} from "@/lib/data/migrate-legacy-key";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { syncEngine } from "@/lib/sync/engine";
import {
  RACI_ID,
  RACI_LEGACY_KEY,
  RACI_MIGRATION_LOCK,
  hasLegacyRaci,
  planRaciMove,
} from "@/lib/raci/model";

/**
 * Moves the RACI tool's old local-only store ("agile-toolkit:raci", a
 * zustand persist blob with one letter per cell) into the workspace's
 * RACI matrix, once, through the crash-safe legacy-key move
 * (lib/data/migrate-legacy-key.ts): one write, then a `:migrated` backup,
 * then the old key goes.
 *
 * It fills the workspace only when it has no matrix (never over one), and
 * skips a store holding only the defaults it seeded, which are not the
 * team's data. Either way the old key is backed up and removed, so
 * running it twice (a crash, two tabs) changes nothing the second time.
 */

export interface RaciMoveReport {
  /** Whether the old matrix was written into the workspace. */
  moved: boolean;
}

function options(storage?: Storage): MigrateLegacyKeysOptions<RaciMoveReport> {
  return {
    keys: [RACI_LEGACY_KEY],
    storage,
    move: (raw) => {
      const { raciMatrices, upsertRaciMatrix } = useWorkspaceStore.getState();
      const existing = (raciMatrices ?? []).find((d) => d.id === RACI_ID);
      const doc = planRaciMove(raw[RACI_LEGACY_KEY], existing);
      if (doc) upsertRaciMatrix(doc);
      return { wrote: doc !== null, report: { moved: doc !== null } };
    },
  };
}

/** The move, synchronously (tests, and callers already holding the lock). */
export function migrateRaciNow(storage?: Storage): LegacyKeyMigrationResult<RaciMoveReport> {
  return migrateLegacyKeysNow(options(storage));
}

/** The move under the cross-tab lock. */
export function runRaciMigration(
  storage?: Storage
): Promise<LegacyKeyMigrationResult<RaciMoveReport>> {
  return runLegacyKeyMigration(RACI_MIGRATION_LOCK, options(storage));
}

/**
 * Runs the move from the RACI page once it is safe to write the workspace
 * (useLegacyMigrationMode: loaded, auth settled, and for the owner after
 * the cloud's first pull, so the old matrix can't beat a newer cloud one).
 * Returns true while the old store is still waiting to move.
 */
export function useLegacyRaciMove(): boolean {
  const [found, setFound] = useState(false);
  // Read after mount: the page is prerendered, and storage is the browser's.
  useEffect(() => setFound(hasLegacyRaci()), []);
  const mode = useLegacyMigrationMode(found);

  useEffect(() => {
    if (mode !== "local" && mode !== "cloud") return;
    let cancelled = false;
    void (async () => {
      if (mode === "cloud") await syncEngine.whenReady();
      if (cancelled) return;
      await runRaciMigration();
      if (!cancelled) setFound(hasLegacyRaci());
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return found;
}
