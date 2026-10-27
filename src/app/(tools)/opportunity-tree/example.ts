import type { TreeNode } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

/**
 * A tree a product team might map: one outcome, two opportunities, one of
 * them split into a sub-opportunity the team has made its target, two
 * solutions to it and an experiment for each. Ids start with `example-`;
 * "Clear example" removes exactly them, JTBD's picker leaves them out, and
 * example experiments never go to the Hypothesis Tracker.
 */
export function buildExample(): TreeNode[] {
  const id = (key: string) => exampleId(`ot-${key}`);
  return [
    {
      id: id("outcome"),
      kind: "outcome",
      text: "Teams spot blocked work within a day",
      parentId: null,
      description: "Measured as the median days a card stays blocked.",
    },
    {
      id: id("visibility"),
      kind: "opportunity",
      text: "Leads can't see what's blocked without asking",
      parentId: id("outcome"),
      evidence: "Raised in 4 of 6 interviews.",
    },
    {
      id: id("friday"),
      kind: "opportunity",
      text: "The weekly status is rebuilt by hand every Friday",
      parentId: id("visibility"),
      evidence: "Two leads copy the board into a spreadsheet.",
      target: true,
    },
    {
      id: id("handoffs"),
      kind: "opportunity",
      text: "Work stalls when it waits on another team",
      parentId: id("outcome"),
    },
    {
      id: id("digest"),
      kind: "solution",
      text: "A Monday digest of blocked cards",
      parentId: id("friday"),
    },
    {
      id: id("badge"),
      kind: "solution",
      text: "A blocked-for-days badge on the board",
      parentId: id("friday"),
    },
    {
      id: id("digest-test"),
      kind: "experiment",
      text: "Email a hand-made digest to five leads for two weeks",
      parentId: id("digest"),
      description: "Ask after each send whether they acted on it.",
    },
    {
      id: id("badge-test"),
      kind: "experiment",
      text: "Show the badge to one team and count unblocked cards",
      parentId: id("badge"),
    },
  ];
}
