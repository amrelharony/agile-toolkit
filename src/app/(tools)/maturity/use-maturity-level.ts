"use client";

import { useEffect, useState } from "react";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MaturityAssessment } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { maturityLevelOf } from "@/lib/maturity/assessment";

/**
 * Keep `Workspace.maturityLevel` equal to maturityLevelOf(the stored
 * assessment): the latest saved assessment's level, or undefined for a
 * team that never saved one. It replaces the effect that pushed level 1
 * for anyone who merely opened the page; that 1 reached every tool's AI
 * prompt and the agents' workspace summary, and is cleared here.
 *
 * It follows saves, deletes and resets (and their Undo) by following the
 * stored doc, never the example. It starts writing only once the stored
 * doc can be trusted: after the workspace has loaded, and for the owner
 * after the cloud's first pull (the same gate as the one-time legacy
 * moves), so a device that hasn't pulled the assessment yet can't clear a
 * level another device set. Without an AuthProvider (tests, embeds) there
 * is no cloud to wait for.
 */
export function useMaturityLevelSync(
  stored: MaturityAssessment | undefined,
  hydrated: boolean
): void {
  const mode = useLegacyMigrationMode(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mode === "local" || mode === "off") {
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

  const level = maturityLevelOf(stored);
  useEffect(() => {
    if (!ready || !hydrated) return;
    const { maturityLevel, setMaturityLevel } = useWorkspaceStore.getState();
    if (maturityLevel !== level) setMaturityLevel(level);
  }, [ready, hydrated, level]);
}
