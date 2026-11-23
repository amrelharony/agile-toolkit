/**
 * Team Time as Markdown: the people, the week's shared hours (on the
 * display clock and in UTC) and the clock changes ahead, each poll with its
 * tallies and the chosen time, each rotation's next meetings and points,
 * and the office days with each office's anchor day. Pure.
 */

import type {
  TeamMember,
  TeamTimePerson,
  TeamTimePoll,
  TeamTimeRotation,
} from "@/lib/stores/workspace-types";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import {
  daysLabel,
  hoursText,
  localDateTimeText,
  minutesText,
  personName,
  placeLabel,
  slotLabel,
} from "@/lib/team-time/format";
import { clockChangeLine } from "@/lib/team-time/note";
import { officeGroups } from "@/lib/team-time/office";
import { clockChanges, sharedWindows, weekRange, windowLines } from "@/lib/team-time/overlap";
import {
  ROTATION_PLAN_COUNT,
  burdenTotals,
  fairnessLine,
  nextOccurrences,
} from "@/lib/team-time/rotation";
import { ANSWER_LABEL, BURDEN_LABEL, bestSlot, tallies } from "@/lib/team-time/slots";
import { currentZoneName, zoneLabel } from "@/lib/team-time/zones";

/** One line of text, with Markdown's marks escaped (as the SM Notebook's export does). */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const inline = (s: string) => oneLine(s).replace(/([\\`*_[\]#<>|])/g, "\\$1");

export interface TeamTimeMarkdownInput {
  people: readonly TeamTimePerson[];
  roster: readonly TeamMember[];
  polls: readonly TeamTimePoll[];
  rotations: readonly TeamTimeRotation[];
  /** The clock the shared hours are shown on. */
  zone: string;
  now: Date;
  holidays?: readonly string[];
}

export function teamTimeMarkdown(i: TeamTimeMarkdownInput): string {
  const name = (id: string) => {
    const p = i.people.find((x) => x.id === id);
    return p ? personName(p, i.roster) : id;
  };
  const lines: string[] = ["# Team Time", ""];

  lines.push("## People", "");
  if (i.people.length === 0) lines.push("No one yet.", "");
  else {
    lines.push(
      "| Name | Time zone | Hours (their time) | Working days | Office days | Office |",
      "| --- | --- | --- | --- | --- | --- |"
    );
    for (const p of i.people) {
      lines.push(
        `| ${inline(name(p.id))} | ${inline(currentZoneName(p.timeZone))} | ${hoursText(p)} | ${daysLabel(p.workingDays)} | ${p.officeDays?.length ? daysLabel(p.officeDays) : "–"} | ${p.site ? inline(p.site) : "–"} |`
      );
    }
    lines.push("");
  }

  if (i.people.length >= 2) {
    const week = weekRange(i.zone, i.now);
    const shared = sharedWindows(i.people, week.from, week.to);
    lines.push(`## Shared hours, week of ${week.days[0]}`, "");
    const say = (zone: string) => {
      const out = [
        ...windowLines(shared.everyone, zone).map(
          (l) => `- Everyone: ${l.start}–${l.end} (${zoneLabel(zone)}), ${daysLabel(l.days)}`
        ),
        ...windowLines(shared.allButOne, zone).map(
          (l) =>
            `- All but ${inline(name(l.leftOut ?? ""))}: ${l.start}–${l.end} (${zoneLabel(zone)}), ${daysLabel(l.days)}`
        ),
      ];
      return out.length > 0 ? out : ["- No hour this week has everyone, or all but one, working."];
    };
    lines.push(...say(i.zone));
    if (i.zone !== "UTC") lines.push(...say("UTC").filter((l) => !l.startsWith("- No hour")));
    lines.push("");
    const changes = clockChanges(i.people, i.now, 8, i.zone);
    if (changes.length > 0) {
      lines.push("### Clock changes ahead", "");
      for (const c of changes) lines.push(`- ${clockChangeLine(c, i.zone)}`);
      lines.push("");
    }
  }

  if (i.polls.length > 0) {
    lines.push("## Polls", "");
    for (const poll of i.polls) {
      const t = tallies(poll);
      const best = bestSlot(poll);
      lines.push(
        `### ${inline(poll.title)} (${minutesText(poll.minutes)}, ${poll.status === "closed" ? "closed" : "open"})`,
        ""
      );
      for (const s of poll.slots) {
        const mark =
          poll.chosenSlotId === s.id
            ? " **chosen**"
            : best === s.id && poll.status === "open"
              ? " (best so far)"
              : "";
        lines.push(
          `- ${slotLabel(s.start)}: ${t[s.id].yes} ${ANSWER_LABEL.yes.toLowerCase()}, ${t[s.id].maybe} ${ANSWER_LABEL.maybe.toLowerCase()}, ${t[s.id].no} ${ANSWER_LABEL.no.toLowerCase()}${mark}`
        );
      }
      lines.push("");
    }
  }

  if (i.rotations.length > 0) {
    lines.push("## Rotations", "");
    for (const r of i.rotations) {
      const label = (id: string) => {
        const o = r.options.find((x) => x.id === id);
        return o
          ? o.label
            ? inline(o.label)
            : `${WEEKDAY_LABEL[o.weekday]} ${o.time} ${zoneLabel(o.timeZone)}`
          : id;
      };
      lines.push(
        `### ${inline(r.meeting)} (every ${r.everyWeeks === 1 ? "week" : `${r.everyWeeks} weeks`}, ${r.mode === "fairest" ? "fairest" : "in turn"})`,
        "",
        `Times: ${r.options.map((o) => `${label(o.id)} (${WEEKDAY_LABEL[o.weekday]} ${o.time}, ${zoneLabel(o.timeZone)})`).join("; ")}.`,
        ""
      );
      for (const o of nextOccurrences(r, i.people, i.now, ROTATION_PLAN_COUNT, {
        holidays: i.holidays,
      })) {
        const outside = Object.entries(o.burdens)
          .filter(([, b]) => b > 0)
          .map(([id, b]) => `${inline(name(id))} (${BURDEN_LABEL[b]})`);
        lines.push(
          `- ${localDateTimeText(i.zone, Date.parse(o.start))} (${zoneLabel(i.zone)}), ${label(o.optionId)}${outside.length ? `: outside hours for ${outside.join(", ")}` : ""}`
        );
      }
      const totals = burdenTotals(r, i.people, i.now, ROTATION_PLAN_COUNT, {
        holidays: i.holidays,
      });
      lines.push(
        "",
        `Points (1 early or late, 2 night or day off): ${totals.totals.map((x) => `${inline(name(x.personId))} ${x.points}`).join(", ") || "–"}.`,
        fairnessLine(
          totals,
          (id) => inline(name(id)),
          (id) => {
            const p = i.people.find((x) => x.id === id);
            return p ? inline(placeLabel(p)) : "";
          }
        ),
        ""
      );
    }
  }

  const offices = officeGroups(i.people);
  if (offices.length > 0) {
    lines.push("## Office days", "");
    for (const g of offices) {
      const days = g.inOn
        .map((ids, d) => (ids.length > 0 ? `${WEEKDAY_LABEL[d]} ${ids.length}` : ""))
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- ${inline(g.label)}: ${days || "nobody in"}. Anchor day: ${g.anchorDays.length > 0 ? g.anchorDays.map((d) => WEEKDAY_LABEL[d]).join(" or ") : "none yet"}.`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** The people as CSV rows, for the export's spreadsheet. */
export function peopleCsv(people: readonly TeamTimePerson[], roster: readonly TeamMember[]) {
  return {
    headers: ["Name", "Time zone", "Start", "End", "Working days", "Office days", "Office"],
    rows: people.map((p) => [
      personName(p, roster),
      p.timeZone,
      p.start,
      p.end,
      daysLabel(p.workingDays),
      p.officeDays?.length ? daysLabel(p.officeDays) : "",
      p.site ?? "",
    ]),
  };
}
