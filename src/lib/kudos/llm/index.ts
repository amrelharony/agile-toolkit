/**
 * Barrel re-exports for the kudos LLM intelligence layer (Phase 3).
 *
 * Lets consumers (kudos-client, kudos-form) write
 *   `import { analyseSentiment, detectDuplicate, computeFairness } from "@/lib/kudos/llm"`
 * instead of reaching into each sibling module. Each helper is
 * send-on-failure: it returns `null` when the BYOK adapter is missing
 * or any error occurs, so the kudos send is NEVER blocked on AI.
 */

export { analyseSentiment } from "./sentiment";
export { detectDuplicate, type DedupResult } from "./dedup";
export {
  computeFairness,
  invalidateFairnessCache,
  installFairnessInvalidator,
  getLastFairnessResult,
  __resetFairnessInvalidator,
  __setLastFairnessResultForTests,
  type FairnessResult,
  type FairnessProfile,
  type FairnessKudosRecord,
  type FairnessSignalRecord,
  type UnderRecognised,
} from "./fairness";
export {
  suggestRecipients,
  primeRecipientSuggestion,
  getCachedTopSuggestion,
  registerRecipientPredictor,
  __resetRecipientSuggestionCache,
  type RecipientSuggestion,
  type RecipientSuggestionResult,
  type RedactedHistoryEvent,
  type SuggestRecipientInput,
} from "./suggest-recipient";
