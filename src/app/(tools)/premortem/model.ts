/**
 * The Premortem's data: several premortems, each a facilitated session that
 * moves through four phases (write silently, group duplicates, dot-vote,
 * act on the top three), kept in the tool's own cloud blob.
 *
 * The blob used to hold one premortem with no id, title or phase
 * (`{ scenario, causes }`), every cause rated 3 × 3 the moment it was added.
 * `normalizePremortemState` reads that shape, and anything a newer or older
 * client wrote, into the current one without losing a cause; the key stays
 * `agile-toolkit:premortem`, so the first edit is what writes the new shape.
 */

import type { HandoffLink } from "@/lib/handoffs/types";

export const PREMORTEM_KEY = "agile-toolkit:premortem";

/** The page that owns the premortem's docked timer. */
export const PREMORTEM_PATH = "/premortem";

/** The id a single pre-upgrade premortem loads under. Fixed, so loading it twice is one premortem. */
export const LEGACY_PREMORTEM_ID = "legacy-premortem";

export type PremortemPhase = "write" | "group" | "vote" | "act";

export const PREMORTEM_PHASES: readonly PremortemPhase[] = ["write", "group", "vote", "act"];

export const PHASE_LABEL: Record<PremortemPhase, string> = {
  write: "Write",
  group: "Group",
  vote: "Vote",
  act: "Act",
};

/** What each phase asks of the room, for the stepper and the phase panel. */
export const PHASE_HINT: Record<PremortemPhase, string> = {
  write: "Everyone writes reasons it failed, silently.",
  group: "Read them out and put duplicates together.",
  vote: "Dot-vote the causes most likely to sink it.",
  act: "Rate the top causes and agree what prevents them.",
};

/** How many causes go to the Risk Register. */
export const TOP_N = 3;

/** What a premortem is about: a release in Release Readiness or an epic on the Epic Roadmap. */
export interface PremortemLink {
  kind: "release" | "epic";
  id: string;
  /** The name when linked, shown if the release or epic is later removed. */
  name: string;
}

/** A cause folded into another as a duplicate; Split brings it back as it was. */
export interface MergedCause {
  id: string;
  text: string;
  description?: string;
  likelihood?: number;
  impact?: number;
  preventiveAction?: string;
  owner?: string;
  votes?: number;
  sentTo?: HandoffLink[];
  createdAt?: string;
}

export interface PremortemCause extends MergedCause {
  /** Duplicates grouped into this cause, in the order they were grouped. */
  merged?: MergedCause[];
}

export interface Premortem {
  id: string;
  title: string;
  /** The imagined failure: "It's April, the launch slipped and…". */
  scenario: string;
  link?: PremortemLink;
  phase: PremortemPhase;
  causes: PremortemCause[];
  /** Dots each person may place in the vote (guidance only; nothing enforces it). */
  dotsPerPerson?: number;
  createdAt: string;
}

export interface PremortemState {
  version: 2;
  /** Newest first. */
  premortems: Premortem[];
}

export const EMPTY_PREMORTEM_STATE: PremortemState = { version: 2, premortems: [] };

/* ── Reading stored data ─────────────────────────────────────────────── */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A trimmed optional string: dropped when blank, so an emptied field reads as unset. */
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * A 1–5 rating, or undefined when it was never given. A stored value off
 * the integer steps (a 2.5 typed into the old number box) is kept, so the
 * picker can show it as "Custom"; one outside 1–5 is brought into range,
 * which the old box did on every commit anyway.
 */
function rating(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.min(5, Math.max(1, n));
}

/** Dot votes: a whole number, never below zero. 0 is stored as "no votes". */
function voteCount(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.max(0, Math.floor(v));
  return n > 0 ? n : undefined;
}

function links(v: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (l): l is HandoffLink =>
      isObj(l) && typeof l.route === "string" && typeof l.targetId === "string" && !!l.targetId
  );
  return out.length > 0
    ? out.map((l) => ({ route: l.route, targetId: l.targetId, at: str(l.at) }))
    : undefined;
}

