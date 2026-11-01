/**
 * Allocation rounds (Buy-a-Feature, the $100 Test): each person splits a
 * budget across items, and the host keeps per-item totals.
 *
 * A host publishes an `AllocationSheet` (the items, the budget each person
 * splits, whether a split must use all of it, and each item's cap). A
 * participant answers with one whole amount per item, as fixed-width
 * decimal fields (`amountWidth(budget)` digits each, zero-padded), so every
 * ballot in a round has the same ciphertext size: it depends only on the
 * item count and the budget, both public. The host folds each split into an
 * `AllocationTally` and drops it:
 *  - per item, the total given;
 *  - per item, how many people gave an amount in each of 5 bands of the
 *    budget (0, up to 10%, 25%, 50%, more than 50%);
 *  - and the ballot count. No sum of squares, no minimum or maximum.
 *
 * Reveal needs minN ballots (3) and shows every item's total and average
 * (every ballot covers every item, nothing is skipped). Who gave an item
 * anything, and the bands, show only from `VOTE_LIMITS.minNSpread` (5)
 * ballots, and never for totals typed by hand.
 *
 * Privacy (see RUNBOOK "Live vote rounds"):
 *  1. An item's total hides each split in a sum of n ≥ 3. The host knows
 *     its own split, so at n = 3 a host and one colluding member learn the
 *     third person's split: the same residual risk as a scale round.
 *  2. Spending another member's ballot (residual risk 4) singles out one
 *     split exactly; the kit's existing warnings cover it unchanged.
 *  3. Unanimity shows: a total of 0 says everyone gave 0, and with
 *     `spendAll` a total of n × budget says everyone gave everything.
 *  4. Bands wait for 5: a split's bands are linked across items (with
 *     `spendAll`, a person is in the top band of at most one item), so at
 *     n = 3 they would narrow each split more than a scale answer does.
 *  5. No sum of squares (an exact spread): with n = 3 and the host's own
 *     split known, the total and the sum of squares give the two other
 *     amounts per item up to a swap, and `spendAll` resolves the swap
 *     across items, so both splits would come out.
 *  6. Two reveals of the same sheet by nearly the same people can be
 *     diffed. Reveal closes each round, and Buy-a-Feature's rounds change
 *     the sheet (caps, budget); the RUNBOOK names the risk.
 *
 * Buy-a-Feature uses it with `cap` = what's left of each feature's price
 * and `spendAll: false`; the $100 Test with `budget: 100, spendAll: true`.
 *
 * Pure and server-safe (MCP actions may import it): no React, no store,
 * no browser globals.
 */

import { isWithinJsonSize, shareableText } from "../sanitize";
import {
  KIND_STATE_VERSION,
  VOTE_LIMITS,
  isAllocationRoomTool,
  readKindStateHead,
  type AllocationRoomTool,
  type HostKeys,
  type RoundPhase,
  type Signed,
} from "./protocol";
import {
  effectiveMinN,
  precheckBallot,
  type BallotLedger,
  type BallotRejection,
  type FoldContext,
  type RoundResultMeta,
} from "./aggregate";
import { ID_RE, ID_RULE, b64urlChars, isCleanText, isCount, mdCell, obj } from "./wire";

// ── Shapes ───────────────────────────────────────────────────────────

export interface AllocationItem {
  id: string;
  text: string;
  hint?: string;
  /**
   * The most this item can take, from one person and usefully in all
   * (Buy-a-Feature: what's left of its price). A total above it is
   * over-funding (`cappedTotal`). Whole, 1 to `VOTE_LIMITS.maxCap`.
   */
  cap?: number;
}

/** What an allocation round asks: a budget to split across items. */
export interface AllocationSheet {
  id: string;
  title: string;
  /** Whole units each person splits, `VOTE_LIMITS.minBudget` to `maxBudget` (10 to 9,999). */
  budget: number;
  /** Shown with amounts, at most 4 characters ("$", "pts"); may be "". */
  unit: string;
  /** True: a split must use the whole budget ($100 Test). False: up to it (Buy-a-Feature). */
  spendAll: boolean;
  /** 2 to 20 items. */
  items: AllocationItem[];
}

/** One item's revealed result. */
export interface RevealedAllocation {
  /** Everyone's amounts on the item, added up. */
  total: number;
  /** People who gave it more than 0; null while the spread is withheld. */
  backers: number | null;
  /**
   * People per band (`allocationBandEdges`, 5 of them); null under
   * `VOTE_LIMITS.minNSpread` answers or for totals typed by hand.
   */
  bands: number[] | null;
}

