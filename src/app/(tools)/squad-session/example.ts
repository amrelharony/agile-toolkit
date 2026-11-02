import { exampleId } from "@/components/tool-frame/example-data";
import type { SquadAction } from "./store";

/** The episode the example opens: "Everything Is Priority One". */
export const EXAMPLE_EP = 1;

/**
 * What a team might agree after talking about that episode. The rows carry
 * `example-` ids, so Clear example removes exactly them. The story text comes
 * from the book as usual: nothing here speaks for the comic.
 */
export function buildExample(): SquadAction[] {
  return [
    {
      id: exampleId("action-1"),
      ep: EXAMPLE_EP,
      title: "Name one thing that can wait each time something new arrives",
      owner: "Priya",
    },
    {
      id: exampleId("action-2"),
      ep: EXAMPLE_EP,
      title: "Limit the board to three items marked first",
      owner: "Sam",
    },
  ];
}