/** Only the fields that are set: an absent field and an undefined one read alike, and compare equal. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function readMerged(raw: unknown): MergedCause | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const text = str(raw.text).trim();
  const description = optStr(raw.description);
  const preventiveAction = optStr(raw.preventiveAction);
  const owner = optStr(raw.owner);
  // A cause with nothing written in it (the old "Add Cause" saved those
  // blank) carries nothing worth keeping.
  if (!text && !description && !preventiveAction && !owner) return null;
  return compact({
    id: raw.id,
    text,
    description,
    likelihood: rating(raw.likelihood),
    impact: rating(raw.impact),
    preventiveAction,
    owner,
    votes: voteCount(raw.votes),
    sentTo: links(raw.sentTo),
    createdAt: optStr(raw.createdAt),
  });
}

function readCause(raw: unknown): PremortemCause | null {
  const base = readMerged(raw);
  if (!base || !isObj(raw)) return null;
  const merged = Array.isArray(raw.merged)
    ? raw.merged.map(readMerged).filter((m): m is MergedCause => m !== null)
    : [];
  return merged.length > 0 ? { ...base, merged } : base;
}

/** Causes with their duplicates dropped: the first of an id wins, merged copies included. */
function readCauses(raw: unknown): PremortemCause[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  /** True the first time `id` is met. */
  const first = (id: string) => !seen.has(id) && Boolean(seen.add(id));
  const out: PremortemCause[] = [];
  for (const row of raw) {
    const cause = readCause(row);
    if (!cause || !first(cause.id)) continue;
    const merged = (cause.merged ?? []).filter((m) => first(m.id));
    out.push(compact({ ...cause, merged: merged.length > 0 ? merged : undefined }));
  }
  return out;
}

function readLink(raw: unknown): PremortemLink | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.kind !== "release" && raw.kind !== "epic") return undefined;
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  return { kind: raw.kind, id: raw.id, name: str(raw.name).trim() || raw.id };
}

const isPhase = (v: unknown): v is PremortemPhase =>
  typeof v === "string" && (PREMORTEM_PHASES as readonly string[]).includes(v);

function readPremortem(raw: unknown): Premortem | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const dots = typeof raw.dotsPerPerson === "number" ? Math.floor(raw.dotsPerPerson) : NaN;
  return compact({
    id: raw.id,
    title: str(raw.title).trim() || "Premortem",
    scenario: str(raw.scenario),
    link: readLink(raw.link),
    phase: isPhase(raw.phase) ? raw.phase : "write",
    causes: readCauses(raw.causes),
    dotsPerPerson: Number.isFinite(dots) && dots > 0 ? Math.min(dots, 99) : undefined,
    createdAt: str(raw.createdAt),
  });
}

/**
 * Whatever is stored, as the current shape. Pure and idempotent: running it
 * on its own output gives the same result.
 *
 *   - The pre-upgrade `{ scenario, causes }` becomes one premortem under
 *     LEGACY_PREMORTEM_ID, in the Act phase (its causes were already rated),
 *     each cause keeping its id, text, ratings, owner and Risk Register link,
 *     in the order the team put them in. With a scenario but no causes yet,
 *     it opens in Write instead: there is nothing to act on. A blank one (no
 *     scenario, no causes) is no premortem at all.
 *   - Rows that can't be read (no id, nothing written) are dropped, and the
 *     first of two rows with one id wins.
 */
export function normalizePremortemState(raw: unknown): PremortemState {
  if (!isObj(raw)) return EMPTY_PREMORTEM_STATE;
  if (Array.isArray(raw.premortems)) {
    const seen = new Set<string>();
    const premortems = raw.premortems
      .map(readPremortem)
      .filter((p): p is Premortem => p !== null && !seen.has(p.id) && Boolean(seen.add(p.id)));
    return { version: 2, premortems };
  }
  // The single premortem every user had before the upgrade.
  const causes = readCauses(raw.causes);
  const scenario = str(raw.scenario);
  if (causes.length === 0 && !scenario.trim()) return EMPTY_PREMORTEM_STATE;
  return {
    version: 2,
    premortems: [
      {
        id: LEGACY_PREMORTEM_ID,
        title: "Premortem",
        scenario,
        phase: causes.length > 0 ? "act" : "write",
        causes,
        createdAt: "",
      },
    ],
  };
}

/* ── Scores and the ranking ──────────────────────────────────────────── */

export const votesOf = (c: Pick<MergedCause, "votes">): number => c.votes ?? 0;

/** Likelihood × impact, or null until both are rated (never a silent 3 × 3). */
export function causeScore(c: Pick<MergedCause, "likelihood" | "impact">): number | null {
  return c.likelihood === undefined || c.impact === undefined ? null : c.likelihood * c.impact;
}

export const isRated = (c: Pick<MergedCause, "likelihood" | "impact">): boolean =>
  causeScore(c) !== null;

/** "L4 × I4 = 16", or "Not scored". */
export function scoreText(c: Pick<MergedCause, "likelihood" | "impact">): string {
  const score = causeScore(c);
  if (score === null) return "Not scored";
  const n = (v: number) => String(Math.round(v * 10) / 10);
  return `L${n(c.likelihood!)} × I${n(c.impact!)} = ${n(score)}`;
}

