import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData, wrapUserContent } from "./prompt-utils";
import type { ScheduleNoteInput } from "../team-time/note";
import { offsetLabel } from "../team-time/zones";

/**
 * Copyable prompts over Team Time, from the same facts Ask Amr reads (the
 * schedule note's input): where the team works, how long everyone shares,
 * which meetings land outside people's hours, the anchor days and the clock
 * changes ahead. No person's name goes in. Place and meeting names are
 * typed by people, so the tables are wrapped as untrusted content.
 */
export function generateTeamTimePrompts(input: ScheduleNoteInput | null): PromptDefinition[] {
  if (!input || input.places.length === 0) return [];
  const { data: places, truncated, totalCount } = truncateData(input.places, 12);
  const placeTable = formatTable(
    ["Place", "Offset", "People", "Hours", "Days"],
    places.map((p) => [p.label, offsetLabel(p.offsetMinutes), p.people, p.hours, p.days])
  );
  const meetingTable =
    input.meetings.length > 0
      ? formatTable(
          ["Meeting", "Outside hours for", "At night or on a day off for"],
          input.meetings.map((m) => [m.name, m.outsideHours, m.nightOrDayOff])
        )
      : "No meetings saved.";
  const note = truncated ? `\n(Showing ${places.length} of ${totalCount} places)\n` : "";
  const facts = [
    `Everyone shares ${input.overlapMinutes} minutes on the best day; all but one share ${input.mostOverlapMinutes}.`,
    input.anchorDays.length > 0
      ? `Office anchor days: ${input.anchorDays.map((a) => `${a.site} (${a.days.length} day${a.days.length === 1 ? "" : "s"})`).join(", ")}.`
      : "",
    ...input.clockChanges.map((c) => `Clock change: ${c}`),
  ]
    .filter(Boolean)
    .join("\n");
  const data = wrapUserContent(`${placeTable}${note}\n\n${meetingTable}\n\n${facts}`);
  return [
    {
      id: "team-time-meeting-plan",
      title: "A fair meeting plan",
      description: "When to meet live, what to move into writing, and how to share the late calls.",
      prompt:
        buildPreamble(
          "Team Time",
          "It shows where the team works, the hours they share and the meetings that land outside people's working hours."
        ) +
        `## The team's time\n\n${data}\n\n## Questions\n\n1. Which meetings should stay live inside the shared hours, and which would work better in writing?\n2. For the meetings that land at night or on a day off, suggest a rotation that shares the burden fairly.\n3. What core hours would you agree, and what should happen outside them?\n4. What should the team check again after the clock changes ahead?`,
    },
    {
      id: "team-time-working-agreement",
      title: "Working agreement lines for a spread-out team",
      description: "Draft charter rules on response times, core hours and hand-overs.",
      prompt:
        buildPreamble("Team Time", "Help the team agree how it works across time zones.") +
        `## The team's time\n\n${data}\n\n## Questions\n\n1. Draft an urgency ladder: what counts as urgent, how to reach each other, and how fast to answer.\n2. Draft two or three rules on core hours and focus time that fit these places.\n3. How should work be handed over from one place to the next at the end of each day?`,
    },
  ];
}
