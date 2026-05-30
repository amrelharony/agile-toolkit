"use client";

/**
 * Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
 * incident writes round-trip into the UI. Drop-in [state, setState] bridging
 * the local IncidentState shape to the IncidentCommander entity (structurally
 * equal).
 */

import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { IncidentCommander } from "@/lib/stores/workspace-types";
import type { IncidentState } from "./types";
import { DEFAULT_STATE, IC_ID } from "./constants";

export function useIncidentCommander(): [
  IncidentState,
  (u: IncidentState | ((p: IncidentState) => IncidentState)) => void,
] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.incidentCommanders ?? []).find((d) => d.id === IC_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertIncidentCommander);
  const state: IncidentState = doc ? { incidents: doc.incidents } : DEFAULT_STATE;
  const setState = (u: IncidentState | ((p: IncidentState) => IncidentState)) => {
    const cur = (useWorkspaceStore.getState().incidentCommanders ?? []).find(
      (d: IncidentCommander) => d.id === IC_ID
    );
    const curState: IncidentState = cur ? { incidents: cur.incidents } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: IC_ID, incidents: next.incidents });
  };
  return [state, setState];
}
