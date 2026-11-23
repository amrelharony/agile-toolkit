/**
 * The Async Standup's AI task, the server half: the instructions and the
 * day's updates as data. Server-only, so the prompt never reaches the
 * browser. The runner adds the scope rule, the guardrail and the
 * JSON-shape line, and wraps `user()` in `<user_content>` tags.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { asyncStandupDigestTask } from "./async-standup";

const WORDS = {
  classic: { done: "Yesterday", next: "Today", problem: "Blockers" },
  ppp: { done: "Progress", next: "Plans", problem: "Problems" },
} as const;

export const asyncStandupDigestPrompt = defineAiPrompt(asyncStandupDigestTask, {
  system: [
    "You are an agile coach summarising a team's written daily standup for the Scrum Master.",
    "You get one day's updates (each person's name, where they work when known, what they did, what's next, what's in the way and who can clear it, and any hand-over to the next time zone), who hasn't posted, blockers from earlier days that are still open with their age, and the team's places from east to west.",
    "Write a headline of one line, then a summary of 2 to 4 plain sentences: who is blocked, what is at risk and what the team should look at first.",
    "List up to 8 asks, each to one person named in the updates (a poster or a DRI), saying what to do. List up to 4 risks, such as blockers 3 days old or more. List up to 8 hand-overs, each from one of the given places to the next one, saying what to pick up.",
    "Use only the facts given; never invent people, places, work or numbers. Plain text only, no Markdown.",
  ].join(" "),
  user: (i) => {
    const lines = [
      `Day: ${i.date}`,
      `Places east to west: ${i.shifts.join(", ") || "not known"}`,
      "Updates:",
    ];
    for (const e of i.entries) {
      const w = WORDS[e.format];
      lines.push(`- ${e.member}${e.site ? ` (${e.site})` : ""}`);
      if (e.done) lines.push(`  ${w.done}: ${e.done}`);
      if (e.next) lines.push(`  ${w.next}: ${e.next}`);
      if (e.problem) lines.push(`  ${w.problem}: ${e.problem}${e.dri ? ` (DRI: ${e.dri})` : ""}`);
      if (e.handoff) lines.push(`  Hand-over: ${e.handoff}`);
      if (e.notes) lines.push(`  Notes: ${e.notes}`);
    }
    lines.push(`Not posted yet: ${i.notPosted.join(", ") || "nobody"}`);
    if (i.olderBlockers.length > 0) {
      lines.push("Older blockers still open, oldest first:");
      for (const b of i.olderBlockers) {
        lines.push(`- ${b.member}, ${b.ageDays} days: ${b.text}${b.dri ? ` (DRI: ${b.dri})` : ""}`);
      }
    } else {
      lines.push("Older blockers still open: none.");
    }
    return lines.join("\n");
  },
});
