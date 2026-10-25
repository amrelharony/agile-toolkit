"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { FLAGS_LEGACY_KEY, FLAGS_MOVED_KEY, planLegacyMove } from "@/lib/flags/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FeatureFlag } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { usePersisted } from "@/lib/utils/use-persisted";
import { readCloudBlobs } from "./cloud-rows";

const NO_IDS: string[] = [];

/** The ids in a stored moved-ids record (anything else reads as none). */
const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/**
 * The one-time move of the tracker's old blob into workspace.featureFlags,
 * where Release Readiness, the next steps and agents can read the flags.
 *
 * The blob was cloud-synced and only loads once a page asks for it, so the
 * move lives here: it reads the blob, waits until the workspace is safe to
 * write (useLegacyMigrationMode, and the owner's first cloud pull), then
 * adds the flags the workspace doesn't have, by id (lib/flags
 * planLegacyMove). It never overwrites a workspace row and leaves the blob
 * as it is, as the backup. Returns true while flags are still waiting to
 * move.
 *
 * For the owner, the move plans on the cloud's copy of the blob and of the
 * moved-ids record (readCloudBlobs), not on this device's: their adapters
 * only start pulling as this hook mounts, after the first pull is over, and
 * a gap fill from an older copy would keep its stale rows for good (a flag
 * retired or renamed on another device read as live, one deleted there
 * back). The moved ids are the union of both copies: they only ever grow.
 * When the cloud can't be read, it moves what this device holds.
 */
export function useLegacyFlagMove(flags: readonly FeatureFlag[]): boolean {
  const [legacy] = usePersisted<unknown>(FLAGS_LEGACY_KEY, null);
  const [moved, setMoved] = usePersisted<string[]>(FLAGS_MOVED_KEY, NO_IDS);
  const plan = useMemo(() => planLegacyMove(legacy, flags, moved), [legacy, flags, moved]);
  const found = plan.toMove.length > 0 || plan.changed;
  const mode = useLegacyMigrationMode(found);
  const userId = useAuthOptional()?.user?.id ?? null;
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
    let cancelled = false;
    void (async () => {
      const cloud =
        mode === "cloud" && userId
          ? await readCloudBlobs(userId, [FLAGS_LEGACY_KEY, FLAGS_MOVED_KEY])
          : null;
      if (cancelled) return;
      const source = cloud?.has(FLAGS_LEGACY_KEY) ? cloud.get(FLAGS_LEGACY_KEY) : legacy;
      const known = Array.from(new Set([...idsOf(moved), ...idsOf(cloud?.get(FLAGS_MOVED_KEY))]));
      // Planned again on the store as it is now: the render's copy may be stale.
      const { featureFlags, upsertFeatureFlag } = useWorkspaceStore.getState();
      const now = planLegacyMove(source, featureFlags ?? [], known);
      now.toMove.forEach(upsertFeatureFlag);
      if (now.moved.length !== idsOf(moved).length) setMoved(now.moved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, found, mode, userId, legacy, moved, setMoved]);

  return plan.toMove.length > 0;
}