export interface AllocationStateBody {
  v: typeof KIND_STATE_VERSION;
  kind: "allocation";
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: AllocationRoomTool;
  /** nanoid(12), new every round. */
  roundId: string;
  /** Epoch ms when the room closes for everyone. */
  endsAt: number;
  minN: number;
  sheet: AllocationSheet;
  keys: HostKeys;
  phase: RoundPhase;
  /** Ballots counted this round. Never a total before Reveal. */
  ballots: number;
  /** Accepted ballot ids, oldest first. [] once revealed. */
  acks: string[];
  /** Non-null exactly when the phase is "revealed". */
  revealed: RevealedAllocation[] | null;
}

export type AllocationStateMessage = Signed<AllocationStateBody>;

/** A split as it is encrypted: `items.length` fields of `amountWidth(budget)` digits, zero-padded. */
export type AllocationString = string;

/** A participant's form: item id → whole amount; null (or missing) counts as 0. */
export type AllocationDraft = Record<string, number | null>;

/** What is wrong with a split. */
export type AllocationProblem = "not-whole" | "over-cap" | "over-budget" | "under-budget" | "empty";

/** Bands each item's amounts are counted in. */
export const ALLOCATION_BANDS = 5;

// ── Amounts and bands ────────────────────────────────────────────────

/** Digits of one amount on the wire: those of the budget, 2 to 4. */
export function amountWidth(budget: number): number {
  return String(Math.trunc(budget)).length;
}

/** The most one person can give `item`: its cap, never above the budget. */
export function allocationItemMax(item: AllocationItem, budget: number): number {
  return item.cap === undefined ? budget : Math.min(item.cap, budget);
}

/**
 * The bands' lower edges for a budget B: [0, 1, ⌊B/10⌋+1, ⌊B/4⌋+1,
 * ⌊B/2⌋+1], so the bands are 0 | up to 10% | up to 25% | up to 50% | more
 * than 50%. B = 100: 0 | 1–10 | 11–25 | 26–50 | 51–100. Strictly rising for
 * every budget from 10.
 */
export function allocationBandEdges(budget: number): number[] {
  const b = Math.trunc(budget);
  return [0, 1, Math.floor(b / 10) + 1, Math.floor(b / 4) + 1, Math.floor(b / 2) + 1];
}

/** The band `amount` falls in (0 to 4). */
export function bandOf(amount: number, edges: readonly number[]): number {
  let band = 0;
  for (let i = 0; i < edges.length; i++) if (amount >= edges[i]) band = i;
  return band;
}

/** Band `k`'s amounts, lowest and highest: [edges[k], next edge − 1], the top band up to the budget. */
export function bandRange(k: number, edges: readonly number[], budget: number): [number, number] {
  const hi = k + 1 < edges.length ? edges[k + 1] - 1 : budget;
  return [edges[k], hi];
}

/**
 * An amount with its unit: "$40" for a symbol, "40 pts" for a word, "40"
 * without a unit. Thousands get commas; a fraction (an average) one decimal.
 */
export function allocationAmount(n: number, unit: string): string {
  const rounded = Number.isInteger(n) ? n : Math.round(n * 10) / 10;
  const num = rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (!unit) return num;
  // A unit with a letter or digit is a word ("pts", "Kč"); anything else a symbol ("$", "€").
  return /[0-9A-Za-zÀ-ɏͰ-ӿ]/.test(unit) ? `${num} ${unit}` : `${unit}${num}`;
}

/** A band as words: "0", "$1–$10", "$51–$100" (one amount when the band is one amount wide). */
export function bandLabel(
  k: number,
  edges: readonly number[],
  budget: number,
  unit: string
): string {
  const [lo, hi] = bandRange(k, edges, budget);
  return lo === hi
    ? allocationAmount(lo, unit)
    : `${allocationAmount(lo, unit)}–${allocationAmount(hi, unit)}`;
}

// ── Host side: what it may share ─────────────────────────────────────

type SheetCheck = { ok: true; sheet: AllocationSheet } | { ok: false; problem: string };

/**
 * Why `budget` can't be split, or null: it must be whole, from
 * `VOTE_LIMITS.minBudget` (below 10 the bands' edges stop rising: "up to
 * 10%" holds no whole amount) to `maxBudget`.
 */
function budgetProblem(budget: unknown): string | null {
  if (
    typeof budget !== "number" ||
    !Number.isInteger(budget) ||
    budget < VOTE_LIMITS.minBudget ||
    budget > VOTE_LIMITS.maxBudget
  ) {
    return `Each person's budget needs to be a whole number from ${VOTE_LIMITS.minBudget} to ${VOTE_LIMITS.maxBudget.toLocaleString("en-US")}.`;
  }
  return null;
}

