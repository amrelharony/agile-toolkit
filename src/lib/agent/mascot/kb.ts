/**
 * KB help (RAG-lite) — relevance-focusing over the action registry.
 *
 * The agent already receives every action in its `tools` array, but with 110+
 * tools the truly-relevant handful can drown in the noise. This module scores
 * the user's query against a KB seeded from the registry (id + description) and
 * lets the orchestrator inject the top matches into the system prompt as a
 * "most relevant actions" hint — grounding "how do I…" answers in real toolkit
 * capabilities without bypassing tool-calling.
 *
 * The matcher is ported from the personal website's keyword/IDF scorer
 * (chatbot-llm.js `scoreEntry`/`matchQuery`), adapted to the agile domain with
 * a synonym map (blocker↔impediment, standup↔daily, …). Pure + unit-tested; the
 * registry integration (`getRegistryKbIndex`/`relevantActions`) is a thin,
 * memoised default on top.
 */

import { registry } from "@/lib/actions/registry";
import { buildKbIndex, matchKb, rankIds, type KbIndex, type KbSeed } from "@/lib/search/kb-core";

// The pure matcher lives in lib/search/kb-core so visitor-facing search can use
// it without importing the registry. Re-exported for existing callers/tests.
export {
  buildKbIndex,
  matchKb,
  rankIds,
  tokenize,
  type KbEntry,
  type KbIndex,
  type KbMatch,
  type KbResult,
  type KbSeed,
  type MatchOpts,
} from "@/lib/search/kb-core";

// ── Registry integration (memoised) ──
let _index: KbIndex | null = null;

/** Build (once) a KB index from the live action registry. */
export function getRegistryKbIndex(): KbIndex {
  if (_index) return _index;
  const seeds: KbSeed[] = registry.list().map((a) => ({
    id: a.id,
    toolId: a.toolId,
    name: a.name,
    category: a.category,
    description: a.description,
    longDescription: a.longDescription,
  }));
  _index = buildKbIndex(seeds);
  return _index;
}

/** Reset the memoised index (tests / HMR after the registry changes). */
export function resetRegistryKbIndex(): void {
  _index = null;
}

/**
 * Top relevant actions for a query, ready to inject into the system prompt.
 * Returns [] for weak/empty matches so the prompt stays unchanged when the KB
 * has nothing confident to add.
 */
export function relevantActions(
  query: string,
  limit = 5
): Array<{ id: string; description: string }> {
  const res = matchKb(query, getRegistryKbIndex(), { limit });
  if (res.confidence === "none" || res.confidence === "low") return [];
  return res.matches.map((m) => ({ id: m.entry.id, description: m.entry.description }));
}

/** `rankIds` over the live registry-seeded index (memoised). */
export function rankActionIds(query: string, limit = 50): string[] {
  return rankIds(query, getRegistryKbIndex(), limit);
}
