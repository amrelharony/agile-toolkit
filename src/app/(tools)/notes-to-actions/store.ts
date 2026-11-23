/**
 * Notes to Actions' writes, through the workspace store
 * (workspace.meetingNotes, the slice Amr's verbs and the next step read).
 * Each change reads the note fresh, so an Undo or a send that lands after
 * another write never puts back a stale copy. Stamps updatedAt; the store
 * stamps nothing.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MeetingNote, MeetingNoteItem } from "@/lib/stores/workspace-types";
import { readMeetingNote } from "@/lib/notes-to-actions/model";

const ws = () => useWorkspaceStore.getState();

/** Every note as stored. */
export const currentNotes = (): MeetingNote[] => ws().meetingNotes ?? [];

/** One note as the page reads it, or null when it is gone. */
export function findNote(id: string): MeetingNote | null {
  const raw = currentNotes().find((n) => n.id === id);
  return raw ? readMeetingNote(raw) : null;
}

/** One kept item, read fresh. */
export const findItem = (noteId: string, itemId: string): MeetingNoteItem | undefined =>
  findNote(noteId)?.items.find((i) => i.id === itemId);

/** Save a note as given (Undo puts back exactly what it had). */
export function saveNote(note: MeetingNote): void {
  ws().upsertMeetingNote(note);
}

/** Change a note with `fn` and stamp it; returns what was saved, or null when it is gone. */
export function patchNote(id: string, fn: (note: MeetingNote) => MeetingNote): MeetingNote | null {
  const current = findNote(id);
  if (!current) return null;
  const next = fn(current);
  if (next === current) return current;
  const saved = { ...next, updatedAt: new Date().toISOString() };
  saveNote(saved);
  return saved;
}

/** Change one item of a note. */
export function patchItem(
  noteId: string,
  itemId: string,
  fn: (item: MeetingNoteItem) => MeetingNoteItem
): MeetingNote | null {
  return patchNote(noteId, (n) => ({
    ...n,
    items: n.items.map((i) => (i.id === itemId ? fn(i) : i)),
  }));
}

/** Remove a note; returns what was removed (for Undo), or null. */
export function removeNote(id: string): MeetingNote | null {
  const raw = currentNotes().find((n) => n.id === id);
  if (!raw) return null;
  ws().removeMeetingNote(id);
  return raw;
}
