/**
 * Hand-off target: a risk.
 *
 * Risks live in workspace.risks, the one store the Risk Register, agents
 * and dashboards read since Phase 8 (lib/risks). A send saves a risk there
 * through lib/risks/store (stamped `updatedAt`), keeping the source's
 * owner, description and mitigation, and Undo removes it. The register's
 * old blob is never written: a row still waiting in it for the page's
 * one-time move counts as existing (currentRisks), so a cause the old
 * hand-off sent isn't sent twice.
 *
 * A send needs the likelihood and impact rated (premortem asks for both
 * before it sends): an unrated one is refused, never saved at a default
 * score; a rating off the 1–5 scale is rounded and clamped onto it.
 */

import type { Risk } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { RISK_TEXT_MAX, RISK_TITLE_MAX, toScale } from "@/lib/risks/model";
import { currentRisks, removeRiskRecord, saveRisk } from "@/lib/risks/store";
import type { HandoffRoute, HandoffSource } from "../types";

/** The register's old blob key, now kept in lib/risks with its move. */
export { RISK_REGISTER_KEY } from "@/lib/risks/legacy-register";

/** Why a send can't be a risk yet, or null: both ratings are needed (no default score). */
export function riskSourceProblem(
  src: Pick<HandoffSource, "likelihood" | "impact">
): string | null {
  const p = toScale(src.likelihood) === null;
  const i = toScale(src.impact) === null;
  if (!p && !i) return null;
  if (p && i) return "Rate how likely it is and its impact before it goes to the Risk Register.";
  return p
    ? "Rate how likely it is before it goes to the Risk Register."
    : "Rate its impact before it goes to the Risk Register.";
}

/**
 * The risk a send adds: open, raised today, rated from the source's
 * likelihood and impact (on the 1–5 scale), with its owner, description
 * and mitigation. A title over RISK_TITLE_MAX is cut there, and the whole
 * text then leads the description so nothing is lost. Throws (nothing is
 * saved) when either rating is missing: see riskSourceProblem.
 */
export function buildRisk(
  src: HandoffSource,
  id: string = crypto.randomUUID(),
  today: string = todayLocalISO()
): Risk {
  const problem = riskSourceProblem(src);
  if (problem) throw new Error(problem);
  const full = src.title.trim();
  const title = full.length > RISK_TITLE_MAX ? full.slice(0, RISK_TITLE_MAX).trimEnd() : full;
  const description = [title === full ? "" : full, (src.description ?? "").trim()]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, RISK_TEXT_MAX);
  const mitigation = (src.mitigation ?? "").trim().slice(0, RISK_TEXT_MAX);
  const owner = (src.owner ?? "").trim();
  return {
    id,
    title,
    probability: toScale(src.likelihood)!,
    impact: toScale(src.impact)!,
    ...(mitigation ? { mitigation } : {}),
    status: "open",
    raisedAt: today,
    sourceRef: src.sourceRef,
    ...(owner ? { owner } : {}),
    ...(description ? { description } : {}),
  };
}

const find = (id: string) => currentRisks().find((r) => r.id === id);

export const riskRoute: HandoffRoute = {
  id: "risk",
  label: "Risk",
  doneLabel: "Added to the Risk Register",
  targetToolId: "risk-register",
  targetHref: () => "/risk-register",
  send: (src) => saveRisk(buildRisk(src)).id,
  // Undo: as the register's delete (a blob row waiting for the move is
  // marked moved; canvas cards are unpinned).
  remove: (id) => {
    if (find(id)) removeRiskRecord(id);
  },
  exists: (id) => Boolean(find(id)),
  isDone: (id) => {
    const r = find(id);
    return Boolean(r && (r.status === "closed" || r.status === "accepted"));
  },
};
