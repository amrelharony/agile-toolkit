import { exampleId } from "@/lib/utils/example-id";
import type { MeetingAudit } from "@/lib/stores/workspace-types";

/**
 * A product team's recurring calendar, half audited: the Scrum events, a
 * refinement session and a status sync nobody enjoys. Two are rated with a
 * verdict, two rated and undecided, two not rated yet. Ids start with
 * "example-", so agents, next steps and the counts leave them out once the
 * team has its own.
 */
export function buildExample(now: Date = new Date()): MeetingAudit[] {
  const at = now.toISOString();
  const meeting = (
    key: string,
    fields: Omit<MeetingAudit, "id" | "createdAt" | "updatedAt">
  ): MeetingAudit => ({ id: exampleId(`meeting-${key}`), ...fields, createdAt: at, updatedAt: at });
  return [
    meeting("daily", {
      meeting: "Daily Scrum",
      cadence: "daily",
      minutes: 25,
      attendees: 7,
      purpose: "Inspect progress toward the Sprint Goal and plan the next day of work.",
      ratings: { purpose: 4, people: 5, outcome: 3, length: 2, energy: 3 },
      verdict: "change",
      notes: "Timebox it to 15 minutes",
    }),
    meeting("status", {
      meeting: "Weekly status sync",
      cadence: "weekly",
      minutes: 60,
      attendees: 12,
      purpose: "Everyone reports what they worked on.",
      ratings: { purpose: 2, people: 2, outcome: 1, length: 2, energy: 1 },
      verdict: "drop",
      notes: "Share the updates in writing on Mondays instead.",
    }),
    meeting("planning", {
      meeting: "Sprint Planning",
      cadence: "fortnightly",
      minutes: 120,
      attendees: 7,
      purpose: "Agree the Sprint Goal and plan the work to reach it.",
      ratings: { purpose: 5, people: 4, outcome: 4, length: 3, energy: 3 },
    }),
    meeting("refinement", {
      meeting: "Backlog refinement",
      cadence: "weekly",
      minutes: 60,
      attendees: 7,
      purpose: "Get the next sprint's stories ready: split, clarify and size them.",
      ratings: { purpose: 3, people: 2, outcome: 3, length: 2, energy: 2 },
    }),
    meeting("review", {
      meeting: "Sprint Review",
      cadence: "fortnightly",
      minutes: 60,
      attendees: 14,
      purpose: "Show stakeholders what was done and adapt the backlog with them.",
      ratings: {},
    }),
    meeting("retro", {
      meeting: "Sprint Retrospective",
      cadence: "fortnightly",
      minutes: 75,
      attendees: 7,
      purpose: "Improve how the team works together.",
      ratings: {},
    }),
  ];
}