/**
 * The one ranking: most votes first (the room's call), then likelihood ×
 * impact (unscored last). Causes level on both keep their stored order (the
 * sort is stable): the order they were written in, or, in a pre-upgrade
 * premortem, the order the team put them in by hand, where every cause
 * started at 3 × 3 and most still tie. Breaking ties by the text sorted
 * those A to Z, and rewording a cause moved it.
 */
export function compareCauses(a: PremortemCause, b: PremortemCause): number {
  const votes = votesOf(b) - votesOf(a);
  if (votes !== 0) return votes;
  const sa = causeScore(a);
  const sb = causeScore(b);
  if (sa === sb) return 0;
  if (sa === null) return 1;
  if (sb === null) return -1;
  return sb - sa;
}

export const rankCauses = (causes: readonly PremortemCause[]): PremortemCause[] =>
  [...causes].sort(compareCauses);

/** A cause the room has said something about: voted for, or rated. */
const weighed = (c: PremortemCause) => votesOf(c) > 0 || isRated(c);

const sameRank = (a: PremortemCause, b: PremortemCause) =>
  votesOf(a) === votesOf(b) && causeScore(a) === causeScore(b);

export interface TopCauses {
  /**
   * The first TOP_N of the ranking among the causes with a vote or a
   * rating. A cause nobody voted for or rated is never "top" just because
   * it was written early (no silent defaults): with nothing to separate
   * the causes there is no top at all, and the room votes or rates first.
   */
  top: PremortemCause[];
  /**
   * The causes level with the last of the top at the cut-off, when one of
   * them falls outside it. Empty when the cut-off is clear.
   */
  tied: PremortemCause[];
}

export function topCauses(causes: readonly PremortemCause[], n = TOP_N): TopCauses {
  const ranked = rankCauses(causes).filter(weighed);
  const top = ranked.slice(0, n);
  const last = top[top.length - 1];
  const next = ranked[n];
  if (!last || !next || !sameRank(last, next)) return { top, tied: [] };
  return { top, tied: ranked.filter((c) => sameRank(c, last)) };
}

export const totalVotes = (causes: readonly PremortemCause[]): number =>
  causes.reduce((sum, c) => sum + votesOf(c), 0);

/* ── Changes (pure) ──────────────────────────────────────────────────── */

export function patchCause(
  p: Premortem,
  id: string,
  patch: Partial<Omit<PremortemCause, "id">>
): Premortem {
  return {
    ...p,
    causes: p.causes.map((c) => (c.id === id ? compact({ ...c, ...patch }) : c)),
  };
}

/** The cause without its `merged` list: what a cause looks like inside another. */
function asMerged(c: PremortemCause): MergedCause {
  const rest: PremortemCause = { ...c };
  delete rest.merged;
  return rest;
}

const sumVotes = (causes: readonly MergedCause[]) => causes.reduce((sum, c) => sum + votesOf(c), 0);

/**
 * The cause without the grouped duplicates `match` picks, and without the
 * votes they brought.
 */
export function dropMerged(c: PremortemCause, match: (m: MergedCause) => boolean): PremortemCause {
  const gone = (c.merged ?? []).filter(match);
  if (gone.length === 0) return c;
  const merged = (c.merged ?? []).filter((m) => !match(m));
  const votes = votesOf(c) - sumVotes(gone);
  return compact({
    ...c,
    votes: votes > 0 ? votes : undefined,
    merged: merged.length > 0 ? merged : undefined,
  });
}

/**
 * Group `sourceId` into `targetId` as a duplicate. The source and anything
 * already grouped into it go on the target's `merged` list, its votes add
 * to the target's, and it leaves the list. The target keeps its own text,
 * ratings and owner.
 *
 * A cause's votes are always its own plus its duplicates', and each entry
 * on `merged` holds only its own, so Split can hand every one back exactly.
 */
export function mergeCause(p: Premortem, sourceId: string, targetId: string): Premortem {
  if (sourceId === targetId) return p;
  const source = p.causes.find((c) => c.id === sourceId);
  const target = p.causes.find((c) => c.id === targetId);
  if (!source || !target) return p;
  const carried = source.merged ?? [];
  const own = votesOf(source) - sumVotes(carried);
  const absorbed = [compact({ ...asMerged(source), votes: own > 0 ? own : undefined }), ...carried];
  const votes = votesOf(target) + votesOf(source);
  return {
    ...p,
    causes: p.causes
      .filter((c) => c.id !== sourceId)
      .map((c) =>
        c.id === targetId
          ? compact({
              ...c,
              votes: votes > 0 ? votes : undefined,
              merged: [...(c.merged ?? []), ...absorbed],
            })
          : c
      ),
  };
}

