"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AdkarDoc } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { readCloudBlobs } from "@/lib/sync/cloud-blobs";
import { todayIso } from "@/lib/sprints/series";
import { usePersisted } from "@/lib/utils/use-persisted";
import { ADKAR_DOC_ID, ADKAR_LEGACY_KEY, ADKAR_MOVED_KEY, planAdkarMove } from "@/lib/adkar/model";

const NO_IDS: string[] = [];

/** The ids in a stored moved-ids record (anything else reads as none). */
const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

/**
 * The one-time move of the tracker's old blob ("agile-toolkit:adkar", a
 * bare list of initiatives) into the workspace doc, where next steps and
 * agents can read it, as the feature flags' move does
 * (feature-flag-tracker/use-legacy-flags.ts).
 *
 * The blob was cloud-synced and only loads once a page asks for it, so the
 * move lives here: it reads the blob, waits until the workspace is safe to
 * write (useLegacyMigrationMode, and the owner's first cloud pull), then
 * adds the initiatives the doc doesn't have, by id (planAdkarMove), after
 * the doc's own ones and exactly as stored there. It never changes or
 * replaces an initiative already in the doc and leaves the blob as it is,
 * as the backup. The moved ids are recorded (the union of this device's
 * and the cloud's record), so one deleted since isn't moved again. For the
 * owner it plans on the cloud's copy of both blobs when it can read them.
 *
 * Returns true while initiatives are still waiting to move.
 */
export function useLegacyAdkarMove(doc: AdkarDoc | undefined): boolean {
  const [legacy] = usePersisted<unknown>(ADKAR_LEGACY_KEY, null);
  const [moved, setMoved] = usePersisted<string[]>(ADKAR_MOVED_KEY, NO_IDS);
  const [today] = useState(() => todayIso());
  const existing = doc?.initiatives;
  const plan = useMemo(
    () => planAdkarMove(legacy, existing ?? [], moved, today),
    [legacy, existing, moved, today]
  );
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
          ? await readCloudBlobs(userId, [ADKAR_LEGACY_KEY, ADKAR_MOVED_KEY])
          : null;
      if (cancelled) return;
      const source = cloud?.has(ADKAR_LEGACY_KEY) ? cloud.get(ADKAR_LEGACY_KEY) : legacy;
      const known = Array.from(new Set([...idsOf(moved), ...idsOf(cloud?.get(ADKAR_MOVED_KEY))]));
      // Planned again on the store as it is now: the render's copy may be stale.
      const { adkarDocs, upsertAdkarDoc } = useWorkspaceStore.getState();
      const current = (adkarDocs ?? []).find((d) => d.id === ADKAR_DOC_ID);
      const stored = Array.isArray(current?.initiatives) ? current.initiatives : [];
      const now = planAdkarMove(source, stored, known, todayIso());
      if (now.toMove.length > 0) {
        upsertAdkarDoc({ ...current, id: ADKAR_DOC_ID, initiatives: [...stored, ...now.toMove] });
      }
      if (now.moved.length !== idsOf(moved).length) setMoved(now.moved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, found, mode, userId, legacy, moved, setMoved]);

  return plan.toMove.length > 0;
}
