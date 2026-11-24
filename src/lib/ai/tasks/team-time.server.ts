/**
 * Team Time's AI task, the server half: the instructions and the schedule
 * as data. Server-only, so the prompt never reaches the browser. The runner
 * adds the scope rule, the guardrail and the JSON-shape line, and wraps
 * `user()` in `<user_content>` tags.
 */

import "server-only";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import { offsetLabel } from "@/lib/team-time/zones";
import { defineAiPrompt } from "../define-task";
import { teamTimeScheduleNoteTask } from "./team-time";

const hours = (m: number) => `${Math.floor(m / 60)} h ${m % 60} min`;

export const teamTimeScheduleNotePrompt = defineAiPrompt(teamTimeScheduleNoteTask, {
  system: [
    "You are an agile coach helping a team that works across time zones and offices meet fairly.",
    "You get where the team works (each place with its offset from UTC, how many people, their usual hours and days), how many minutes everyone shares on the best day, how many all but one share, the team's meetings with how many people each lands outside working hours for (and at night or on a day off), the offices' anchor days and the clock changes ahead.",
    "Write a note of 2 or 3 plain sentences on what the schedule means for the team, then up to 4 short, concrete tips, the most useful first: such as keeping meetings inside the shared hours, moving status updates into writing, rotating a meeting that lands at night, agreeing core hours, using an anchor day for in-person work, or checking again after a clock change.",
    "Use only the facts given; never invent people, places, meetings or numbers. Plain text only, no Markdown.",
  ].join(" "),
  user: (i) =>
    [
      "Places, east to west:",
      ...i.places.map(
        (p) =>
          `- ${p.label} (${offsetLabel(p.offsetMinutes)}): ${p.people} ${p.people === 1 ? "person" : "people"}, ${p.hours || "hours not set"}, ${p.days || "days not set"}`
      ),
      `Everyone shares: ${hours(i.overlapMinutes)} on the best day.`,
      `All but one share: ${hours(i.mostOverlapMinutes)} on the best day.`,
      i.meetings.length > 0 ? "Meetings:" : "Meetings: none saved.",
      ...i.meetings.map(
        (m) =>
          `- ${m.name}: outside working hours for ${m.outsideHours}, at night or on a day off for ${m.nightOrDayOff}`
      ),
      i.anchorDays.length > 0
        ? `Anchor days: ${i.anchorDays.map((a) => `${a.site} on ${a.days.map((d) => WEEKDAY_LABEL[d]).join(", ") || "no day"}`).join("; ")}`
        : "Anchor days: none.",
      i.clockChanges.length > 0
        ? `Clock changes ahead:\n${i.clockChanges.map((c) => `- ${c}`).join("\n")}`
        : "Clock changes ahead: none in the next 8 weeks.",
    ].join("\n"),
});
