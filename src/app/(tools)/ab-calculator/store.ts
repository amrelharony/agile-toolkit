/**
 * The A/B Calculator's writes, on the one store its agent verbs and next
 * step read (workspace.abTests). Store writes stamp nothing: the page
 * stamps createdAt and updatedAt, as the workspace CRUD does for agents.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AbTest } from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

/** Every stored row, fresh (not a render's copy). */
export const currentTests = (): AbTest[] => ws().abTests ?? [];

export const findTest = (id: string): AbTest | undefined => currentTests().find((t) => t.id === id);

export function saveTest(t: AbTest): AbTest {
  ws().upsertAbTest(t);
  return t;
}

/** Remove a row, returning it (for Undo), or null when it was already gone. */
export function removeTest(id: string): AbTest | null {
  const t = findTest(id);
  if (!t) return null;
  ws().removeAbTest(id);
  return t;
}
