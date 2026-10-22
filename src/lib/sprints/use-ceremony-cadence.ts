"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type CeremonyCadenceDoc,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { normalizeCadence, type CeremonyCadence } from "./cadence";

/**
 * The team's ceremony cadence: the `CEREMONY_CADENCE_ID` document of the
 * workspace, so the Sprint Cockpit, the team charter and agents
 * (`tool.ceremony_cadence.*`, `workspace.ceremony_cadence.*`) share one row
 * that syncs like every other entity. Readers normalise it; until the team
 * sets one, the defaults apply.
 *
 * Before this the cadence was a per-browser blob under `CADENCE_KEY`. The
 * first mount after the workspace has loaded moves that blob into the
 * document, once, while the workspace holds none; the blob stays behind as a
 * backup (nothing reads or syncs it any more).
 */

/** The old per-browser blob's key: read once by the migration, never written. */
export const CADENCE_KEY = "agile-toolkit:ceremony-cadence:v1";

/** The cadence document, or undefined until the team sets one. */
export function selectCadenceDoc(
  s: Pick<Workspace, "ceremonyCadences">
): CeremonyCadenceDoc | undefined {
  return (s.ceremonyCadences ?? []).find((d) => d.id === CEREMONY_CADENCE_ID);
}

/** The document for a cadence. */
export function cadenceDoc(cadence: CeremonyCadence): CeremonyCadenceDoc {
  return { id: CEREMONY_CADENCE_ID, ...cadence };
}

/**
 * Moves the old per-browser blob into the workspace: only once the workspace
 * has loaded (against an empty one it would write a document that hydration
 * then overwrites, or shadow the saved one) and only while it holds no
 * cadence. Returns true when it wrote.
 */
export function migrateLegacyCadence(): boolean {
  if (typeof window === "undefined") return false;
  const store = useWorkspaceStore;
  if (!store.persist?.hasHydrated()) return false;
  if (selectCadenceDoc(store.getState())) return false;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CADENCE_KEY);
  } catch {
    return false;
  }
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  store.getState().upsertCeremonyCadence(cadenceDoc(normalizeCadence(parsed)));
  return true;
}

export function useCeremonyCadence(): [CeremonyCadence, (patch: Partial<CeremonyCadence>) => void] {
  const doc = useWorkspaceStore(selectCadenceDoc);
  const cadence = useMemo(() => normalizeCadence(doc), [doc]);

  // The one-time move of the old blob, as soon as the workspace has loaded.
  useEffect(() => {
    const persist = useWorkspaceStore.persist;
    if (!persist || persist.hasHydrated()) {
      migrateLegacyCadence();
      return;
    }
    return persist.onFinishHydration(() => {
      migrateLegacyCadence();
    });
  }, []);

  const update = useCallback((patch: Partial<CeremonyCadence>) => {
    const state = useWorkspaceStore.getState();
    const current = normalizeCadence(selectCadenceDoc(state));
    state.upsertCeremonyCadence(cadenceDoc(normalizeCadence({ ...current, ...patch })));
  }, []);

  return [cadence, update];
}
