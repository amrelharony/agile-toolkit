/**
 * Parking Lot's AI task, the server half: the instructions and the points as
 * data. Server-only, so the prompt never reaches the browser. The runner adds
 * the scope rule, the guardrail and the JSON-shape line, and wraps `user()` in
 * `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { parkingRouteTask } from "./parking-lot";

export const parkingRoutePrompt = defineAiPrompt(parkingRouteTask, {
  system: [
    "You help a Scrum team clear its parking lot: the points parked during a meeting to deal with later.",
    "For each point, suggest where it should go:",
    '"backlog" when it is work on the product (a feature, a fix, a change to build or test);',
    '"impediment" when something outside the team\'s control blocks or slows the team;',
    '"action" when it is a change the team will make to how it works together, which the team owns;',
    '"drop" when it no longer matters, is already settled, or is too vague to act on.',
    "Give exactly one suggestion per point, with the point's id copied exactly as given, and a reason of one short sentence in plain words.",
    "Never invent points or ids, and never add points that were not given.",
  ].join(" "),
  user: ({ items }) =>
    items
      .map(
        (item) => `Point ${item.id}${item.meeting ? ` (from ${item.meeting})` : ""}: ${item.text}`
      )
      .join("\n"),
});
