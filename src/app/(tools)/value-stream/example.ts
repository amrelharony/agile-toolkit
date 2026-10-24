import { exampleId } from "@/components/tool-frame/example-data";
import type { ValueStreamStage, ValueStreamState } from "@/lib/stores/workspace-types";

type Row = [name: string, process: number, lead: number, accuracy: number, description?: string];

/**
 * A web team's path from idea to production, in days. Code review is the
 * bottleneck: a change waits 6 of its 7 days there for a reviewer. Waiting
 * is 75% of the 20-day lead time.
 */
const CURRENT: Row[] = [
  ["Analysis", 1, 3, 85, "Product owner and a developer shape the story."],
  ["Development", 2, 5, 90],
  ["Code review", 1, 7, 80, "Waits for a reviewer from another team."],
  ["Test", 1, 3, 90],
  ["Release", 0, 2, 95, "Weekly release train on Thursdays."],
];

/**
 * The improvement the team is aiming for: review within a day by pairing,
 * tests in the pipeline, and releasing on merge. Lead time drops to 12 days
 * and flow efficiency rises to about 42%.
 */
const FUTURE: Row[] = [
  ["Analysis", 1, 3, 85],
  ["Development", 2, 5, 90, "Pairing, so review happens as the code is written."],
  ["Code review", 1, 1, 90],
  ["Test", 1, 2, 95, "Automated in the pipeline."],
  ["Release", 0, 1, 95, "Released on merge."],
];

const toStages = (rows: Row[], state: ValueStreamState): ValueStreamStage[] =>
  rows.map(([name, processTime, leadTime, completeAccurate, description], i) => ({
    id: exampleId(`vsm-${state}-${i + 1}`),
    name,
    processTime,
    leadTime,
    completeAccurate,
    order: i,
    state,
    ...(description ? { description } : {}),
  }));

/**
 * The example map, current and future. The page shows it in memory only:
 * nothing reaches workspace.valueStreamStages, so agents, the dashboard
 * and other devices never see fake stages.
 */
export function buildExample(): ValueStreamStage[] {
  return [...toStages(CURRENT, "current"), ...toStages(FUTURE, "future")];
}
