/**
 * Hand-off target: a retro action.
 *
 * An action item on the current retro board (./retro-board.ts), owned by the
 * source's owner, so it shows in Retro Actions and is carried into the next
 * retro like one typed there (a maturity roadmap step, say).
 */

import type { HandoffRoute } from "../types";
import { addRetroCard, findRetroCard, removeRetroCard } from "./retro-board";

export const retroActionRoute: HandoffRoute = {
  id: "retro-action",
  label: "Retro action",
  doneLabel: "Added as a retro action",
  targetToolId: "retro-actions",
  targetHref: () => "/retro-actions",
  send: (src) => addRetroCard(src, true),
  remove: removeRetroCard,
  exists: (id) => Boolean(findRetroCard(id)),
  isDone: (id) => findRetroCard(id)?.done === true,
};
