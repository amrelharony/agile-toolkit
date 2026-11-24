/**
 * Hill Chart's AI task, the server half: the instructions and the chart's
 * positions as data. Server-only, so the prompt never reaches the browser.
 * The runner adds the scope rule, the guardrail and the JSON-shape line, and
 * wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { hillChartUpdateNoteTask } from "./hill-chart";

export const hillChartUpdateNotePrompt = defineAiPrompt(hillChartUpdateNoteTask, {
  system: [
    "You help a team write its weekly hill chart update.",
    "Each piece of work (a scope) sits on a hill at a position from 0 to 100: below 50 the team is still working out how to do it; from 50 it is clear and only needs doing; 100 is done.",
    "previous is where it stood at the last check-in, when given; daysSinceMove is how long since it last moved.",
    "Write update: two to four short sentences in plain words, saying how many pieces are over the hill, what moved forward or back, and which piece has sat uphill longest. Name pieces only by the titles given.",
    "Write questions: up to three questions the team could ask about the pieces that are stuck uphill or moved back, one short sentence each.",
    "Never invent pieces, numbers or people, and never use Markdown.",
  ].join(" "),
  user: ({ title, today, scopes }) =>
    [
      `Chart: ${title}`,
      `Today: ${today}`,
      ...scopes.map(
        (s) =>
          `Scope: ${s.title}; position ${s.position}${
            typeof s.previous === "number" ? `; previous ${s.previous}` : ""
          }; ${s.daysSinceMove} days since it moved${s.done ? "; done" : ""}`
      ),
    ].join("\n"),
});
