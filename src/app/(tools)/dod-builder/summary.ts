/**
 * What the Definition of Done builder stores, as the Team charter reads it.
 * The page keeps its own richer types; this is the shape both agree on.
 */

/** MUST match the key the DoD builder page persists under. */
export const DOD_STORAGE_KEY = "agile-toolkit:dod-builder";

export interface DodDocItem {
  id: string;
  label: string;
  description?: string;
  category: string;
  required: boolean;
}

export interface DodDocSnapshot {
  sprintName: string;
  totalRequired: number;
  completed: number;
  ts: string;
}

export interface DodDoc {
  items: DodDocItem[];
  history: DodDocSnapshot[];
}

export const EMPTY_DOD: DodDoc = { items: [], history: [] };

/** A stored blob in a usable shape (missing or older blobs included). */
export function normalizeDod(raw: unknown): DodDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DodDoc>;
  return {
    items: Array.isArray(r.items)
      ? r.items.filter((i): i is DodDocItem => Boolean(i && typeof i.label === "string"))
      : [],
    history: Array.isArray(r.history)
      ? r.history.filter((h): h is DodDocSnapshot => Boolean(h && typeof h.sprintName === "string"))
      : [],
  };
}
