/**
 * Quick Vote's stored data (`agile-toolkit:quick-vote`, a tool store synced
 * like the others): the saved results (totals only), the formats the host
 * saved as their own, and the round being set up.
 *
 * Every field is rebuilt on the way out (`normalizeQuickVoteState`), because
 * a synced or hand-edited value can hold anything. Pure and server-safe:
 * Amr's actions read the user's stored row through it on the server too.
 */

import { cleanLine, normalizeDraft, type RoundDraft } from "./draft";
import { normalizeResults, type SavedResult } from "./results";

export interface CustomPreset {
  id: string;
  /** What the host called it ("Sprint Review ROTI"). */
  name: string;
  createdAt: string;
  /** The round it starts: a built-in format with the host's question and answers. */
  draft: RoundDraft;
}

export interface QuickVoteState {
  results: SavedResult[];
  customPresets: CustomPreset[];
  /** The round being set up, kept so a reload (or Amr) can pick it up. */
  draft: RoundDraft | null;
}

export const QUICK_VOTE_INITIAL: QuickVoteState = { results: [], customPresets: [], draft: null };

/** The most saved formats kept. */
export const MAX_CUSTOM_PRESETS = 30;
export const PRESET_NAME_MAX = 60;

const CUSTOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeCustomPreset(raw: unknown): CustomPreset | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !CUSTOM_ID_RE.test(r.id)) return null;
  const name = cleanLine(r.name, PRESET_NAME_MAX);
  const draft = normalizeDraft(r.draft);
  if (!name || !draft) return null;
  const createdAt =
    typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt))
      ? r.createdAt
      : new Date(0).toISOString();
  return { id: r.id, name, createdAt, draft: { ...draft, customId: r.id } };
}

/** Saved formats read back: valid ones, each id once, in the order saved, capped. */
export function normalizeCustomPresets(raw: unknown): CustomPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomPreset[] = [];
  for (const x of raw) {
    const p = normalizeCustomPreset(x);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out.slice(0, MAX_CUSTOM_PRESETS);
}

/**
 * The store's data read back. Takes the store's own state, the user's
 * synced row, or the browser's copy as zustand writes it (`{ state }`).
 */
export function normalizeQuickVoteState(raw: unknown): QuickVoteState {
  let r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.state && typeof r.state === "object" && !("results" in r)) {
    r = r.state as Record<string, unknown>;
  }
  return {
    results: normalizeResults(r.results),
    customPresets: normalizeCustomPresets(r.customPresets),
    draft: normalizeDraft(r.draft),
  };
}