/** Why item `i`'s cap can't be used, or null: absent, or whole from 1 to `VOTE_LIMITS.maxCap`. */
function capProblem(cap: unknown, i: number): string | null {
  if (cap === undefined) return null;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > VOTE_LIMITS.maxCap) {
    return `Item ${i + 1}'s cap needs to be a whole number from 1 to ${VOTE_LIMITS.maxCap.toLocaleString("en-US")}.`;
  }
  return null;
}

const CAPS_UNDER_BUDGET =
  "The caps add up to less than the budget, so nobody could give it all out.";

/** `toWireSheet` and `sheetProblem` in one pass. */
function checkSheet(s: AllocationSheet): SheetCheck {
  const no = (problem: string): SheetCheck => ({ ok: false, problem });
  if (!s || typeof s !== "object") return no("There is nothing to split.");
  if (typeof s.id !== "string" || !ID_RE.test(s.id)) {
    return no(`The round's id can't be shared live: ${ID_RULE}.`);
  }
  const title = shareableText(String(s.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return no("The round needs a title.");
  const budget = s.budget;
  const badBudget = budgetProblem(budget);
  if (badBudget) return no(badBudget);
  // Cut silently, "dollars" would read "doll": refused instead.
  const unit = shareableText(String(s.unit ?? ""), 64);
  if (unit.length > VOTE_LIMITS.maxUnitChars) {
    return no(`The unit can be at most ${VOTE_LIMITS.maxUnitChars} characters, like $ or pts.`);
  }
  if (typeof s.spendAll !== "boolean") return no("Say whether a split must use the whole budget.");
  if (
    !Array.isArray(s.items) ||
    s.items.length < VOTE_LIMITS.minAllocationItems ||
    s.items.length > VOTE_LIMITS.maxAllocationItems
  ) {
    return no(
      `A live round splits the budget across ${VOTE_LIMITS.minAllocationItems} to ${VOTE_LIMITS.maxAllocationItems} items.`
    );
  }
  const ids = new Set<string>();
  const items: AllocationItem[] = [];
  for (let i = 0; i < s.items.length; i++) {
    const x = s.items[i];
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id)) {
      return no(`Item ${i + 1}'s id can't be shared live: ${ID_RULE}.`);
    }
    if (ids.has(x.id)) return no(`Item ${i + 1} has the same id as an earlier item.`);
    ids.add(x.id);
    const text = shareableText(String(x.text ?? ""), VOTE_LIMITS.maxQuestionChars);
    if (!text) return no(`Item ${i + 1} needs text.`);
    const item: AllocationItem = { id: x.id, text };
    const hint = typeof x.hint === "string" ? shareableText(x.hint, VOTE_LIMITS.maxHintChars) : "";
    if (hint) item.hint = hint;
    const badCap = capProblem(x.cap, i);
    if (badCap) return no(badCap);
    if (x.cap !== undefined) item.cap = x.cap;
    items.push(item);
  }
  if (s.spendAll && items.reduce((sum, x) => sum + allocationItemMax(x, budget), 0) < budget) {
    return no(CAPS_UNDER_BUDGET);
  }
  if (items.length * amountWidth(budget) > VOTE_LIMITS.maxAllocationBytes) {
    return no(
      "Too many items for a budget this large. Split fewer items, or use a smaller budget."
    );
  }
  return { ok: true, sheet: { id: s.id, title, budget, unit, spendAll: s.spendAll, items } };
}

/**
 * The sheet as the host may share it, rebuilt field by field (text on one
 * line, hidden characters stripped, cut to the caps; numbers checked).
 * Null when it can't be shared; `sheetProblem` says why.
 */
export function toWireSheet(s: AllocationSheet): AllocationSheet | null {
  const checked = checkSheet(s);
  return checked.ok ? checked.sheet : null;
}

/**
 * Why `s` can't be shared live, in one sentence for the host, or null when
 * it can. The panel checks it before offering a live round.
 */
export function sheetProblem(s: AllocationSheet): string | null {
  const checked = checkSheet(s);
  return checked.ok ? null : checked.problem;
}

/**
 * Why `s` can't be counted at all, even by hand (paper splits, totals
 * typed in, an agent's counts), in one sentence, or null when it can. Only
 * what the counting needs: a budget the bands work for (10 to 9,999,
 * whole), at least 2 items with distinct ids, caps whole from 1, and caps
 * that leave room to give it all when `spendAll`. Nothing travels, so the
 * live limits on text, ids and item count don't apply. `addAllocation` and
 * `foldAllocationTotals` refuse such a sheet; the count entry says why.
 */
