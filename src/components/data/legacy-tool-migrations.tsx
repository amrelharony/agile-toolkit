"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { hasLegacyImpediments } from "@/lib/impediments/legacy-key";
import { syncEngine } from "@/lib/sync/engine";
import { toast } from "@/lib/utils/toast";

/**
 * Moves old per-tool storage into the workspace, once, for the tools whose
 * upgrade moved their data there (the sprint tools have their own mount,
 * LegacySprintMigration). Same safety rules: see useLegacyMigrationMode.
 *
 * Renders nothing. Without any old key it does nothing at all and never
 * loads the migration code.
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
