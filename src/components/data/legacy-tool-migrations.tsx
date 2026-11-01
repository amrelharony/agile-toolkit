"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { hasLegacyImpediments } from "@/lib/impediments/legacy-key";
import { hasLegacyRaci } from "@/lib/raci/legacy-key";
import { syncEngine } from "@/lib/sync/engine";
import { toast } from "@/lib/utils/toast";

/**
 * Moves old per-tool storage into the workspace, once, for the tools whose
 * upgrade moved their data there (the sprint tools have their own mount,
 * LegacySprintMigration). Same safety rules: see useLegacyMigrationMode.
 * A tool page that runs its own move too (RACI) shares the move's
 * cross-tab lock, and the second run finds the old key gone.
 *
 * Renders nothing. Without any old key it does nothing at all and never
 * loads the migration code: each check comes from a tiny legacy-key
 * module, and the move (with the tool's model) is imported only to run.
 *
 * The ADKAR tracker's old blob is not here: its move is a hook on the
 * ADKAR page (use-legacy-adkar.ts) that reads the cloud-synced blob and
 * records what it moved in another synced blob, which only a mounted hook
 * can write to the cloud.
 */

interface LegacyToolMigration {
  id: string;
  /** Cheap synchronous check for the old key. */
  has: () => boolean;
  /** Run the move; resolves to a toast, or null for none. */
  run: () => Promise<string | null>;
}

const MIGRATIONS: readonly LegacyToolMigration[] = [
  {
    id: "impediments",
    has: () => hasLegacyImpediments(),
    run: async () => {
      const { runLegacyImpedimentMigration, impedimentMigrationSummary } =
        await import("@/lib/impediments/migrate-legacy");
      const result = await runLegacyImpedimentMigration();
      return impedimentMigrationSummary(result.report);
    },
  },
  {
    // The RACI tool's old local-only store. The move fills the workspace
    // only when it has no matrix, and skips the old store's untouched
    // defaults; either way the old key is backed up and removed.
    id: "raci",
    has: () => hasLegacyRaci(),
    run: async () => {
      const { runRaciMigration } = await import("@/app/(tools)/raci/migrate");
      const result = await runRaciMigration();
      return result.report?.moved
        ? "Moved the RACI matrix saved in this browser into your workspace."
        : null;
    },
  },
];

export function LegacyToolMigrations() {
  const hasAuth = useAuthOptional() !== null;
  const [pending, setPending] = useState<readonly LegacyToolMigration[]>([]);
  const started = useRef(false);

  // The cheap check, once.
  useEffect(() => {
    if (!hasAuth || started.current) return;
    const found = MIGRATIONS.filter((m) => m.has());
    if (found.length > 0) setPending(found);
  }, [hasAuth]);

  const mode = useLegacyMigrationMode(pending.length > 0);

  useEffect(() => {
    if (started.current || (mode !== "local" && mode !== "cloud")) return;
    started.current = true;
    void (async () => {
      if (mode === "cloud") await syncEngine.whenReady();
      for (const m of pending) {
        try {
          const summary = await m.run();
          if (summary) toast.success(summary);
        } catch (err) {
          // The old key stays; the next load tries again.
          // eslint-disable-next-line no-console
          console.warn(`[${m.id}-migration] failed`, err);
        }
      }
    })();
  }, [mode, pending]);

  return null;
}
