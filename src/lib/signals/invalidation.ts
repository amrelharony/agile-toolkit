import type { SignalKind } from "./signal-bus";

/**
 * Maps each signal kind to the cache-key prefixes it invalidates in the
 * derived cache. A signal can invalidate multiple prefixes; an asterisk
 * suffix matches any continuation.
 *
 * Keep this conservative: it's safer to invalidate too much than too little
 * (correctness > marginal CPU). The derived cache is small (LRU-200), so
 * over-invalidation just means recompute on next read.
 */
export const INVALIDATION_MATRIX: Record<SignalKind, string[]> = {
  "velocity.changed": ["velocity:", "burndown:", "predictability:", "forecast:", "capacity:", "annotations:"],
  "sprint.completed": ["velocity:", "burndown:", "burnup:", "predictability:", "forecast:", "capacity:", "okr:", "release:", "annotations:"],
  "sprint.started": ["velocity:", "burndown:", "burnup:", "annotations:"],
  "impediment.raised": ["impediments:", "survival:impediments", "crossCorr:blockers-vs-", "annotations:"],
  "impediment.resolved": ["impediments:", "survival:impediments", "crossCorr:blockers-vs-", "annotations:"],
  "risk.opened": ["risk:", "annotations:"],
  "risk.closed": ["risk:", "survival:risk", "annotations:"],
  "okr.kr.updated": ["okr:", "forecast:okr", "annotations:"],
  "techDebt.added": ["techDebt:", "crossCorr:techDebt-vs-", "annotations:"],
  "techDebt.resolved": ["techDebt:", "annotations:"],
  "decision.recorded": ["decision:", "rfc:"],
  "story.statusChanged": ["cycleTime:", "kanban:", "story:", "annotations:"],
  "moodLogged": ["mood:", "crossCorr:mood-vs-", "annotations:"],
  "incident.opened": ["incident:", "mttr:", "crossCorr:deploys-vs-incidents", "annotations:"],
  "incident.resolved": ["incident:", "mttr:", "annotations:"],
  "vuln.opened": ["vuln:", "annotations:"],
  "vuln.closed": ["vuln:", "survival:vuln", "annotations:"],
  "deploy.recorded": ["dora:", "deploy:", "crossCorr:deploys-vs-", "annotations:"],
  "flag.added": ["flag:"],
  "flag.aged": ["flag:"],
  "stakeholder.changed": ["stakeholder:", "annotations:"],
  "rfc.decided": ["rfc:", "decision:"],
};
