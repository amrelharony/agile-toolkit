import type { ParkingLotItem } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  ROUTE_PLACE,
  STATUS_LABEL,
  isParkingRoute,
  meetingsOf,
  meetingKey,
  oneLine,
  parkingSummary,
  summaryText,
  type ParkingRoute,
} from "@/lib/parking-lot/model";

/** "12 Nov 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The local day a point was parked, as the row shows it ("" for a row with no usable time). */
function parkedDay(createdAt: string): string {
  const at = new Date(createdAt);
  return Number.isFinite(at.getTime()) ? todayLocalISO(at) : "";
}

/** A table cell or list line: one line, pipes escaped. */
const cell = (v: string) => oneLine(v).replace(/\|/g, "\\|");

/** Where it went, in words: "the backlog and Retro Actions". */
function sentText(item: ParkingLotItem): string {
  const places = Array.from(
    new Set(
      (item.sentTo ?? [])
        .filter((l) => isParkingRoute(l.route))
        .map((l) => ROUTE_PLACE[l.route as ParkingRoute])
    )
  );
  if (places.length === 0) return "";
  return places.length === 1
    ? places[0]
    : `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}

/** One point as a checklist line: open unticked, decided ticked, with what became of it. */
function line(item: ParkingLotItem): string {
  const who = item.raisedBy ? ` (raised by ${cell(item.raisedBy)})` : "";
  const what =
    item.status === "sent"
      ? ` — sent to ${sentText(item) || "another tool"}`
      : item.status === "open"
        ? ""
        : ` — ${STATUS_LABEL[item.status].toLowerCase()}`;
  const text = item.status === "dropped" ? `~~${cell(item.text)}~~` : cell(item.text);
  return `- [${item.status === "open" ? " " : "x"}] ${text}${who}${what}`;
}

/**
 * The parking lot as Markdown, for the meeting's notes: the counts, then the
 * points by meeting (the most recent meeting first), open ones first within
 * each, as a checklist that says where each decided point went. `scope`
 * names the meeting filter when one is on.
 */
export function toMarkdown(
  items: readonly ParkingLotItem[],
  now: Date = new Date(),
  scope?: string
): string {
  const title = `# Parking lot${scope ? ` — ${cell(scope)}` : ""}`;
  if (items.length === 0) return `${title}\n\nNothing parked yet.\n`;
  const lines = [title, "", `${mdDate(now)} · ${summaryText(parkingSummary(items))}`, ""];
  for (const group of meetingsOf(items)) {
    const points = items
      .filter((i) => meetingKey(i.meeting) === group.key)
      .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open"));
    lines.push(`## ${group.name ? cell(group.name) : "No meeting named"}`, "");
    lines.push(...points.map(line), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The CSV the export offers: one row per point. */
export function toCsv(items: readonly ParkingLotItem[]): {
  headers: string[];
  rows: string[][];
} {
  return {
    headers: ["Point", "Meeting", "Raised by", "Status", "Sent to", "Parked"],
    rows: items.map((i) => [
      oneLine(i.text),
      i.meeting ?? "",
      i.raisedBy ?? "",
      STATUS_LABEL[i.status],
      sentText(i),
      parkedDay(i.createdAt),
    ]),
  };
}
