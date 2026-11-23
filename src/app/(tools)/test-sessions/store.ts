/**
 * Test Sessions' writes, on the one store its agent verbs and next step read
 * (workspace.testSessions). Store writes stamp nothing: the page stamps
 * createdAt and updatedAt, as the workspace CRUD does for agents.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TestSession, TestSessionNote } from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

/** Every stored row, fresh (not a render's copy). */
export const currentSessions = (): TestSession[] => ws().testSessions ?? [];

export const findSession = (id: string): TestSession | undefined =>
  currentSessions().find((s) => s.id === id);

export function saveSession(session: TestSession): TestSession {
  ws().upsertTestSession(session);
  return session;
}

/** Change one row with `fn`, stamped now; false when it is gone. */
export function patchSession(id: string, fn: (s: TestSession) => TestSession): boolean {
  const s = findSession(id);
  if (!s) return false;
  ws().upsertTestSession({ ...fn(s), updatedAt: new Date().toISOString() });
  return true;
}

/** Change one note of a session with `fn`; false when either is gone. */
export function patchNote(
  sessionId: string,
  noteId: string,
  fn: (n: TestSessionNote) => TestSessionNote
): boolean {
  const s = findSession(sessionId);
  if (!s || !s.notes.some((n) => n.id === noteId)) return false;
  return patchSession(sessionId, (x) => ({
    ...x,
    notes: x.notes.map((n) => (n.id === noteId ? fn(n) : n)),
  }));
}

/** Remove a row, returning it (for Undo), or null when it was already gone. */
export function removeSession(id: string): TestSession | null {
  const s = findSession(id);
  if (!s) return null;
  ws().removeTestSession(id);
  return s;
}
