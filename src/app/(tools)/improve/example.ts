import { exampleId } from "@/lib/utils/example-id";
import type { Improvement } from "@/lib/stores/workspace-types";

/**
 * Two improvements a delivery team might hold: an A3 on why releases wait
 * six days after merge (three countermeasures, done, running and planned,
 * and readings coming down), and a Kata on review waits (three obstacles,
 * one worked on, two experiments and a coaching talk two days out).
 * Example ids throughout, so nothing counts as the team's, nothing is ever
 * sent, and Clear example takes them all away. The owners' names are on no
 * roster.
 */
export function buildExample(now: Date = new Date()): Improvement[] {
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const day = (days: number) => {
    const d = new Date(now.getTime() + days * 86_400_000);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
  };
  return [
    {
      id: exampleId("improve-releases"),
      title: "Releases wait six days after merge",
      method: "a3",
      status: "open",
      owner: "Priya",
      background:
        "A fix merged on Monday reaches customers the next week. Support keeps apologising for bugs we already fixed, and small changes pile up into big, risky releases.",
      current: {
        text: "Merged work waits about six days for a release.",
        metric: "Days from merge to production",
        value: 6,
        unit: "days",
        date: day(-28),
      },
      target: {
        text: "Most changes reach production the day after merge.",
        metric: "Days from merge to production",
        value: 1,
        unit: "days",
        date: day(14),
      },
      analysis: "The manual regression pass takes a whole day, so we release once a week.",
      obstacles: [],
      steps: [
        {
          id: exampleId("improve-step-1"),
          text: "Automate the ten checks the regression pass repeats every week",
          expect: "The pass takes half a day",
          owner: "Sam",
          due: day(-14),
          status: "done",
          doneAt: at(-15),
        },
        {
          id: exampleId("improve-step-2"),
          text: "Release on Tuesday and Thursday, not once a week",
          owner: "Priya",
          due: day(3),
          status: "running",
        },
        {
          id: exampleId("improve-step-3"),
          text: "Ship behind a flag so a release never waits for one unfinished change",
          owner: "Sam",
          due: day(10),
          status: "planned",
        },
      ],
      readings: [
        { id: exampleId("improve-reading-1"), date: day(-28), value: 6 },
        { id: exampleId("improve-reading-2"), date: day(-21), value: 5 },
        { id: exampleId("improve-reading-3"), date: day(-14), value: 4, note: "Checks automated" },
        { id: exampleId("improve-reading-4"), date: day(-7), value: 3 },
      ],
      createdAt: at(-30),
      updatedAt: at(-1),
    },
    {
      id: exampleId("improve-reviews"),
      title: "Reviews wait too long",
      method: "kata",
      status: "open",
      owner: "Sam",
      coach: "Priya",
      background: "Every change is reviewed within a working day.",
      current: {
        text: "A change waits most of a day for its first review.",
        metric: "First-review wait (median)",
        value: 19,
        unit: "h",
        date: day(-14),
      },
      target: {
        text: "The first review starts within a working morning.",
        metric: "First-review wait (median)",
        value: 8,
        unit: "h",
        date: day(21),
      },
      obstacles: [
        {
          id: exampleId("improve-obstacle-1"),
          text: "Only two people feel able to review payment code",
          status: "working",
        },
        {
          id: exampleId("improve-obstacle-2"),
          text: "Pull requests are often over 500 lines",
          status: "open",
        },
        {
          id: exampleId("improve-obstacle-3"),
          text: "Nobody sees a new review request until the afternoon",
          status: "cleared",
        },
      ],
      steps: [
        {
          id: exampleId("improve-try-1"),
          text: "A review slot straight after the Daily Scrum",
          expect: "The median wait drops below 15 h",
          result: "It fell to 15 h, but payment changes still waited a day",
          learned: "The slot helps; who can review matters more than when",
          obstacleId: exampleId("improve-obstacle-3"),
          status: "done",
          doneAt: at(-7),
        },
        {
          id: exampleId("improve-try-2"),
          text: "Pair a third developer on every payment review for a week",
          expect: "Payment changes get a first review the same morning",
          obstacleId: exampleId("improve-obstacle-1"),
          status: "running",
        },
      ],
      readings: [
        { id: exampleId("improve-wait-1"), date: day(-14), value: 19 },
        { id: exampleId("improve-wait-2"), date: day(-7), value: 15 },
        { id: exampleId("improve-wait-3"), date: day(-1), value: 13 },
      ],
      nextCoachingAt: day(2),
      createdAt: at(-15),
      updatedAt: at(-1),
    },
  ];
}
