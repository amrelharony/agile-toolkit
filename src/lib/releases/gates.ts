/**
 * The readiness gates a release goes through: the nine built-in ones, or
 * the team's own list (`ReleaseReadiness.gates`), with the gates that
 * applied frozen on a release when it ships, so editing the list later
 * never rewrites history. Shared by the Release Readiness page, its agent
 * actions and DORA. Pure.
 */

import {
  RELEASE_GATE_IDS,
  type GateId,
  type Release,
  type ReleaseGateDef,
  type ReleaseReadiness,
} from "@/lib/stores/workspace-types";

/** The release-readiness document's one id (the page, its agent actions, Premortem's links). */
export const RELEASE_DOC_ID = "releaseReadiness:current";

/** The built-in gates, in order. "Feature flag ready" can be checked from the Feature Flag Tracker. */
export const BUILT_IN_GATES: readonly (ReleaseGateDef & { id: GateId })[] = [
  { id: "a11y_audit", label: "A11y audit", description: "WCAG checks pass on changed UI" },
  { id: "perf_baseline", label: "Perf baseline", description: "P75 latency within budget" },
  {
    id: "monitoring_dashboards",
    label: "Monitoring dashboards",
    description: "Updated for new flows",
  },
  { id: "alerts_tuned", label: "Alerts tuned", description: "No noisy or missing alerts" },
  { id: "rollback_tested", label: "Rollback tested", description: "Procedure dry-run succeeded" },
  { id: "runbook_linked", label: "Runbook linked", description: "Owner-on-call documented" },
  { id: "sre_review", label: "SRE review", description: "Sign-off from reliability" },
  { id: "security_review", label: "Security review", description: "Sign-off from security" },
  {
    id: "feature_flag_ready",
    label: "Feature flag ready",
    description: "Kill switch in place",
    auto: "flags",
  },
];

/**
 * A gate the team can add: the Definition of Done, checked from the DoD
 * Builder. Not a default, so existing releases' totals don't change.
 */
export const DOD_GATE: ReleaseGateDef = {
  id: "dod_met",
  label: "Definition of Done met",
  description: "Every required criterion of the team's Definition of Done is ticked",
  auto: "dod",
};

const BUILT_IN_BY_ID = new Map<string, ReleaseGateDef>(BUILT_IN_GATES.map((g) => [g.id, g]));

/** Every gate the document knows by id: the team's list (archived ones too), the built-ins and the DoD gate. */
function knownGates(doc: Pick<ReleaseReadiness, "gates"> | undefined): Map<string, ReleaseGateDef> {
  const known = new Map(BUILT_IN_BY_ID);
  known.set(DOD_GATE.id, DOD_GATE);
  for (const g of doc?.gates ?? []) known.set(g.id, g);
  return known;
}

/** The team's current gate list, in order, without archived gates. */
export function teamGates(doc: Pick<ReleaseReadiness, "gates"> | undefined): ReleaseGateDef[] {
  const list: readonly ReleaseGateDef[] = Array.isArray(doc?.gates) ? doc.gates : BUILT_IN_GATES;
  return list.filter((g) => !g.archived);
}

/**
 * The gates that apply to `release`: the ones frozen on it at ship (archived
 * ones included, so a shipped release still names them); for a release
 * shipped before gates were frozen, the built-ins; for one being planned,
 * the team's current list. A frozen id the document no longer knows reads
 * as a gate named by its id.
 */
export function gatesOf(
  release: Pick<Release, "status" | "gateIds">,
  doc: Pick<ReleaseReadiness, "gates"> | undefined
): ReleaseGateDef[] {
  if (Array.isArray(release.gateIds)) {
    const known = knownGates(doc);
    return release.gateIds.map((id) => known.get(id) ?? { id, label: id });
  }
  if (release.status !== "planning") {
    return RELEASE_GATE_IDS.map((id) => BUILT_IN_BY_ID.get(id) ?? { id, label: id });
  }
  return teamGates(doc);
}

/** How many of `defs` are still open on `release` (a gate missing from `gates` is open). */
export function openGateCount(
  release: Pick<Release, "gates">,
  defs: readonly Pick<ReleaseGateDef, "id">[]
): number {
  return defs.filter((g) => !release.gates?.[g.id]).length;
}