export function allocationCountProblem(s: AllocationSheet): string | null {
  if (!s || typeof s !== "object") return "There is nothing to split.";
  const badBudget = budgetProblem(s.budget);
  if (badBudget) return badBudget;
  if (!Array.isArray(s.items) || s.items.length < VOTE_LIMITS.minAllocationItems) {
    return `A round splits the budget across at least ${VOTE_LIMITS.minAllocationItems} items.`;
  }
  const ids = new Set<string>();
  for (let i = 0; i < s.items.length; i++) {
    const x = s.items[i];
    if (!x || typeof x.id !== "string" || x.id === "") return `Item ${i + 1} needs an id.`;
    if (ids.has(x.id)) return `Item ${i + 1} has the same id as an earlier item.`;
    ids.add(x.id);
    const badCap = capProblem(x.cap, i);
    if (badCap) return badCap;
  }
  if (
    s.spendAll &&
    s.items.reduce((sum, x) => sum + allocationItemMax(x, s.budget), 0) < s.budget
  ) {
    return CAPS_UNDER_BUDGET;
  }
  return null;
}

// ── Answers ──────────────────────────────────────────────────────────

/** A draft's amount for `id`: null or missing is 0; anything else as given. */
function draftAmount(d: AllocationDraft, id: string): unknown {
  const v = Object.prototype.hasOwnProperty.call(d, id) ? d[id] : null;
  return v === null || v === undefined ? 0 : v;
}

/**
 * The first thing wrong with a split, or null when it can be sent: an
 * amount that isn't a whole number from 0 ("not-whole"), or over the most
 * its item takes (`allocationItemMax`), named by the limit that binds:
 * "over-cap" when the cap is below the budget, else "over-budget" (with
 * the item). A Buy-a-Feature cap is often above a player's budget, and the
 * box's hint then names the budget, so the problem must too. Then the
 * split as a whole: nothing given ("empty"), more than the budget
 * ("over-budget"), or less than all of it when the sheet says to spend it
 * all ("under-budget").
 */
export function allocationDraftProblem(
  d: AllocationDraft,
  s: AllocationSheet
): { itemId?: string; problem: AllocationProblem } | null {
  let sum = 0;
  for (const item of s.items) {
    const v = draftAmount(d, item.id);
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return { itemId: item.id, problem: "not-whole" };
    }
    if (v > allocationItemMax(item, s.budget)) {
      const capBinds = item.cap !== undefined && item.cap < s.budget;
      return { itemId: item.id, problem: capBinds ? "over-cap" : "over-budget" };
    }
    sum += v;
  }
  if (sum === 0) return { problem: "empty" };
  if (sum > s.budget) return { problem: "over-budget" };
  if (s.spendAll && sum < s.budget) return { problem: "under-budget" };
  return null;
}

/** The split for `d` as fixed-width digits, or null when `allocationDraftProblem` finds anything. */
export function encodeAllocation(d: AllocationDraft, s: AllocationSheet): AllocationString | null {
  if (allocationDraftProblem(d, s)) return null;
  const width = amountWidth(s.budget);
  return s.items.map((x) => String(draftAmount(d, x.id)).padStart(width, "0")).join("");
}

/** Whether `amounts` is a split `s` accepts: one whole amount per item, within caps and budget. */
function isValidSplit(amounts: readonly number[], s: AllocationSheet): boolean {
  if (!Array.isArray(amounts) || amounts.length !== s.items.length) return false;
  let sum = 0;
  for (let i = 0; i < amounts.length; i++) {
    const a = amounts[i];
    if (!Number.isInteger(a) || a < 0 || a > allocationItemMax(s.items[i], s.budget)) return false;
    sum += a;
  }
  if (sum === 0 || sum > s.budget) return false;
  return !s.spendAll || sum === s.budget;
}

/**
 * A decrypted split as amounts, or null: the wrong length, anything but
 * digits, an amount over its item's cap or the budget, a total over the
 * budget (or short of it when `spendAll`), or nothing given.
 */
export function readAllocationString(plain: string, s: AllocationSheet): number[] | null {
  const width = amountWidth(s.budget);
  if (typeof plain !== "string" || plain.length !== s.items.length * width) return null;
  if (!/^[0-9]+$/.test(plain)) return null;
  const amounts: number[] = [];
  for (let i = 0; i < s.items.length; i++) {
    amounts.push(Number(plain.slice(i * width, (i + 1) * width)));
  }
  return isValidSplit(amounts, s) ? amounts : null;
}

/**
 * The exact ciphertext length (base64url) of a ballot for `s`: the split's
 * bytes plus the 16-byte GCM tag. Every ballot of a round has it; the host
 * drops one of any other length before decrypting it.
 */
export function allocationCiphertextChars(s: AllocationSheet): number {
  return b64urlChars(s.items.length * amountWidth(s.budget) + 16);
}

// ── Readers ──────────────────────────────────────────────────────────

