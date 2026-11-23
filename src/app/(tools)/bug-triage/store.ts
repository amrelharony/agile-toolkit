/**
 * Bug Triage's writes, on the one store its agent verbs and next step read
 * (workspace.bugReports). Store writes stamp nothing: the page stamps
 * createdAt and updatedAt (lib/bug-triage/model), as the workspace CRUD does
 * for agents.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BugReport } from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

/** Every stored row, fresh (not a render's copy). */
export const currentBugs = (): BugReport[] => ws().bugReports ?? [];

export const findBug = (id: string): BugReport | undefined =>
  currentBugs().find((b) => b.id === id);

export function saveBug(bug: BugReport): BugReport {
  ws().upsertBugReport(bug);
  return bug;
}

/** Change one row with `fn`; false when it is gone. */
export function patchBug(id: string, fn: (bug: BugReport) => BugReport): boolean {
  const bug = findBug(id);
  if (!bug) return false;
  ws().upsertBugReport(fn(bug));
  return true;
}

/** Remove a row, returning it (for Undo), or null when it was already gone. */
export function removeBug(id: string): BugReport | null {
  const bug = findBug(id);
  if (!bug) return null;
  ws().removeBugReport(id);
  return bug;
}
