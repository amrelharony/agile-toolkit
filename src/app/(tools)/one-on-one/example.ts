import { exampleId } from "@/components/tool-frame/example-data";
import { addDays } from "@/lib/flow/days";
import type { Meeting, OneOnOneCadence } from "./model";

/** The example in memory: its meetings and the cadence set for them. */
export interface OneOnOneExample {
  meetings: Meeting[];
  cadence: OneOnOneCadence;
}

/**
 * Mia's 1:1s with two reports over seven weeks. Raj meets every 14 days
 * (the cadence set for him) and his last 1:1 was 19 days ago, so he is 5
 * days past it, with an action from it overdue; Lee meets weekly (four 1:1s,
 * so three gaps), with no cadence set, so his usual gap (7 days) is the one
 * he's held to, and he is within it.
 *
 * Everything has `example-` ids and stays in the page's memory: nothing is
 * saved, and Clear example leaves your own 1:1s as they were.
 */
export function buildExample(today: string): OneOnOneExample {
  const day = (daysAgo: number) => addDays(today, -daysAgo) ?? today;
  const id = (key: string) => exampleId(`1on1-${key}`);
  const raj = (key: string, daysAgo: number, agenda: Meeting["agenda"], notes?: string) => ({
    id: id(`raj-${key}`),
    manager: "Mia",
    report: "Raj",
    date: day(daysAgo),
    agenda,
    ...(notes ? { notes } : {}),
  });
  const lee = (key: string, daysAgo: number, agenda: Meeting["agenda"]) => ({
    id: id(`lee-${key}`),
    manager: "Mia",
    report: "Lee",
    date: day(daysAgo),
    agenda,
  });
  return {
    cadence: { raj: 14 },
    meetings: [
      raj("1", 47, [
        { id: id("raj-1-a"), text: "Career goals for the year", status: "open" },
        { id: id("raj-1-b"), text: "Holiday plans", status: "discussed" },
      ]),
      raj("2", 33, [
        {
          id: id("raj-2-a"),
          text: "Career goals for the year",
          status: "discussed",
          carriedFrom: id("raj-1-a"),
        },
        {
          id: id("raj-2-b"),
          text: "Flaky CI slowing reviews",
          status: "done",
          action: "Pair on the flaky tests",
          owner: "Raj",
          dueDate: day(26),
          doneAt: day(28),
        },
      ]),
      raj(
        "3",
        19,
        [
          {
            id: id("raj-3-a"),
            text: "Lead the next refinement",
            status: "action_required",
            action: "Draft the refinement agenda",
            owner: "Raj",
            dueDate: day(10),
          },
          { id: id("raj-3-b"), text: "Feedback on the demo", status: "discussed" },
        ],
        "Keen to lead refinement; wants feedback on facilitation."
      ),
      lee("0", 27, [{ id: id("lee-0-a"), text: "First week on the team", status: "discussed" }]),
      lee("1", 20, [{ id: id("lee-1-a"), text: "Onboarding so far", status: "discussed" }]),
      lee("2", 13, [
        { id: id("lee-2-a"), text: "Pairing with Raj", status: "open" },
        {
          id: id("lee-2-b"),
          text: "Access to staging",
          status: "done",
          action: "Ask platform for access",
          owner: "Mia",
          dueDate: day(10),
          doneAt: day(11),
        },
      ]),
      lee("3", 6, [
        {
          id: id("lee-3-a"),
          text: "Pairing with Raj",
          status: "discussed",
          carriedFrom: id("lee-2-a"),
        },
      ]),
    ],
  };
}