/** A sheet from the wire, or null. Accepts exactly what `toWireSheet` builds. */
function readSheet(raw: unknown): AllocationSheet | null {
  const s = obj(raw);
  if (!s || typeof s.id !== "string" || !ID_RE.test(s.id)) return null;
  if (!isCleanText(s.title, VOTE_LIMITS.maxTitleChars)) return null;
  const budget = s.budget;
  if (
    typeof budget !== "number" ||
    !Number.isInteger(budget) ||
    budget < VOTE_LIMITS.minBudget ||
    budget > VOTE_LIMITS.maxBudget
  ) {
    return null;
  }
  if (typeof s.unit !== "string" || s.unit.length > VOTE_LIMITS.maxUnitChars) return null;
  if (s.unit !== "" && !isCleanText(s.unit, VOTE_LIMITS.maxUnitChars)) return null;
  if (typeof s.spendAll !== "boolean") return null;
  if (!Array.isArray(s.items)) return null;
  if (
    s.items.length < VOTE_LIMITS.minAllocationItems ||
    s.items.length > VOTE_LIMITS.maxAllocationItems
  ) {
    return null;
  }
  const ids = new Set<string>();
  const items: AllocationItem[] = [];
  for (const rawItem of s.items) {
    const x = obj(rawItem);
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || ids.has(x.id)) return null;
    if (!isCleanText(x.text, VOTE_LIMITS.maxQuestionChars)) return null;
    if (x.hint !== undefined && !isCleanText(x.hint, VOTE_LIMITS.maxHintChars)) return null;
    if (x.cap !== undefined && (!isCount(x.cap, VOTE_LIMITS.maxCap) || x.cap < 1)) return null;
    ids.add(x.id);
    const item: AllocationItem = { id: x.id, text: x.text };
    if (typeof x.hint === "string") item.hint = x.hint;
    if (typeof x.cap === "number") item.cap = x.cap;
    items.push(item);
  }
  if (s.spendAll && items.reduce((sum, x) => sum + allocationItemMax(x, budget), 0) < budget)
    return null;
  if (items.length * amountWidth(budget) > VOTE_LIMITS.maxAllocationBytes) return null;
  return { id: s.id, title: s.title, budget, unit: s.unit, spendAll: s.spendAll, items };
}

/** Whether a total fits `bands` (people per band) on an item whose amounts go up to `max`. */
function totalFitsBands(
  total: number,
  bands: readonly number[],
  edges: readonly number[],
  budget: number,
  max: number
): boolean {
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < bands.length; k++) {
    if (bands[k] === 0) continue;
    const [low, high] = bandRange(k, edges, budget);
    if (low > max) return false; // nobody can give more than the item's cap
    lo += bands[k] * low;
    hi += bands[k] * Math.min(high, max);
  }
  return total >= lo && total <= hi;
}

function readRevealedAllocation(
  raw: unknown,
  s: AllocationSheet,
  ballots: number,
  minN: number
): RevealedAllocation[] | null {
  if (!Array.isArray(raw) || raw.length !== s.items.length) return null;
  const edges = allocationBandEdges(s.budget);
  const spreadShown = ballots >= Math.max(minN, VOTE_LIMITS.minNSpread);
  const out: RevealedAllocation[] = [];
  let sum = 0;
  let withSpread = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = obj(raw[i]);
    const max = allocationItemMax(s.items[i], s.budget);
    if (!r || !isCount(r.total, ballots * max)) return null;
    sum += r.total;
    if (r.bands === null) {
      if (r.backers !== null) return null;
      out.push({ total: r.total, backers: null, bands: null });
      continue;
    }
    // The spread only from minNSpread answers: a state that shows it sooner is refused.
    if (!spreadShown) return null;
    const b = r.bands;
    if (!Array.isArray(b) || b.length !== ALLOCATION_BANDS) return null;
    let people = 0;
    for (const n of b) {
      if (!isCount(n, ballots)) return null;
      people += n;
    }
    if (people !== ballots) return null;
    const bands = b.slice() as number[];
    if (r.backers !== ballots - bands[0]) return null;
    if (!totalFitsBands(r.total, bands, edges, s.budget, max)) return null;
    withSpread++;
    out.push({ total: r.total, backers: r.backers, bands });
  }
  // The spread shows for every item or none; every split gives at least 1, at most the budget.
  if (withSpread !== 0 && withSpread !== out.length) return null;
  if (sum < ballots || sum > ballots * s.budget) return null;
  if (s.spendAll && sum !== ballots * s.budget) return null;
  return out;
}

/**
 * An allocation round's host state for this page's `tool`, or null. Checks
 * shape, caps and the reveal rules (totals from minN, the spread from
 * `minNSpread`, totals and bands that some set of valid splits could give);
 * the signature is the hook's call.
 */
