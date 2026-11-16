import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { shiftDay } from "@/lib/notebook/model";
import { exampleId } from "@/lib/utils/example-id";

/**
 * Two weeks of a Scrum Master's notes on one team, ending `today`: a blocker
 * that keeps coming back (three notes in two weeks, so the counts and Amr's
 * read pick it out), quiet voices at the Daily Scrum, estimates far apart, a 1:1,
 * a review and a retro experiment. People are named by role, as a coach
 * should write them. Ids start with `example-`; "Clear example" removes
 * exactly these, and an example note is never sent on.
 */
export function buildExample(today: string): NotebookEntry[] {
  const at = (n: number, hour: number) => {
    const day = shiftDay(today, -n);
    return { date: day, stamp: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z` };
  };
  const note = (
    key: string,
    ago: number,
    hour: number,
    fields: Omit<NotebookEntry, "id" | "date" | "createdAt" | "updatedAt">
  ): NotebookEntry => {
    const { date, stamp } = at(ago, hour);
    return { id: exampleId(`note-${key}`), date, ...fields, createdAt: stamp, updatedAt: stamp };
  };
  return [
    note("sandbox-3", 0, 10, {
      title: "Waiting on the payments sandbox",
      body: "Third day in a row the payments story is blocked on sandbox access. The team waits instead of asking. I raised it with the platform lead after the Daily Scrum; check again on Thursday.",
      tags: ["blockers"],
      event: "daily-scrum",
      linkedTool: "impediments",
    }),
    note("quiet", 0, 9, {
      title: "Two quiet voices",
      body: "The two newest developers gave one-line updates while the same two people talked for most of the 15 minutes. Nobody asked them anything. Next time: a round where each person names one thing they need from someone.",
      tags: ["participation"],
      event: "daily-scrum",
    }),
    note("estimates", 1, 14, {
      title: "Estimates far apart",
      body: "Two stories got a 3 and a 13 from different people. The gap came from different ideas of the test work, not the code. At the next refinement, talk through the acceptance criteria before anyone votes.",
      tags: ["estimation"],
      event: "refinement",
      linkedTool: "planning-poker",
    }),
    note("one-on-one", 2, 16, {
      body: "A developer feels stretched across two teams. They want fewer context switches more than fewer tasks. Follow-up: look at where the interruptions come from with the Product Owner.",
      tags: ["1:1", "wellbeing"],
      event: "one-on-one",
    }),
    note("api-late", 3, 10, {
      title: "The other team's API landed late again",
      body: "Two stories are blocked until their next release. Ask for a shared view of dependencies at the Scrum of Scrums.",
      tags: ["blockers", "dependencies"],
      event: "daily-scrum",
    }),
    note("review", 4, 15, {
      title: "Review questions were about dates",
      body: "Stakeholders asked mostly when, not what. Next review: open with a short demo of what a customer can now do, then the forecast.",
      tags: ["stakeholders"],
      event: "sprint-review",
    }),
    note("silent-writing", 6, 11, {
      title: "Experiment: silent writing first",
      body: "We tried five minutes of silent writing before talking. Twice as many cards, and the quieter people wrote the most. Keep it for the next two retros and compare.",
      tags: ["experiment", "participation"],
      event: "retro",
    }),
    note("urgent", 8, 13, {
      title: "Urgent requests mid-sprint",
      body: "Three urgent requests from sales went straight to developers this week, and nobody told the Product Owner. Talk about one way in for urgent work.",
      tags: ["interruptions"],
      event: "day-to-day",
      linkedTool: "interrupt-buffer",
    }),
    note("sandbox-1", 11, 10, {
      title: "Sandbox access, first sign",
      body: "The payments story is waiting for sandbox access. Expected to be sorted by tomorrow.",
      tags: ["blockers"],
      event: "daily-scrum",
    }),
  ];
}
