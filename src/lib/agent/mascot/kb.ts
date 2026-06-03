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

export interface KbSeed {
  id: string;
  toolId: string;
  name: string;
  category: string;
  description: string;
  longDescription?: string;
}

export interface KbEntry {
  id: string;
  toolId: string;
  category: string;
  description: string;
  /** Deduped searchable tokens (from id, toolId, name, description). */
  keys: string[];
}

export interface KbIndex {
  entries: KbEntry[];
  keyFreq: Record<string, number>;
  maxFreq: number;
}

export interface KbMatch {
  entry: KbEntry;
  score: number;
}

export interface KbResult {
  matches: KbMatch[];
  confidence: "high" | "good" | "low" | "none";
  topScore: number;
}

// Words too common to carry intent — dropped from both query + keys.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "is",
  "are",
  "be",
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "should",
  "will",
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "it",
  "this",
  "that",
  "these",
  "those",
  "please",
  "want",
  "need",
  "help",
  "let",
  "lets",
  "some",
  "any",
  "new",
  "all",
  "get",
  "got",
  "use",
  "using",
  "into",
  "out",
  "up",
  "as",
  "if",
  "so",
]);

// Bidirectional agile-domain synonym groups: a query term in one group matches
// an entry keyed with any other term in the group.
const SYN_GROUPS: string[][] = [
  ["sprint", "iteration", "sprints"],
  ["standup", "daily", "scrum"],
  ["retro", "retrospective", "retrospectives"],
  ["impediment", "blocker", "blockers", "obstacle", "impediments"],
  ["story", "stories", "backlog", "pbi", "ticket"],
  ["board", "canvas", "whiteboard", "sticky", "stickies", "note"],
  ["estimate", "estimation", "poker", "points", "estimating"],
  ["okr", "objective", "objectives", "goal", "goals"],
  ["velocity", "throughput", "capacity"],
  ["kudos", "praise", "recognition", "shoutout", "thanks"],
  ["incident", "outage", "postmortem", "mortem"],
  ["prioritize", "prioritise", "priority", "wsjf", "rank", "ranking"],
  ["team", "squad", "workspace"],
  ["create", "add", "make", "start", "open"],
  ["delete", "remove", "clear", "archive"],
  ["update", "edit", "change", "rename", "move", "set"],
  ["list", "show", "view", "see", "find"],
  ["review", "demo", "showcase"],
  ["cycle", "lead", "flow", "cumulative"],
  ["health", "dashboard", "metrics", "kpi", "kpis"],
];

// term → its group-mates (excluding itself). Built via Sets for dedup, then
// stored as plain arrays (the repo's tsconfig target disallows for-of over Set).
const SYNONYMS: Record<string, string[]> = (() => {
  const sets: Record<string, Set<string>> = {};
  for (const group of SYN_GROUPS) {
    for (const term of group) {
      sets[term] ??= new Set();
      for (const other of group) if (other !== term) sets[term].add(other);
    }
  }
  const out: Record<string, string[]> = {};
  for (const term of Object.keys(sets)) out[term] = Array.from(sets[term]);
  return out;
})();

/** Lowercase, strip punctuation, split, drop stopwords + sub-2-char tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/** Build a scoring index from registry-shaped seeds (pure; fixture-friendly). */
export function buildKbIndex(seeds: KbSeed[]): KbIndex {
  const entries: KbEntry[] = seeds.map((s) => {
    const keys = Array.from(
      new Set(tokenize(`${s.id} ${s.toolId} ${s.name} ${s.description} ${s.longDescription ?? ""}`))
    );
    return {
      id: s.id,
      toolId: s.toolId,
      category: s.category,
      description: s.description,
      keys,
    };
  });

  const keyFreq: Record<string, number> = {};
  for (const e of entries) for (const k of e.keys) keyFreq[k] = (keyFreq[k] ?? 0) + 1;
  const maxFreq = Math.max(1, ...Object.values(keyFreq));
  return { entries, keyFreq, maxFreq };
}

function scoreEntry(
  entry: KbEntry,
  words: string[],
  ngrams: string[],
  q: string,
  index: KbIndex
): number {
  let score = 0;
  for (const w of words) {
    for (const key of entry.keys) {
      if (key === w) {
        // Exact key hit, weighted by inverse document frequency (rare → louder).
        score += 5 * (1 + Math.log(index.maxFreq / (index.keyFreq[key] || 1)));
      } else if (key.length > 2 && (key.includes(w) || w.includes(key))) {
        score += 2;
      }
    }
  }
  for (const ng of ngrams) {
    const syns = SYNONYMS[ng];
    if (syns) {
      for (const syn of syns) {
        if (entry.keys.indexOf(syn) >= 0) {
          score += 4;
          break;
        }
      }
    }
  }
  for (const key of entry.keys) {
    if (key.length > 2 && q.includes(key)) score += 6;
  }
  // NB: no category bonus. The website's scorer rewarded a topical category
  // (career/cert/book…), but the toolkit's categories are structural —
  // read/write/intent — which are common English words; matching them on the
  // raw query would flatly boost a whole category whenever the user happened to
  // type "read"/"write", which is noise, not relevance.
  return score;
}

export interface MatchOpts {
  /** Max matches returned (default 5). */
  limit?: number;
}

/** Score `query` against `index`; return the top matches + a confidence band. */
export function matchKb(query: string, index: KbIndex, opts: MatchOpts = {}): KbResult {
  const limit = opts.limit ?? 5;
  const q = query
    .toLowerCase()
    .replace(/[?!.,;:'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return { matches: [], confidence: "none", topScore: 0 };

  const words = tokenize(query);
  if (words.length === 0) return { matches: [], confidence: "none", topScore: 0 };

  const ngrams = [...words];
  for (let i = 0; i < words.length - 1; i++) ngrams.push(`${words[i]} ${words[i + 1]}`);

  const scored = index.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, words, ngrams, q, index) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { matches: [], confidence: "none", topScore: 0 };

  const topScore = scored[0].score;
  const confidence = topScore >= 15 ? "high" : topScore >= 8 ? "good" : "low";
  return { matches: scored.slice(0, limit), confidence, topScore };
}

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

/**
 * Rank action IDs for `query` by raw score, best first, capped at `limit`.
 * Unlike `relevantActions` there is NO confidence gate — this powers trimming
 * the model's tool payload, where we want the best N candidates even on a softer
 * match. Empty query / no matches → []. Pure variant for fixture tests.
 */
export function rankIds(query: string, index: KbIndex, limit = 50): string[] {
  return matchKb(query, index, { limit }).matches.map((m) => m.entry.id);
}

/** `rankIds` over the live registry-seeded index (memoised). */
export function rankActionIds(query: string, limit = 50): string[] {
  return rankIds(query, getRegistryKbIndex(), limit);
}