export function readAllocationState(
  raw: unknown,
  tool: AllocationRoomTool
): AllocationStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || !isAllocationRoomTool(tool) || !isAllocationRoomTool(m.tool)) return null;
  const head = readKindStateHead(m, tool, "allocation");
  if (!head) return null;
  const sheet = readSheet(m.sheet);
  if (!sheet) return null;
  let revealed: RevealedAllocation[] | null = null;
  if (head.phase === "revealed") {
    revealed = readRevealedAllocation(m.revealed, sheet, head.ballots, head.minN);
    if (!revealed) return null;
  }
  return {
    v: KIND_STATE_VERSION,
    kind: "allocation",
    by: head.by,
    seq: head.seq,
    tool: m.tool,
    roundId: head.roundId,
    endsAt: head.endsAt,
    minN: head.minN,
    sheet,
    keys: head.keys,
    phase: head.phase,
    ballots: head.ballots,
    acks: head.acks,
    revealed,
    sig: head.sig,
  };
}

// ── Counting ─────────────────────────────────────────────────────────

export interface AllocationTally {
  roundId: string;
  budget: number;
  /** `allocationBandEdges(budget)`. */
  edges: number[];
  /** totals[item]: everyone's amounts on the item, added up. */
  totals: number[];
  /** bands[item][band]: people whose amount on the item fell in the band. */
  bands: number[][];
  /** Splits counted (or people, for totals typed by hand). */
  ballots: number;
  /** False once totals were typed by hand: the bands are then unknown and never shown. */
  spreadKnown: boolean;
}

export function emptyAllocationTally(roundId: string, s: AllocationSheet): AllocationTally {
  return {
    roundId,
    budget: s.budget,
    edges: allocationBandEdges(s.budget),
    totals: s.items.map(() => 0),
    bands: s.items.map(() => new Array<number>(ALLOCATION_BANDS).fill(0)),
    ballots: 0,
    spreadKnown: true,
  };
}

function fitsSheet(t: AllocationTally, s: AllocationSheet): boolean {
  return t.budget === s.budget && t.totals.length === s.items.length;
}

/**
 * Add one split (`amounts` per item, as `readAllocationString` returns
 * them) to the totals and bands. Null when the split isn't valid for `s`
 * (the same rules as the reader), the tally is for another sheet, or the
 * count would pass `VOTE_LIMITS.maxTallyBallots`. Never mutates `t`. The
 * facilitator's paper splits and MCP actions fold through it too, so it
 * also refuses a sheet that can't be counted (`allocationCountProblem`: a
 * budget under 10 would put amounts in bands that don't rise).
 */
export function addAllocation(
  t: AllocationTally,
  amounts: readonly number[],
  s: AllocationSheet
): AllocationTally | null {
  if (allocationCountProblem(s)) return null;
  if (!fitsSheet(t, s) || !isValidSplit(amounts, s)) return null;
  if (t.ballots + 1 > VOTE_LIMITS.maxTallyBallots) return null;
  return {
    ...t,
    totals: t.totals.map((n, i) => n + amounts[i]),
    bands: t.bands.map((row, i) => {
      const next = row.slice();
      next[bandOf(amounts[i], t.edges)] += 1;
      return next;
    }),
    ballots: t.ballots + 1,
  };
}

/**
 * Count `by`'s split, after the same pre-checks as a scale ballot (they
 * are re-run: the round, the phase or the seats can change while a ballot
 * is being decrypted). Never mutates its inputs.
 */
export function foldAllocation(
  t: AllocationTally,
  ledger: BallotLedger,
  by: string,
  amounts: readonly number[],
  s: AllocationSheet,
  ctx: FoldContext
):
  | { ok: true; tally: AllocationTally; ledger: BallotLedger }
  | { ok: false; reason: BallotRejection } {
  const rejected = precheckBallot({ by, roundId: t.roundId }, ledger, t, ctx);
  if (rejected) return { ok: false, reason: rejected };
  const tally = addAllocation(t, amounts, s);
  if (!tally) return { ok: false, reason: "bad-answers" };
  const voted = new Set(ledger.voted);
  voted.add(by);
  return { ok: true, tally, ledger: { voted } };
}

/**
 * Add totals typed by hand (the facilitator added up paper splits, or an
 * agent was given only totals): `totals` per item, from `ballots` people.
 * Null unless every total is whole and within `ballots` × the item's cap,
 * they add up to at least `ballots` (everyone gave something) and at most
 * `ballots` × budget (exactly that when `spendAll`), and the people stay
 * within `VOTE_LIMITS.maxTallyBallots`. The spread is then unknown for the
 * round (`spreadKnown: false`). Null too for a sheet that can't be counted
 * (`allocationCountProblem`). Never mutates `t`.
 */
