import { exampleId } from "@/lib/utils/example-id";
import type { AgendaDraftState } from "@/lib/facilitator-timers/store";

/**
 * A 90-minute design workshop for a team reworking its sign-up flow: the
 * agenda draft only, ready to save to the Ceremony Timer. Nothing about
 * money is in it (the cost ticker never gets made-up rates), and "Clear
 * example" removes exactly these segments.
 */
export function buildExample(): AgendaDraftState {
  const rows: [string, number, string][] = [
    ["Check-in", 5, "One word each on how you arrive today."],
    ["Frame the problem", 15, "Read the sign-up research and agree the question to solve."],
    ["Crazy 8s", 10, "Eight quick sketches each, alone and in silence."],
    ["Share and vote", 20, "Walk through the sketches, then dot-vote the strongest ideas."],
    ["Break", 10, "Coffee and a stretch, away from the screens."],
    ["Combine the best", 20, "Build one storyboard from the top ideas."],
    ["Next steps", 10, "Owners and dates for the first prototype."],
  ];
  return {
    goal: "Sketch ideas for a simpler sign-up flow",
    minutes: 90,
    segments: rows.map(([label, minutes, hint], i) => ({
      id: exampleId(`seg-${i + 1}`),
      label,
      minutes,
      hint,
    })),
  };
}
