import {
  MEETING_NOTE_ITEM_KINDS,
  type MeetingNote,
  type MeetingNoteItem,
} from "@/lib/stores/workspace-types";
import { KIND_LABEL, ROUTE_PLACE, isNoteRoute } from "@/lib/notes-to-actions/model";

/** One line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const STATUS_WORD: Record<MeetingNoteItem["status"], string> = {
  open: "open",
  sent: "sent",
  dropped: "dropped",
  answered: "answered",
};

/** Where an item went, in words: "sent to Retro Actions". */
function whereTo(item: MeetingNoteItem): string {
  const routes = (item.sentTo ?? []).map((l) => l.route).filter(isNoteRoute);
  if (routes.length === 0) return STATUS_WORD[item.status];
  return `sent to ${routes.map((r) => ROUTE_PLACE[r]).join(", ")}`;
}

/**
 * A meeting's follow-ups for a channel or a mail: the meeting, its day, and
 * the items by kind with owner, due day and where each went. Never the
 * pasted text or a quote: those stay in the browser.
 */
export function notesMarkdown(note: MeetingNote): string {
  const title = `# ${md(note.meeting || "Meeting")} — ${note.date}`;
  if (note.items.length === 0) return `${title}\n\nNo items kept yet.\n`;
  const lines = [title];
  for (const kind of MEETING_NOTE_ITEM_KINDS) {
    const items = note.items.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    lines.push("", `## ${KIND_LABEL[kind]}`, "");
    for (const i of items) {
      const meta = [
        i.owner ? `owner ${md(i.owner)}` : "",
        i.due ? `due ${i.due}` : "",
        whereTo(i),
      ].filter(Boolean);
      lines.push(`- ${md(i.text)} (${meta.join("; ")})`);
      if (i.detail) lines.push(`  ${md(i.detail)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
