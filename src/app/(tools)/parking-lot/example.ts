import { exampleId } from "@/lib/utils/example-id";
import type { ParkingLotItem } from "@/lib/stores/workspace-types";

/**
 * A parking lot after a Daily Scrum and a Sprint Planning: five points still
 * open, one discussed, one dropped. Ids start with "example-", so agents,
 * next steps and the counts leave them out once the team has its own, and
 * they are never sent to another tool. Parked over the last two days.
 */
export function buildExample(now: Date = new Date()): ParkingLotItem[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const item = (
    key: string,
    hoursAgo: number,
    text: string,
    over: Partial<ParkingLotItem> = {}
  ): ParkingLotItem => ({
    id: exampleId(`parking-${key}`),
    text,
    status: "open",
    createdAt: at(hoursAgo),
    updatedAt: at(hoursAgo),
    ...over,
  });
  return [
    item("p1", 30, "Who signs off the release checklist now that Dana has moved teams?", {
      meeting: "Sprint Planning",
      raisedBy: "Priya",
    }),
    item("p2", 29, "Customers keep asking for a CSV export of their invoices", {
      meeting: "Sprint Planning",
      raisedBy: "Sam",
    }),
    item("p3", 28, "Do we still need the Thursday sync with marketing?", {
      meeting: "Sprint Planning",
      status: "dropped",
      updatedAt: at(27),
    }),
    item("p4", 3, "We're blocked on the payments team approving the new webhook", {
      meeting: "Daily Scrum",
      raisedBy: "Alex",
    }),
    item("p5", 2.8, "Our standups run long when we start solving problems in them", {
      meeting: "Daily Scrum",
      raisedBy: "Jo",
    }),
    item("p6", 2.6, "The flaky checkout test failed three builds this week", {
      meeting: "Daily Scrum",
      raisedBy: "Sam",
    }),
    item("p7", 2.5, "Is the demo on Friday or Monday?", {
      meeting: "Daily Scrum",
      status: "discussed",
      updatedAt: at(2),
    }),
  ];
}
