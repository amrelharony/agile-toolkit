/**
 * Notes to Actions' form checks: pasted notes (at most 12,000 characters:
 * longer notes go in parts), the meeting's name and its day; and a kept
 * item (kind, words, owner, due day, detail). Pure. The caps are the
 * CRUD's, so an agent's update of the same note is never refused for what
 * the page saved.
 */

import {
  MEETING_NOTE_ITEM_KINDS,
  TOOL_TEXT_MAX,
  type MeetingNoteItemKind,
} from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { isDay } from "@/lib/notes-to-actions/due";

export interface PasteDraft {
  text: string;
  meeting: string;
  date: string;
}
export type PasteField = keyof PasteDraft;
export interface PasteValues {
  text: string;
  meeting?: string;
  date: string;
}

export const PASTE_TOO_LONG = `That's more than ${TOOL_TEXT_MAX.paste.toLocaleString("en-GB")} characters. Split it into parts and paste each one.`;

/** Notes need some text within the cap, and a real day. */
export function validatePaste(d: PasteDraft): Validation<PasteValues, PasteField> {
  const errors: FormErrors<PasteField> = {};
  const meeting = d.meeting.trim();
  if (!d.text.trim()) errors.text = "Paste the meeting's notes.";
  else if (d.text.length > TOOL_TEXT_MAX.paste) errors.text = PASTE_TOO_LONG;
  if (meeting.length > TOOL_TEXT_MAX.short)
    errors.meeting = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  if (!isDay(d.date)) errors.date = "Pick the meeting's day.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { text: d.text, date: d.date, ...(meeting ? { meeting } : {}) } };
}

export interface ItemDraft {
  kind: MeetingNoteItemKind;
  text: string;
  owner: string;
  due: string;
  detail: string;
}
export type ItemField = keyof ItemDraft;
export interface ItemValues {
  kind: MeetingNoteItemKind;
  text: string;
  owner?: string;
  due?: string;
  detail?: string;
}

/** A kept item needs its words; the rest stays within the caps, a due day a real one. */
export function validateItem(d: ItemDraft): Validation<ItemValues, ItemField> {
  const errors: FormErrors<ItemField> = {};
  const text = d.text.trim();
  const owner = d.owner.trim();
  const detail = d.detail.trim();
  if (!(MEETING_NOTE_ITEM_KINDS as readonly string[]).includes(d.kind))
    errors.kind = "Pick a kind.";
  if (!text) errors.text = "Say what it is, in a few words.";
  else if (text.length > TOOL_TEXT_MAX.short)
    errors.text = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (owner.length > TOOL_TEXT_MAX.short)
    errors.owner = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  if (d.due && !isDay(d.due)) errors.due = "Pick a real day, or leave it empty.";
  if (detail.length > TOOL_TEXT_MAX.text)
    errors.detail = `Keep the detail to ${TOOL_TEXT_MAX.text} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      kind: d.kind,
      text,
      ...(owner ? { owner } : {}),
      ...(d.due ? { due: d.due } : {}),
      ...(detail ? { detail } : {}),
    },
  };
}

/** The draft for an item as kept. */
export const itemDraftFrom = (i: {
  kind: MeetingNoteItemKind;
  text: string;
  owner?: string;
  due?: string;
  detail?: string;
}): ItemDraft => ({
  kind: i.kind,
  text: i.text,
  owner: i.owner ?? "",
  due: i.due ?? "",
  detail: i.detail ?? "",
});
