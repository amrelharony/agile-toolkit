/**
 * Meeting Audit's writes, on the one store its agent verbs and next step read
 * (workspace.meetingAudits). Store writes stamp nothing: the page stamps
 * createdAt and updatedAt (lib/meeting-audit/model), as the workspace CRUD
 * does for agents.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MeetingAudit } from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

/** Every stored row, fresh (not a render's copy). */
export const currentAudits = (): MeetingAudit[] => ws().meetingAudits ?? [];

export const findAudit = (id: string): MeetingAudit | undefined =>
  currentAudits().find((a) => a.id === id);

export function saveAudit(a: MeetingAudit): MeetingAudit {
  ws().upsertMeetingAudit(a);
  return a;
}

/** Remove a row, returning it (for Undo), or null when it was already gone. */
export function removeAudit(id: string): MeetingAudit | null {
  const a = findAudit(id);
  if (!a) return null;
  ws().removeMeetingAudit(id);
  return a;
}
