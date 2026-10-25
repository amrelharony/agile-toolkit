import { exampleBurndown, type BurnExample } from "../burndown/example";

/**
 * Burnup's example: the same in-memory sprint as Burndown's (it charts the
 * same shared sprint), so the two previews agree. On day 5 of 14 its board
 * holds 13 of 38 points done, with "Refund flow" (8) added on day 3 and
 * "Saved-card analytics" (5) taken out on day 4: the scope line rises and
 * falls while the done area climbs. Never written to the workspace.
 */
export function exampleBurnup(today?: string): BurnExample {
  return exampleBurndown(today);
}
