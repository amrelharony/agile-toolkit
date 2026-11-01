"use client";

import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DefinitionOfDone } from "@/lib/stores/workspace-types";
import { readCloudBlobs } from "@/lib/sync/cloud-blobs";
import { syncEngine } from "@/lib/sync/engine";
import { usePersisted } from "@/lib/utils/use-persisted";
import {
  DOD_DOC_ID,
  DOD_LEGACY_KEY,
  DOD_MOVED_KEY,
  emptyDefinitionOfDone,
  hasDodContent,
  isMovedMarker,
  normalizeDefinitionOfDone,
} from "./model";

export interface DefinitionOfDoneState {
  doc: DefinitionOfDone;
  /** Where `doc` came from: the workspace, the old blob (not moved yet), or nowhere. */
  source: "workspace" | "legacy" | "none";
  /**
   * The old blob holds a DoD the workspace doesn't have yet. Until it has
   * moved, a page shows the blob read-only: an edit made now would be built
   * from this device's copy before the move may run (the owner's first
   * cloud pull, an open merge/discard question), and would win over a newer
   * DoD another device already moved.
   */
  moving: boolean;
}

/**
 * The team's Definition of Done, for every page that reads it (the DoD
 * page, the Team charter, Release Readiness, the Sprint board), and the
 * one-time move of the DoD builder's old blob into the workspace.
 *
 * The blob was cloud-synced and only loads once a page asks for it, so any
 * of those pages can be the first to see it: each mounts this hook, and
 * until the move has run they read the blob. The move follows the feature
 * flags' (feature-flag-tracker/use-legacy-flags.ts): it waits until the
 * workspace is safe to write (useLegacyMigrationMode, and the owner's first
 * cloud pull), plans on the cloud's copy of the blob for the owner (this
 * device's may be stale), writes only when the workspace has no DoD (never
 * over one, so an emptied DoD stays empty), and leaves the blob as it is,
 * as the backup. Running it twice, or in two tabs, writes once.
 *
 * Once the workspace has a DoD the blob is marked moved (DOD_MOVED_KEY,
 * cloud-synced; the owner's cloud copy counts too), so a DoD deleted from
 * the workspace later stays deleted instead of coming back from the backup.
 */
export function useDefinitionOfDone(): DefinitionOfDoneState {
  const stored = useWorkspaceStore(
    useShallow((s) => (s.definitionsOfDone ?? []).find((d) => d.id === DOD_DOC_ID))
  );
  const [legacy] = usePersisted<unknown>(DOD_LEGACY_KEY, null);
  const [movedRaw, setMoved] = usePersisted<boolean>(DOD_MOVED_KEY, false);
  const moved = isMovedMarker(movedRaw);
  const legacyDoc = useMemo(() => normalizeDefinitionOfDone(legacy), [legacy]);
  const found = !stored && !moved && hasDodContent(legacyDoc);
  const mode = useLegacyMigrationMode(found);

  // A DoD in the workspace leaves the blob nothing to move: mark it, so the
  // backup is never copied back in once that DoD is deleted.
  useEffect(() => {
    if (stored && !moved && hasDodContent(legacyDoc)) setMoved(true);
  }, [stored, moved, legacyDoc, setMoved]);
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
          ? await readCloudBlobs(userId, [DOD_LEGACY_KEY, DOD_MOVED_KEY])
          : null;
      if (cancelled) return;
      // Moved on another device (whose workspace DoD may since be deleted).
      if (isMovedMarker(cloud?.get(DOD_MOVED_KEY))) {
        setMoved(true);
        return;
      }
      const source = normalizeDefinitionOfDone(
        cloud?.has(DOD_LEGACY_KEY) ? cloud.get(DOD_LEGACY_KEY) : legacy
      );
      // Checked again on the store as it is now: the render's copy may be stale.
      const { definitionsOfDone, upsertDefinitionOfDone } = useWorkspaceStore.getState();
      if ((definitionsOfDone ?? []).some((d) => d.id === DOD_DOC_ID)) {
        setMoved(true);
        return;
      }
      if (!hasDodContent(source)) return;
      upsertDefinitionOfDone(source);
      setMoved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, found, mode, userId, legacy, setMoved]);

  return useMemo(() => {
    if (stored) {
      return { doc: normalizeDefinitionOfDone(stored), source: "workspace", moving: false };
    }
    if (found) return { doc: legacyDoc, source: "legacy", moving: true };
    return { doc: emptyDefinitionOfDone(), source: "none", moving: false };
  }, [stored, found, legacyDoc]);
}
