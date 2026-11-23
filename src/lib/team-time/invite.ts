/**
 * A chosen poll time, to send: one calendar entry (its UID stays the same
 * from one download to the next, so a calendar replaces it) and an invite
 * with each person's own time. Pure; the page saves the file
 * (`exportToICS`) and copies the invite.
 */

import { UID_DOMAIN, uidPart, type CalendarEntry } from "@/lib/sprints/ics";
import type { TeamTimePerson, TeamTimePoll } from "@/lib/stores/workspace-types";
import { localDateTimeText, minutesText, placeLabel, slotLabel } from "./format";
import { MINUTE_MS } from "./overlap";
import { BURDEN_LABEL, burden } from "./slots";

/** Each person's time for the slot, as the invite and the calendar entry list them. */
export function slotTimes(
  poll: Pick<TeamTimePoll, "minutes">,
  start: string,
  people: readonly TeamTimePerson[],
  name: (id: string) => string
): string[] {
  const at = Date.parse(start);
  return people.map((p) => {
    const b = burden(p, at, at + poll.minutes * MINUTE_MS);
    return `${name(p.id)} (${placeLabel(p)}): ${localDateTimeText(p.timeZone, at)}${b === 0 ? "" : `, ${BURDEN_LABEL[b]}`}`;
  });
}

/** The poll's chosen time as one calendar entry, or null with no chosen slot. */
export function pollCalendarEntry(
  poll: TeamTimePoll,
  people: readonly TeamTimePerson[],
  name: (id: string) => string,
  origin: string
): CalendarEntry | null {
  const slot = poll.slots.find((s) => s.id === poll.chosenSlotId);
  const at = slot ? Date.parse(slot.start) : NaN;
  if (!slot || Number.isNaN(at)) return null;
  const base = origin.trim().replace(/\/+$/, "") || `https://${UID_DOMAIN}`;
  return {
    uid: `team-time-poll-${uidPart(poll.id)}@${UID_DOMAIN}`,
    when: { type: "timed", start: new Date(at), end: new Date(at + poll.minutes * MINUTE_MS) },
    summary: poll.title,
    description: [
      `Chosen in Team Time: ${slotLabel(slot.start)}, ${minutesText(poll.minutes)}.`,
      ...slotTimes(poll, slot.start, people, name),
    ].join("\n"),
    url: `${base}/team-time`,
  };
}

/** The invite to paste: the title, the time in UTC and each person's own time. */
export function inviteMarkdown(
  poll: TeamTimePoll,
  people: readonly TeamTimePerson[],
  name: (id: string) => string
): string {
  const slot = poll.slots.find((s) => s.id === poll.chosenSlotId);
  if (!slot) return "";
  return [
    `**${poll.title.replace(/\s+/g, " ").trim()}**`,
    `${slotLabel(slot.start)}, ${minutesText(poll.minutes)}`,
    "",
    ...slotTimes(poll, slot.start, people, name).map((l) => `- ${l}`),
  ].join("\n");
}
