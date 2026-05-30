"use client";

/**
 * Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
 * post-mortem writes round-trip into the UI. Drop-in [state, setState] bridging
 * the local PMState shape to the PostMortemLog entity (structurally equal).
 */

import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PostMortemLog } from "@/lib/stores/workspace-types";
import type { PMState } from "./types";
import { DEFAULT_STATE, PM_ID } from "./constants";

export function usePostMortemLog(): [PMState, (u: PMState | ((p: PMState) => PMState)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.postMortemLogs ?? []).find((d) => d.id === PM_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertPostMortemLog);
  const state: PMState = doc ? { postmortems: doc.postmortems } : DEFAULT_STATE;
  const setState = (u: PMState | ((p: PMState) => PMState)) => {
    const cur = (useWorkspaceStore.getState().postMortemLogs ?? []).find(
      (d: PostMortemLog) => d.id === PM_ID
    );
    const curState: PMState = cur ? { postmortems: cur.postmortems } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: PM_ID, postmortems: next.postmortems });
  };
  return [state, setState];
}
