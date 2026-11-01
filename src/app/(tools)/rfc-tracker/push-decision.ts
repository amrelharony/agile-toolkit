/**
 * RFC Tracker's "Push to Decision Log": a decided RFC becomes an accepted
 * decision record in workspace.decisions (lib/decisions), numbered with the
 * rest of the log and linking back to the RFC (`sourceRef`). Before the
 * decision records merged it wrote the Decision Log's own blob, which the
 * log no longer reads.
 */

import { DECISION_TEXT_MAX, DECISION_TITLE_MAX } from "@/lib/decisions/model";
import { createDecision, currentDecisions, newDecisionId } from "@/lib/decisions/store";
import { isIsoDate } from "@/lib/sprints/calendar";
import type { Decision } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/** The RFC fields a decision record is made from. */
export interface RfcForDecision {
  id: string;
  title: string;
  description?: string;
  /** What was decided. */
  decision?: string;
  /** "YYYY-MM-DD" the RFC was opened: the record's raised day. */
  openedAt?: string;
  /** "YYYY-MM-DD" it was decided. */
  decidedAt?: string;
}

export type RfcPushResult =
  | { ok: true; decision: Decision }
  /** Not pushed: this RFC is in the log already, or another record has its title. */
  | { ok: false; reason: "already-pushed" | "same-title"; existing: Decision };

const dayOf = (v: string | undefined) => (v && isIsoDate(v) ? v.slice(0, 10) : undefined);

/**
 * Push a decided RFC: an accepted ADR raised the day the RFC was opened and
 * decided the day it was decided, with the RFC's decision as the outcome.
 * Refused when the RFC was pushed before or a record (any template, the
 * old Decision Log's pending rows included) has the same title.
 */
export function pushRfcDecision(
  rfc: RfcForDecision,
  today: string = todayLocalISO()
): RfcPushResult {
  const all = currentDecisions();
  const pushed = all.find((d) => d.sourceRef?.tool === "rfc-tracker" && d.sourceRef.id === rfc.id);
  if (pushed) return { ok: false, reason: "already-pushed", existing: pushed };
  const title = rfc.title.trim().slice(0, DECISION_TITLE_MAX);
  const same = all.find((d) => d.title.trim().toLowerCase() === title.toLowerCase());
  if (same) return { ok: false, reason: "same-title", existing: same };
  const decidedAt = dayOf(rfc.decidedAt) ?? today;
  const context = (rfc.description ?? "").trim().slice(0, DECISION_TEXT_MAX);
  const decision = createDecision(
    {
      id: newDecisionId(),
      title,
      ...(context ? { context } : {}),
      decision: (rfc.decision ?? "").trim().slice(0, DECISION_TEXT_MAX),
      status: "accepted",
      date: dayOf(rfc.openedAt) ?? decidedAt,
      decidedAt,
      template: "adr",
      sourceRef: { tool: "rfc-tracker", id: rfc.id },
    },
    all
  );
  return { ok: true, decision };
}
