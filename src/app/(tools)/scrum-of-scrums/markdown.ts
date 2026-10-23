import type { ISODateString, SosEntry } from "@/lib/stores/workspace-types";
import { dayLabel } from "../dependency-map/format";
import {
  KIND_LABEL,
  ageDays,
  carriedForward,
  entriesOn,
  isTracked,
  type TrackedStatus,
} from "./agenda";
import { meetingVerdict } from "./verdict";

/** One line of Markdown: newlines folded into spaces. */
const line = (s: string | undefined) => (s ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();

function entryLine(
  e: SosEntry,
  status: (e: SosEntry) => TrackedStatus | null,
  { prefix = "", suffix = "" }: { prefix?: string; suffix?: string } = {}
): string {
  const waits = e.blockedBy
    ? ` (${e.kind === "dependency" ? "waits on" : "blocked by"} ${line(e.blockedBy)})`
    : "";
  const s = isTracked(e.kind) ? ` — ${status(e) === "resolved" ? "Resolved" : "Open"}` : "";
  return `- ${prefix}**${line(e.team)}**: ${line(e.text)}${waits}${s}${suffix}`;
}

/**
 * Minutes for one meeting: the verdict, what carried forward from earlier
 * meetings (with how long it has been open), then this meeting's blockers,
 * dependencies, decisions and updates.
 */
export function toMinutes(
  entries: readonly SosEntry[],
  date: ISODateString,
  today: ISODateString,
  status: (e: SosEntry) => TrackedStatus | null
): string {
  const lines = [
    `# Scrum of Scrums — ${dayLabel(date, true)}`,
    "",
    `**${meetingVerdict(entries, date, today, status)}**`,
  ];
  const carried = carriedForward(entries, date, status);
  if (carried.length > 0) {
    lines.push(
      "",
      "## Carried forward",
      "",
      ...carried.map((e) => {
        const age = ageDays(e, today);
        const days = age !== null ? ` (${age} ${age === 1 ? "day" : "days"})` : "";
        return entryLine(e, status, {
          prefix: `${KIND_LABEL[e.kind].one} · `,
          suffix: `, raised ${dayLabel(e.meetingDate, true)}${days}`,
        });
      })
    );
  }
  for (const group of entriesOn(entries, date)) {
    lines.push(
      "",
      `## ${KIND_LABEL[group.kind].many}`,
      "",
      ...group.entries.map((e) => entryLine(e, status))
    );
  }
  return `${lines.join("\n")}\n`;
}
