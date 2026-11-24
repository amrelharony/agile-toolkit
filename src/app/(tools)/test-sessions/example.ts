/**
 * The example: three sessions on saved addresses at checkout, in our own
 * words, dated from now: one planned, one done with a debrief and two bug
 * notes, and one running, whose clock stands still (the example never
 * claims the docked timer). Example ids are never sent to another tool.
 */

import type { TestSession } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

const MIN = 60 * 1000;

export function buildExample(now: Date = new Date()): TestSession[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * MIN).toISOString();
  return [
    {
      id: exampleId("session-planned"),
      charter: {
        target: "saved addresses at checkout",
        using: "a slow or lost connection",
        toLearn: "what a shopper sees while the address list loads, and when it fails",
      },
      tester: "Sam",
      area: "Checkout",
      minutes: 45,
      status: "planned",
      notes: [],
      createdAt: at(10),
      updatedAt: at(10),
    },
    {
      id: exampleId("session-running"),
      charter: {
        target: "adding a new address at checkout",
        using: "odd, empty and wrong input",
        toLearn: "whether it refuses bad postcodes clearly and keeps what was typed",
      },
      tester: "Priya",
      area: "Checkout",
      minutes: 60,
      status: "running",
      startedAt: at(20),
      notes: [
        {
          id: exampleId("note-r1"),
          at: at(14),
          kind: "note",
          text: "A postcode with a space at the end is accepted.",
        },
        {
          id: exampleId("note-r2"),
          at: at(6),
          kind: "question",
          text: "Should a PO box be allowed for delivery?",
        },
      ],
      createdAt: at(30),
      updatedAt: at(6),
    },
    {
      id: exampleId("session-done"),
      charter: {
        target: "picking a saved address",
        using: "two saved addresses in different countries",
        toLearn: "whether the delivery price and dates follow the address picked",
      },
      tester: "Sam",
      area: "Checkout",
      minutes: 60,
      status: "done",
      startedAt: at(60 * 26),
      endedAt: at(60 * 25 - 5),
      coverage: "most",
      split: { testing: 70, bugs: 20, setup: 10 },
      debrief:
        "Prices follow the address. Dates don't when the country changes. Next: try addresses abroad on a phone.",
      notes: [
        {
          id: exampleId("note-d1"),
          at: at(60 * 26 - 12),
          kind: "bug",
          text: "Delivery dates stay on the first country after switching to an address abroad.",
        },
        {
          id: exampleId("note-d2"),
          at: at(60 * 26 - 31),
          kind: "bug",
          text: "The address list jumps to the top after picking the second address.",
        },
        {
          id: exampleId("note-d3"),
          at: at(60 * 26 - 48),
          kind: "idea",
          text: "Try the same switch on a phone, where the list is a sheet.",
        },
      ],
      createdAt: at(60 * 27),
      updatedAt: at(60 * 25),
    },
  ];
}
