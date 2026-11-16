import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData, wrapUserContent } from "./prompt-utils";
import type { ParkingLotItem } from "../stores/workspace-types";
import { STATUS_LABEL, parkingSummary, summaryText } from "../parking-lot/model";

/**
 * Copyable prompts over the parking lot as the page shows it: the points
 * (words, meeting, who raised them, status), for routing the open ones and
 * for spotting what keeps coming up. The points are typed by people, so the
 * table is wrapped as untrusted content.
 */
export function generateParkingLotPrompts(items: readonly ParkingLotItem[]): PromptDefinition[] {
  if (items.length === 0) return [];
  const { data: shown, truncated, totalCount } = truncateData([...items], 40);
  const table = formatTable(
    ["Point", "Meeting", "Raised by", "Status"],
    shown.map((i) => [i.text, i.meeting ?? "-", i.raisedBy ?? "-", STATUS_LABEL[i.status]])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} points)\n` : "";
  const counts = summaryText(parkingSummary(items));
  const data = wrapUserContent(`${table}${note}`);
  return [
    {
      id: "parking-lot-route",
      title: "Where each point goes",
      description: "Sort the open points into the backlog, impediments, retro actions or drop.",
      prompt:
        buildPreamble(
          "Parking Lot",
          "It holds the off-topic points parked during the team's meetings, each open until it is discussed, sent on or dropped."
        ) +
        `## Points\n\n${data}\n\nCounts: ${counts}\n\n## Questions\n\n1. For each open point, should it go to the backlog (work on the product), the impediments (something outside the team in the way), the retro actions (a change to how the team works) or be dropped? One line each, with a reason.\n2. Which points need someone to own them before the next meeting, and who should that be?\n3. Which points could have been settled in the meeting in under two minutes?`,
    },
    {
      id: "parking-lot-patterns",
      title: "What keeps getting parked",
      description:
        "Find the themes behind the parked points, and what they say about the meetings.",
      prompt:
        buildPreamble(
          "Parking Lot",
          "Look for patterns in what the team parks, and in which meetings."
        ) +
        `## Points\n\n${data}\n\n## Questions\n\n1. What themes do the points share? Group them, and name each group in a few words.\n2. Which meetings park the most points, and what does that say about their agenda or timebox?\n3. Which themes would be better handled in a meeting of their own, or in writing?\n4. What one change to the team's meetings would park fewer points next sprint?`,
    },
  ];
}
