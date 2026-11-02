/**
 * Hand-off target: a topic for the retro.
 *
 * A card on the current retro board (./retro-board.ts) in the column its
 * tone fits: a concern (a red health check, a low-mood streak), an
 * appreciation (a kudos), or a question to talk over (a comic's question for
 * the team). The card keeps `sourceRef`.
 */

import type { HandoffRoute } from "../types";
import { addRetroCard, findRetroCard, removeRetroCard } from "./retro-board";

export const retroTopicRoute: HandoffRoute = {
  id: "retro-topic",
  label: "Retro topic",
  doneLabel: "Added to the retro",
  targetToolId: "retro",
  targetHref: () => "/retro",
  send: (src) => addRetroCard(src, false),
  remove: removeRetroCard,
  exists: (id) => Boolean(findRetroCard(id)),
};
