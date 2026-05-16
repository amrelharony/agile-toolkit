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
  // Phase 19 — AI / LLM PM
  "llmEval.recorded": ["llmEval:", "evalRegression:", "annotations:"],
  "llmEval.regressionDetected": ["llmEval:", "evalRegression:", "hallucination:", "annotations:"],
  "prompt.versionPublished": ["prompt:", "llmEval:", "annotations:"],
  "hallucination.logged": ["hallucination:", "survival:hallucination", "annotations:"],
  "hallucination.resolved": ["hallucination:", "survival:hallucination", "annotations:"],
  "tokenCost.threshold": ["tokenCost:", "annotations:"],
  "model.upgraded": ["model:", "llmEval:", "evalRegression:", "annotations:"],
  "redTeam.findingOpened": ["redTeam:", "survival:redTeam", "annotations:"],
  "redTeam.findingClosed": ["redTeam:", "survival:redTeam", "annotations:"],
  "agentWorkflow.created": ["agentWorkflow:"],
  "hitl.reviewLogged": ["hitl:", "annotations:"],
  "rlhf.pairLogged": ["rlhf:"],
  "vector.collectionAdded": ["vector:"],
  "modelCard.published": ["modelCard:"],
  // Phase 20 — Prioritization
  "prioritization.scored": ["prioritization:", "scoringRubric:"],
  "prioritization.shipped": ["prioritization:", "scoringRubric:"],
  // Phase 21 — Decision Frameworks
  "decision.daciCreated": ["daci:", "decision:"],
  "decision.rapidCreated": ["rapid:", "decision:"],
  "decision.weightedScored": ["weighted:", "decision:"],
  "decision.cynefinClassified": ["cynefin:", "decision:"],
  "decision.staceyClassified": ["stacey:", "decision:"],
  "decision.polarityMapped": ["polarity:", "decision:"],
  "ooda.cycleCompleted": ["ooda:", "survival:ooda"],
  "sixHats.thoughtLogged": ["sixHats:"],
  // Phase 22 — Canvas
  "whiteboard.boardCreated": ["canvas:", "whiteboards:"],
  "whiteboard.boardDeleted": ["canvas:", "whiteboards:"],
  "whiteboard.objectCreated": ["canvas:", "clusters:", "annotations:"],
  "whiteboard.objectMoved": ["canvas:", "clusters:"],
  "whiteboard.objectDeleted": ["canvas:", "clusters:"],
  "whiteboard.commentAdded": ["canvas:", "comments:"],
  "whiteboard.commentMentioned": ["canvas:", "comments:", "notifications:"],
  "whiteboard.boardShared": ["canvas:", "notifications:"],
  "whiteboard.activityLogged": ["canvas:", "activity:"],
  "whiteboard.templateApplied": ["canvas:"],
  "whiteboard.crossToolImport": ["canvas:", "annotations:"],
};