export function foldAllocationTotals(
  t: AllocationTally,
  totals: readonly number[],
  ballots: number,
  s: AllocationSheet
): AllocationTally | null {
  if (allocationCountProblem(s)) return null;
  if (!fitsSheet(t, s) || !Array.isArray(totals) || totals.length !== s.items.length) return null;
  if (!Number.isInteger(ballots) || ballots < 1) return null;
  if (t.ballots + ballots > VOTE_LIMITS.maxTallyBallots) return null;
  let sum = 0;
  for (let i = 0; i < totals.length; i++) {
    const n = totals[i];
    if (!Number.isInteger(n) || n < 0 || n > ballots * allocationItemMax(s.items[i], s.budget))
      return null;
    sum += n;
  }
  if (sum < ballots || sum > ballots * s.budget) return null;
  if (s.spendAll && sum !== ballots * s.budget) return null;
  return {
    ...t,
    totals: t.totals.map((n, i) => n + totals[i]),
    ballots: t.ballots + ballots,
    spreadKnown: false,
  };
}

// ── Reveal rules ─────────────────────────────────────────────────────

/** Whether the round has enough ballots to reveal. */
export function canRevealAllocation(t: AllocationTally, minN: number): boolean {
  return t.ballots >= effectiveMinN(minN);
}

/** Whether a round of `ballots` answers under `minN` may show its spread (and only if it is known). */
export function spreadShows(ballots: number, minN: number, spreadKnown = true): boolean {
  return spreadKnown && ballots >= Math.max(effectiveMinN(minN), VOTE_LIMITS.minNSpread);
}

/**
 * Every item's total; who backed it and the bands only from `minNSpread`
 * answers, and only when the spread is known. Null under minN ballots:
 * nothing can be shown.
 */
export function revealAllocation(t: AllocationTally, minN: number): RevealedAllocation[] | null {
  if (!canRevealAllocation(t, minN)) return null;
  const spread = spreadShows(t.ballots, minN, t.spreadKnown);
  return t.totals.map((total, i) => ({
    total,
    backers: spread ? t.ballots - t.bands[i][0] : null,
    bands: spread ? t.bands[i].slice() : null,
  }));
}

// ── The saved result ─────────────────────────────────────────────────

/** A closed allocation round as a tool saves it: totals only. No ids, no names, nobody's split. */
export interface AllocationRoundResult {
  kind: "allocation";
  roundId: string;
  tool: AllocationRoomTool;
  sheetId: string;
  title: string;
  budget: number;
  unit: string;
  spendAll: boolean;
  /** ISO timestamp of Reveal (or of the facilitator's entry). */
  closedAt: string;
  minN: number;
  /** People who split the budget. */
  ballots: number;
  /** "live": answered in a vote room; "facilitator": paper splits or totals entered by hand. */
  source: "live" | "facilitator";
  /**
   * False when the totals were typed by hand ("Totals only"): how the
   * amounts were spread is then unknown at any count, and the results say
   * so instead of "it needed 5 answers". True for live rounds and paper
   * splits (the spread then shows from `VOTE_LIMITS.minNSpread`).
   */
  spreadKnown: boolean;
  /** Lower edge of each band, ascending from 0 (`allocationBandEdges(budget)`). */
  bandEdges: number[];
  items: {
    id: string;
    text: string;
    cap?: number;
    total: number;
    /** People who gave it more than 0; null when the spread was withheld. */
    backers: number | null;
    /** People per band; null when withheld (fewer than 5 answers, or totals typed by hand). */
    bands: number[] | null;
  }[];
}

/**
 * The result to hand a tool's `onSave`. Applies the minN and minNSpread
 * rules again, so a caller can't save a spread the room would have
 * withheld. `meta.spreadKnown` (default true) is false for totals typed by
 * hand (`AllocationTally.spreadKnown`): no bands are then kept, whatever
 * `revealed` holds. Null under minN ballots, or when `revealed` doesn't
 * fit `s`.
 */
export function toAllocationResult(
  s: AllocationSheet,
  revealed: readonly RevealedAllocation[],
  meta: RoundResultMeta & { tool: AllocationRoomTool; spreadKnown?: boolean }
): AllocationRoundResult | null {
  const minN = effectiveMinN(meta.minN, meta.tool);
  if (meta.ballots < minN || revealed.length !== s.items.length) return null;
  const spreadKnown = meta.spreadKnown !== false;
  const spread = spreadShows(meta.ballots, minN, spreadKnown);
  return {
    kind: "allocation",
    roundId: meta.roundId,
    tool: meta.tool,
    sheetId: s.id,
    title: s.title,
    budget: s.budget,
    unit: s.unit,
    spendAll: s.spendAll,
    closedAt: meta.closedAt,
    minN,
    ballots: meta.ballots,
    source: meta.source,
    spreadKnown,
    bandEdges: allocationBandEdges(s.budget),
    items: s.items.map((item, i) => {
      const r = revealed[i];
      const bands =
        spread &&
        r.bands &&
        r.bands.length === ALLOCATION_BANDS &&
        r.bands.reduce((a, b) => a + b, 0) === meta.ballots
          ? r.bands.slice()
          : null;
      const line: AllocationRoundResult["items"][number] = {
        id: item.id,
        text: item.text,
        total: r.total,
        backers: bands ? meta.ballots - bands[0] : null,
        bands,
      };
      if (item.cap !== undefined) line.cap = item.cap;
      return line;
    }),
  };
}

