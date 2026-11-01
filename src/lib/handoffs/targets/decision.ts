/**
 * Hand-off target: a decision to record.
 *
 * Adds a proposed record to the Decision Log (workspace.decisions, the one
 * decision record DACI and RAPID share): the item becomes its title, its
 * description the context, and the outcome is left for the team to write.
 * A sender can pick the form (`src.decision.template`; absent: ADR) and
 * hand over the options weighed and a recommendation (a weighted matrix's
 * ranked options and its leader). The record gets the next number in the
 * log and keeps `sourceRef`, and "Open" goes to the record itself.
 *
 * Before Phase 7 this route also wrote the Decision Log's own blob, which
 * the page edited; the page's one-time move (lib/decisions/legacy-log)
 * brings those rows into the workspace. Until it has run, `exists` and
 * `isDone` read the blob's pending rows too, as the log will show them, and
 * old DACI / RAPID rows read through as records (lib/decisions/model).
 */

import { buildDecision, decisionHref, isDecided } from "@/lib/decisions/model";
import {
  createDecision,
  currentDecisions,
  newDecisionId,
  removeDecisionRecord,
} from "@/lib/decisions/store";
import type { HandoffRoute } from "../types";

const find = (id: string) => currentDecisions().find((d) => d.id === id);

export const decisionRoute: HandoffRoute = {
  id: "decision",
  label: "Decision record",
  doneLabel: "Added to the Decision Log",
  targetToolId: "decision-log",
  targetHref: decisionHref,
  send: (src) => createDecision(buildDecision(src, newDecisionId())).id,
  remove: (id) => {
    removeDecisionRecord(id);
  },
  exists: (id) => Boolean(find(id)),
  // Decided: accepted (or since deprecated or replaced).
  isDone: (id) => isDecided(find(id)?.status),
};
