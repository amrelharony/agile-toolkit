/**
 * Team Time's data-aware next steps (lib/tools/next-steps.ts calls
 * `teamTimeSteps` with the time now and the viewer's zone). Pure: no store,
 * no React, no "use client" module. Example rows never count.
 *
 *   1. team-time-zones: two roster people or more, fewer than half with a row.
 *   2. team-time-daily: the saved cadence's next Daily Scrum is outside
 *      someone's hours (only with a saved cadence: the default isn't the team's).
 *   3. team-time-core-hours: everyone shares under an hour on the best day
 *      and the charter has no core-hours rule.
 *   4. team-time-ladder: the places span 3 hours or more and the charter has
 *      no urgency ladder.
 *   5. team-time-poll: an open poll has waited 3 days for a choice.
 */

import {
  WORKING_AGREEMENT_ID,
  type CeremonyCadenceDoc,
  type TeamMember,
  type TeamTimePerson,
  type TeamTimePoll,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { namesList, personName } from "./format";
import {
  POLL_WAIT_DAYS,
  ceremonyTimes,
  meetingBurdens,
  personRows,
  readPeople,
  readPolls,
  savedCadence,
} from "./model";
import { bestDayMinutes, DAY_MS, sharedWindows, weekRange } from "./overlap";
import { canonicalZone, offsetMinutes } from "./zones";

/** What the rule reads from the workspace. */
export interface TeamTimeStepsInput {
  people: readonly TeamTimePerson[] | undefined;
  members: readonly TeamMember[];
  cadences: readonly CeremonyCadenceDoc[] | undefined;
  agreements: readonly WorkingAgreement[] | undefined;
  polls: readonly TeamTimePoll[] | undefined;
}

/** Under this many shared minutes on the best day, the team needs core hours. */
export const CORE_HOURS_MIN_MINUTES = 60;
/** From this many hours between the first and last place, an urgency ladder helps. */
export const LADDER_SPREAD_HOURS = 3;

const HREF = "/team-time";

/** Whether the charter has a rule from `templateId`. */
function hasTemplateRule(agreements: readonly WorkingAgreement[] | undefined, templateId: string) {
  const doc =
    (agreements ?? []).find((d) => d.id === WORKING_AGREEMENT_ID) ?? (agreements ?? [])[0];
  return (doc?.rules ?? []).some((r) => r.template?.id === templateId);
}

/** Team Time's next steps, given the time now and the viewer's time zone. */
export function teamTimeSteps(s: TeamTimeStepsInput, now: Date, timeZone: string): NextStep[] {
  const zone = canonicalZone(timeZone) ?? "UTC";
  const at = now.getTime();
  const people = readPeople(s.people).filter((p) => !isExampleId(p.id));
  const members = (s.members ?? []).filter((m) => !isExampleId(m.id));
  const steps: NextStep[] = [];

  // 1. Time zones for the roster.
  if (members.length >= 2) {
    const covered = personRows(members, people).filter((r) => r.member && r.person).length;
    if (covered * 2 < members.length) {
      steps.push({
        id: "team-time-zones",
        label: "Add your team's time zones",
        detail: `${covered} of ${members.length} people on the roster have their hours in Team Time.`,
        href: HREF,
      });
    }
  }

  if (people.length === 0) return withPoll(steps, s, at);

  // 2. The Daily Scrum outside people's hours.
  const cadence = savedCadence(s.cadences);
  const daily = cadence ? ceremonyTimes(cadence, at, zone).find((c) => c.kind === "daily") : null;
  if (cadence && daily) {
    const outside = meetingBurdens(people, daily.start, daily.minutes).filter((b) => b.burden >= 1);
    if (outside.length > 0) {
      const names = outside.map((b) =>
        personName(people.find((p) => p.id === b.personId)!, members)
      );
      const k = outside.length;
      steps.push({
        id: "team-time-daily",
        label: `Use written updates for ${k} ${k === 1 ? "person" : "people"} outside their hours`,
        detail: `The Daily Scrum at ${daily.time} your time is outside working hours for ${namesList(names.slice(0, 4))}${names.length > 4 ? ` and ${names.length - 4} more` : ""}.`,
        href: "/async-standup",
      });
    }
  }

  if (people.length >= 2) {
    // 3. Core hours.
    const week = weekRange(zone, at);
    const shared = sharedWindows(people, week.from, week.to);
    const best = bestDayMinutes(shared.everyone, zone);
    if (best < CORE_HOURS_MIN_MINUTES && !hasTemplateRule(s.agreements, "core-hours")) {
      steps.push({
        id: "team-time-core-hours",
        label: "Agree core hours",
        detail:
          best > 0
            ? `Everyone shares ${best} minutes on the best day. Agree when you meet and when you write.`
            : "No hour of the week has everyone working. Agree when you meet and when you write.",
        href: "/working-agreement?template=core-hours",
      });
    }

    // 4. An urgency ladder across the places.
    const offsets = people.map((p) => offsetMinutes(p.timeZone, at));
    const spread = (Math.max(...offsets) - Math.min(...offsets)) / 60;
    if (spread >= LADDER_SPREAD_HOURS && !hasTemplateRule(s.agreements, "urgency-ladder")) {
      steps.push({
        id: "team-time-ladder",
        label: "Add an urgency ladder",
        detail: `Your places are ${Math.round(spread * 10) / 10} hours apart: agree how to reach each other, and how fast to answer.`,
        href: "/working-agreement?template=urgency-ladder",
      });
    }
  }

  return withPoll(steps, s, at);
}

/** 5. The oldest open poll that has waited for a choice. */
function withPoll(steps: NextStep[], s: TeamTimeStepsInput, at: number): NextStep[] {
  const waiting = readPolls(s.polls)
    .filter((p) => !isExampleId(p.id) && p.status === "open" && !p.chosenSlotId)
    .filter((p) => {
      const created = Date.parse(p.createdAt);
      return !Number.isNaN(created) && at - created >= POLL_WAIT_DAYS * DAY_MS;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (waiting) {
    steps.push({
      id: "team-time-poll",
      label: `Choose a time for ${waiting.title || "the meeting"}`,
      detail: `The poll has been open for ${Math.floor((at - Date.parse(waiting.createdAt)) / DAY_MS)} days.`,
      href: HREF,
    });
  }
  return steps;
}
