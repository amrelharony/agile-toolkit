/**
 * What Root Cause's next-step rule loads on demand (`lazyRule` in
 * lib/tools/next-steps): the model's readers, and the causal loop's pick of
 * where to act. A module of its own, so the loop finder loads with the rule
 * and not with every page that reads an analysis through the hand-off routes.
 */

export { liveOnBoards, readAnalyses, sentLink } from "./model";
export { loopToAct, type LoopToAct } from "./loops";