/**
 * Undo a `mergeCause`: take `source` (and what it carried) back off the
 * cause that holds it, its votes with it, and put it back at `index`.
 * Nothing happens if the source is already back.
 *
 * The holder is looked up, not assumed to be the target: the target may
 * since have been grouped into a third cause, so the source sits on that
 * one's list now. A duplicate the source carried that is already back on
 * its own (its own Undo ran first) stays where it is, and its votes leave
 * the source, so no cause is ever listed or counted twice.
 */
export function unmergeCause(p: Premortem, source: PremortemCause, index: number): Premortem {
  if (p.causes.some((c) => c.id === source.id)) return p;
  const ids = new Set([source.id, ...(source.merged ?? []).map((m) => m.id)]);
  const causes = p.causes.map((c) => dropMerged(c, (m) => ids.has(m.id)));
  const present = new Set(causes.flatMap((c) => [c.id, ...(c.merged ?? []).map((m) => m.id)]));
  causes.splice(
    Math.min(index, causes.length),
    0,
    dropMerged(source, (m) => present.has(m.id))
  );
  return { ...p, causes };
}

/**
 * Split a grouped cause: each duplicate comes back as its own cause right
 * after it, with the votes it brought.
 */
export function splitCause(p: Premortem, id: string): Premortem {
  const index = p.causes.findIndex((c) => c.id === id);
  const cause = p.causes[index];
  if (!cause?.merged?.length) return p;
  const restored = cause.merged.filter((m) => !p.causes.some((c) => c.id === m.id));
  const votes = votesOf(cause) - sumVotes(restored);
  const kept = compact({ ...cause, merged: undefined, votes: votes > 0 ? votes : undefined });
  const causes = [...p.causes];
  causes.splice(index, 1, kept, ...restored);
  return { ...p, causes };
}

/**
 * Set a cause's dot votes; never below zero.
 *
 * A grouped cause's votes are its own plus its duplicates', so taking it
 * below what the duplicates brought takes the rest from them, the last
 * grouped first. Split then hands back only the votes the cause still
 * shows: a vote the facilitator removed never comes back.
 */
export function setVotes(p: Premortem, id: string, votes: number): Premortem {
  const n = Math.max(0, Math.floor(Number.isFinite(votes) ? votes : 0));
  const cause = p.causes.find((c) => c.id === id);
  if (!cause) return p;
  let excess = sumVotes(cause.merged ?? []) - n;
  const merged =
    excess > 0
      ? [...(cause.merged ?? [])]
          .reverse()
          .map((m) => {
            const take = Math.min(votesOf(m), excess);
            if (take === 0) return m;
            excess -= take;
            const left = votesOf(m) - take;
            return compact({ ...m, votes: left > 0 ? left : undefined });
          })
          .reverse()
      : cause.merged;
  return patchCause(p, id, { votes: n > 0 ? n : undefined, merged });
}

/** Every vote, by cause id (the grouped duplicates' too), for putting them back. */
export function votesById(p: Premortem): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of p.causes) {
    if (votesOf(c) > 0) out.set(c.id, votesOf(c));
    for (const m of c.merged ?? []) if (votesOf(m) > 0) out.set(m.id, votesOf(m));
  }
  return out;
}

/**
 * The premortem with every vote set from `votes` (absent ids get none):
 * `new Map()` clears the vote, `votesById(before)` puts it back.
 */
export function withVotes(p: Premortem, votes: ReadonlyMap<string, number>): Premortem {
  const set = <T extends MergedCause>(c: T): T => compact({ ...c, votes: votes.get(c.id) });
  return {
    ...p,
    causes: p.causes.map((c) => (c.merged ? { ...set(c), merged: c.merged.map(set) } : set(c))),
  };
}

/** A copy of `p` with `change` applied to the premortem `id`. */
export function updatePremortem(
  state: PremortemState,
  id: string,
  change: (p: Premortem) => Premortem
): PremortemState {
  let changed = false;
  const premortems = state.premortems.map((p) => {
    if (p.id !== id) return p;
    const next = change(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...state, premortems } : state;
}

/**
 * The premortem the page opens on: the one asked for (a `?premortem=` link
 * or the picker), else the newest.
 */
export function pickPremortem(
  premortems: readonly Premortem[],
  chosenId: string | null
): Premortem | undefined {
  if (chosenId) {
    const chosen = premortems.find((p) => p.id === chosenId);
    if (chosen) return chosen;
  }
  // Newest by creation; the pre-upgrade premortem has no date and sorts last.
  return [...premortems].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