// ── Statistics ───────────────────────────────────────────────────────

/** The average amount per person, or null with nobody. */
export function allocationMean(total: number, ballots: number): number | null {
  return ballots > 0 ? total / ballots : null;
}

/**
 * The band holding the person at quantile `q` (0 to 1) when everyone is
 * lined up by amount, or null with nobody: `bandAt(bands, 0.5)` is the
 * median person's band.
 */
export function bandAt(bands: readonly number[], q: number): number | null {
  const n = bands.reduce((a, b) => a + b, 0);
  if (n === 0) return null;
  const at = Math.min(n - 1, Math.max(0, Math.round(Math.min(1, Math.max(0, q)) * (n - 1))));
  let seen = 0;
  for (let k = 0; k < bands.length; k++) {
    seen += bands[k];
    if (at < seen) return k;
  }
  return bands.length - 1;
}

/**
 * Where the middle half of the people's amounts lie: the band ranges of
 * the people a quarter and three quarters of the way up. Null with nobody.
 */
export function middleHalf(
  bands: readonly number[],
  edges: readonly number[],
  budget: number
): { low: [number, number]; high: [number, number] } | null {
  const lo = bandAt(bands, 0.25);
  const hi = bandAt(bands, 0.75);
  if (lo === null || hi === null) return null;
  return { low: bandRange(lo, edges, budget), high: bandRange(hi, edges, budget) };
}

/** A total against an item's cap: what it can use, and what is over (Buy-a-Feature refunds it). */
export function cappedTotal(total: number, cap?: number): { kept: number; over: number } {
  if (cap === undefined) return { kept: total, over: 0 };
  return { kept: Math.min(total, cap), over: Math.max(0, total - cap) };
}

/** "$11–$25 to $26–$50", or one range when both quarters share a band. */
export function middleHalfText(
  bands: readonly number[],
  edges: readonly number[],
  budget: number,
  unit: string
): string | null {
  const m = middleHalf(bands, edges, budget);
  if (!m) return null;
  const range = ([lo, hi]: [number, number]) =>
    lo === hi
      ? allocationAmount(lo, unit)
      : `${allocationAmount(lo, unit)}–${allocationAmount(hi, unit)}`;
  return m.low[0] === m.high[0] ? range(m.low) : `${range(m.low)} to ${range(m.high)}`;
}

/** The round as Markdown: one row per item, the spread said plainly when withheld. */
export function allocationRoundMarkdown(r: AllocationRoundResult): string {
  const how = r.source === "live" ? "split anonymously in a live round" : "entered by hand";
  const each = allocationAmount(r.budget, r.unit);
  const lines = [
    `# ${mdCell(r.title)}`,
    "",
    `${r.ballots} ${r.ballots === 1 ? "person" : "people"} ${how}, ${r.closedAt.slice(0, 10)}, ` +
      `with ${each} each${r.spendAll ? " to give out in full" : ""}.`,
    "",
    "| Item | Total | Average | People who gave something | Middle half |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const item of r.items) {
    const mean = allocationMean(item.total, r.ballots);
    const middle = item.bands
      ? (middleHalfText(item.bands, r.bandEdges, r.budget, r.unit) ?? "—")
      : "—";
    const capped = cappedTotal(item.total, item.cap);
    const over = capped.over > 0 ? ` (${allocationAmount(capped.over, r.unit)} over its cap)` : "";
    lines.push(
      `| ${mdCell(item.text)} | ${allocationAmount(item.total, r.unit)}${over} | ${mean === null ? "—" : allocationAmount(mean, r.unit)} | ${item.backers ?? "—"} | ${middle} |`
    );
  }
  if (r.items.every((x) => x.bands === null)) {
    const spreadNeed = Math.max(r.minN, VOTE_LIMITS.minNSpread);
    lines.push(
      "",
      !r.spreadKnown
        ? "The spread isn't known: the totals were entered by hand."
        : r.ballots < spreadNeed
          ? `The spread shows from ${spreadNeed} answers.`
          : "The spread wasn't shared."
    );
  }
  return `${lines.join("\n")}\n`;
}
