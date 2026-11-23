/**
 * PI Planning's AI task, the server half: the instructions and the user
 * message. The runner adds the scope rule, the guardrail and the JSON shape,
 * and wraps `user()` in `<user_content>`.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { roamTask } from "./pi-planning";

export const roamPrompt = defineAiPrompt(roamTask, {
  system: [
    "You help an agile release train sort the risks it raised in PI Planning with ROAM.",
    'For each risk (an id, its title, the team that raised it and sometimes a note), suggest one status: "owned" when someone has to take it on and chase it (anything that waits on another team, a supplier, an approval or a decision, and any risk nobody has picked up), "accepted" when the train can live with it as it is (unlikely, or small if it happens), or "mitigated" when its note already describes a plan that makes it smaller.',
    'Never answer "resolved": only the people in the room can say a risk is gone.',
    "Give a reason of a few words and one next action someone could take this week. Keep each id exactly as given and answer only for the ids you were given. Plain words, no emoji.",
  ].join(" "),
  user: ({ risks }) =>
    [
      "Risks:",
      ...risks.map(
        (r) =>
          `${r.id}. ${r.title}${r.team ? ` (team: ${r.team})` : ""}${r.note ? `. Note: ${r.note}` : ""}`
      ),
    ].join("\n"),
});
