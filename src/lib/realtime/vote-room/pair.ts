/**
 * Pair rounds (Kano): two linked questions per item, kept as their joint
 * count.
 *
 * The Kano evaluation table needs each person's PAIR of answers about a
 * feature ("If it has this, how do you feel?" and "If it doesn't have
 * this?"): two separate distributions lose the pairing. So a pair round
 * makes ONE answer character per item, the joint index `first × P + second`
 * on a scale of P ≤ 5 answers, and the host counts those characters per
 * item exactly as a scale round counts answers per question. The joint
 * count per item (P × P cells, 25 for Kano) is the only thing kept: nothing
 * per person, and nothing that links one item's pair to another item's.
 *
 * On the wire it is a v2 state with `kind: "pair"` (scale states stay v1).
 * Ballots are the v1 envelope with one byte per item, like a scale ballot
 * of as many questions, so every ballot in a round is the same size.
 * Reveal follows the scale rules: minN ballots (3), and an item's joint
 * shows only from minN answers to it (an optional item can be skipped).
 *
 * Pure and server-safe (MCP actions may import it): no React, no store,
 * no browser globals.
 */

import { isWithinJsonSize, shareableText } from "../sanitize";
import {
  KIND_STATE_VERSION,
  SKIPPED,
  VOTE_LIMITS,
  isPairRoomTool,
  readKindStateHead,
  type HostKeys,
  type PairRoomTool,
  type RoundPhase,
  type Signed,
} from "./protocol";
import {
  effectiveMinN,
  foldBallot,
  foldCounts,
  revealTally,
  type BallotLedger,
  type FoldContext,
  type FoldResult,
  type RoundResultMeta,
  type Tally,
} from "./aggregate";
import { ID_RE, ID_RULE, b64urlChars, isCleanText, isCount, mdCell, obj } from "./wire";

// ── Shapes ───────────────────────────────────────────────────────────

/** The two questions asked about every item. */
export interface PairPrompts {
  /** Kano's functional question: "If it has this, how do you feel?" */
  first: string;
  /** Kano's dysfunctional question: "If it doesn't have this, how do you feel?" */
  second: string;
}

export interface PairItem {
  id: string;
  /** What the two questions are about (Kano: the feature). */
  text: string;
  hint?: string;
  /** People may skip it (both answers blank). Others need both answers to send. */
  optional?: boolean;
}

/** What a pair round asks: the same two questions about each item, on one short scale. */
export interface PairSheet {
  id: string;
  title: string;
  prompts: PairPrompts;
  /**
   * The answers both questions pick from, in order: an answer is its index.
   * 2 to 5 of them (Kano: `KANO_PAIR_ANSWERS`). A joint cell is
   * `first × answers.length + second`.
   */
  answers: string[];
  items: PairItem[];
}

/** One item's revealed result. */
export interface RevealedPair {
  /** Ballots that answered it (both questions; not skipped). */
  responses: number;
  /**
   * People per answer pair, `joint[first × P + second]` with P answers.
   * Null: withheld, fewer than minN answers.
   */
  joint: number[] | null;
}

export interface PairStateBody {
  v: typeof KIND_STATE_VERSION;
  kind: "pair";
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: PairRoomTool;
  /** nanoid(12), new every round. */
  roundId: string;
  /** Epoch ms when the room closes for everyone. */
  endsAt: number;
  minN: number;
  sheet: PairSheet;
  keys: HostKeys;
  phase: RoundPhase;
  /** Ballots counted this round. Never per item before Reveal. */
  ballots: number;
  /** Accepted ballot ids, oldest first. [] once revealed. */
  acks: string[];
  /** Non-null exactly when the phase is "revealed". */
  revealed: RevealedPair[] | null;
}

export type PairStateMessage = Signed<PairStateBody>;

/**
 * Answers as they are encrypted: `length === items.length`, character i is
 * item i's joint index in `PAIR_ALPHABET`, or `SKIPPED` (optional items).
 */
export type PairString = string;

/**
 * A participant's form: `pairDraftKey(itemId, "first" | "second")` → the
 * chosen answer's index; null while not chosen. The same record shape as a
 * scale round's `AnswerDraft`, so the room's `submit` takes either.
 */
export type PairDraft = Record<string, number | null>;

/** Joint answer characters: the i-th is joint index i. 25 = the largest P² (5 answers). */
export const PAIR_ALPHABET = "0123456789abcdefghijklmno";

/**
 * Kano's five answers, in the evaluation table's order: like, must-be
 * (expect), neutral, live with, dislike. The Kano tool maps a joint cell to
 * its category by these indexes.
 */
export const KANO_PAIR_ANSWERS = [
  "I like it",
  "I expect it",
  "I'm neutral",
  "I can live with it",
  "I dislike it",
] as const;

/** Kano's functional and dysfunctional questions, as the kit words them. */
export const KANO_PAIR_PROMPTS: Readonly<PairPrompts> = {
  first: "If it has this, how do you feel?",
  second: "If it doesn't have this, how do you feel?",
};

/** The draft key for one half of an item's pair. "/" is not an id character, so keys never clash. */
export function pairDraftKey(itemId: string, part: "first" | "second"): string {
  return `${itemId}/${part}`;
}

/** The joint cell of answer `first` to the first question and `second` to the second. */
export function jointIndex(first: number, second: number, points: number): number {
  return first * points + second;
}

// ── Host side: what it may share ─────────────────────────────────────

type SheetCheck = { ok: true; sheet: PairSheet } | { ok: false; problem: string };

/** `toWirePairSheet` and `pairSheetProblem` in one pass. */
function checkPairSheet(s: PairSheet): SheetCheck {
  const no = (problem: string): SheetCheck => ({ ok: false, problem });
  if (!s || typeof s !== "object") return no("There is nothing to ask about.");
  if (typeof s.id !== "string" || !ID_RE.test(s.id)) {
    return no(`The round's id can't be shared live: ${ID_RULE}.`);
  }
  const title = shareableText(String(s.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return no("The round needs a title.");
  const prompts = s.prompts;
  const first = shareableText(String(prompts?.first ?? ""), VOTE_LIMITS.maxPairPromptChars);
  const second = shareableText(String(prompts?.second ?? ""), VOTE_LIMITS.maxPairPromptChars);
  if (!first || !second) return no("Both questions need text.");
  if (
    !Array.isArray(s.answers) ||
    s.answers.length < VOTE_LIMITS.minPairPoints ||
    s.answers.length > VOTE_LIMITS.maxPairPoints
  ) {
    return no(
      `The questions need ${VOTE_LIMITS.minPairPoints} to ${VOTE_LIMITS.maxPairPoints} answers to pick from.`
    );
  }
  const answers: string[] = [];
  for (const raw of s.answers) {
    const label = shareableText(String(raw ?? ""), VOTE_LIMITS.maxPointLabelChars);
    if (!label) return no("Every answer needs a label.");
    if (answers.includes(label)) return no("Each answer needs its own label.");
    answers.push(label);
  }
  if (!Array.isArray(s.items) || s.items.length < 1) return no("Add at least one item.");
  if (s.items.length > VOTE_LIMITS.maxPairItems) {
    return no(`A live round can ask about at most ${VOTE_LIMITS.maxPairItems} items.`);
  }
  const ids = new Set<string>();
  const items: PairItem[] = [];
  for (let i = 0; i < s.items.length; i++) {
    const x = s.items[i];
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id)) {
      return no(`Item ${i + 1}'s id can't be shared live: ${ID_RULE}.`);
    }
    if (ids.has(x.id)) return no(`Item ${i + 1} has the same id as an earlier item.`);
    ids.add(x.id);
    const text = shareableText(String(x.text ?? ""), VOTE_LIMITS.maxQuestionChars);
    if (!text) return no(`Item ${i + 1} needs text.`);
    const item: PairItem = { id: x.id, text };
    const hint = typeof x.hint === "string" ? shareableText(x.hint, VOTE_LIMITS.maxHintChars) : "";
    if (hint) item.hint = hint;
    if (x.optional === true) item.optional = true;
    items.push(item);
  }
  return { ok: true, sheet: { id: s.id, title, prompts: { first, second }, answers, items } };
}

/**
 * The sheet as the host may share it, rebuilt field by field (text on one
 * line, hidden characters stripped, cut to the caps). Null when it can't be
 * shared; `pairSheetProblem` says why.
 */
export function toWirePairSheet(s: PairSheet): PairSheet | null {
  const checked = checkPairSheet(s);
  return checked.ok ? checked.sheet : null;
}

/** Why `s` can't be shared live, in one sentence for the host, or null when it can. */
export function pairSheetProblem(s: PairSheet): string | null {
  const checked = checkPairSheet(s);
  return checked.ok ? null : checked.problem;
}

// ── Answers ──────────────────────────────────────────────────────────

/** What is wrong with one item's two answers in a draft. */
export type PairItemProblem = "half" | "missing" | "off-scale";

function draftValue(d: PairDraft, key: string): number | null {
  const v = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
  return v === undefined ? null : v;
}

/**
 * Item `item`'s answers in `d`, or what is wrong with them: one answered
 * and not the other ("half"), a required item left blank ("missing"), or a
 * value that isn't an answer index ("off-scale"). Null when the item is
 * answered, or optional and blank.
 */
export function pairItemProblem(
  d: PairDraft,
  item: PairItem,
  points: number
): PairItemProblem | null {
  const first = draftValue(d, pairDraftKey(item.id, "first"));
  const second = draftValue(d, pairDraftKey(item.id, "second"));
  for (const v of [first, second]) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v >= points)) return "off-scale";
  }
  if ((first === null) !== (second === null)) return "half";
  if (first === null && item.optional !== true) return "missing";
  return null;
}

/** The first problem in a draft (an item's, or "empty" when nothing at all was answered), or null. */
export function pairDraftProblem(
  d: PairDraft,
  s: PairSheet
): { itemId: string; problem: PairItemProblem } | { problem: "empty" } | null {
  const points = s.answers.length;
  let answered = 0;
  for (const item of s.items) {
    const problem = pairItemProblem(d, item, points);
    if (problem) return { itemId: item.id, problem };
    if (draftValue(d, pairDraftKey(item.id, "first")) !== null) answered++;
  }
  return answered > 0 ? null : { problem: "empty" };
}

/** The answer string for `d`, or null when `pairDraftProblem` finds anything. */
export function encodePairs(d: PairDraft, s: PairSheet): PairString | null {
  if (pairDraftProblem(d, s)) return null;
  const points = s.answers.length;
  let out = "";
  for (const item of s.items) {
    const first = draftValue(d, pairDraftKey(item.id, "first"));
    const second = draftValue(d, pairDraftKey(item.id, "second"));
    out +=
      first === null || second === null
        ? SKIPPED
        : PAIR_ALPHABET[jointIndex(first, second, points)];
  }
  return out;
}

/**
 * A decrypted answer string as joint indexes (-1 for skipped), or null:
 * wrong length, a character outside the joint range, a skipped required
 * item, or nothing answered.
 */
export function readPairString(plain: string, s: PairSheet): number[] | null {
  if (typeof plain !== "string" || plain.length !== s.items.length) return null;
  const width = s.answers.length * s.answers.length;
  const out: number[] = [];
  let answered = 0;
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i];
    if (c === SKIPPED) {
      if (s.items[i].optional !== true) return null;
      out.push(-1);
      continue;
    }
    const idx = PAIR_ALPHABET.indexOf(c);
    if (idx < 0 || idx >= width) return null;
    out.push(idx);
    answered++;
  }
  return answered > 0 ? out : null;
}

/** The exact ciphertext length of a ballot for `s`: one byte per item plus the 16-byte tag. */
export function pairCiphertextChars(s: PairSheet): number {
  return b64urlChars(s.items.length + 16);
}

// ── Readers ──────────────────────────────────────────────────────────

/** A sheet from the wire, or null. Accepts exactly what `toWirePairSheet` builds. */
function readPairSheet(raw: unknown): PairSheet | null {
  const s = obj(raw);
  if (!s || typeof s.id !== "string" || !ID_RE.test(s.id)) return null;
  if (!isCleanText(s.title, VOTE_LIMITS.maxTitleChars)) return null;
  const p = obj(s.prompts);
  if (!p || !isCleanText(p.first, VOTE_LIMITS.maxPairPromptChars)) return null;
  if (!isCleanText(p.second, VOTE_LIMITS.maxPairPromptChars)) return null;
  if (!Array.isArray(s.answers)) return null;
  if (
    s.answers.length < VOTE_LIMITS.minPairPoints ||
    s.answers.length > VOTE_LIMITS.maxPairPoints
  ) {
    return null;
  }
  const answers: string[] = [];
  for (const a of s.answers) {
    if (!isCleanText(a, VOTE_LIMITS.maxPointLabelChars) || answers.includes(a)) return null;
    answers.push(a);
  }
  if (!Array.isArray(s.items)) return null;
  if (s.items.length < 1 || s.items.length > VOTE_LIMITS.maxPairItems) return null;
  const ids = new Set<string>();
  const items: PairItem[] = [];
  for (const rawItem of s.items) {
    const x = obj(rawItem);
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || ids.has(x.id)) return null;
    if (!isCleanText(x.text, VOTE_LIMITS.maxQuestionChars)) return null;
    if (x.hint !== undefined && !isCleanText(x.hint, VOTE_LIMITS.maxHintChars)) return null;
    if (x.optional !== undefined && typeof x.optional !== "boolean") return null;
    ids.add(x.id);
    const item: PairItem = { id: x.id, text: x.text };
    if (typeof x.hint === "string") item.hint = x.hint;
    if (x.optional === true) item.optional = true;
    items.push(item);
  }
  return {
    id: s.id,
    title: s.title,
    prompts: { first: p.first, second: p.second },
    answers,
    items,
  };
}

function readRevealedPairs(
  raw: unknown,
  s: PairSheet,
  ballots: number,
  minN: number
): RevealedPair[] | null {
  if (!Array.isArray(raw) || raw.length !== s.items.length) return null;
  const width = s.answers.length * s.answers.length;
  const out: RevealedPair[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = obj(raw[i]);
    if (!r || !isCount(r.responses, ballots)) return null;
    // Every ballot answers every required item.
    if (s.items[i].optional !== true && r.responses !== ballots) return null;
    if (r.joint === null) {
      out.push({ responses: r.responses, joint: null });
      continue;
    }
    // A joint only from minN answers: a state that shows fewer is refused.
    if (r.responses < minN) return null;
    const j = r.joint;
    if (!Array.isArray(j) || j.length !== width) return null;
    let sum = 0;
    for (const n of j) {
      if (!isCount(n, ballots)) return null;
      sum += n;
    }
    if (sum !== r.responses) return null;
    out.push({ responses: r.responses, joint: j.slice() as number[] });
  }
  return out;
}

/**
 * A pair round's host state for this page's `tool`, or null. Checks shape,
 * caps and the reveal rules as `readVoteState` does for scale rounds; the
 * signature is the hook's call.
 */
export function readPairState(raw: unknown, tool: PairRoomTool): PairStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || !isPairRoomTool(tool) || !isPairRoomTool(m.tool)) return null;
  const head = readKindStateHead(m, tool, "pair");
  if (!head) return null;
  const sheet = readPairSheet(m.sheet);
  if (!sheet) return null;
  let revealed: RevealedPair[] | null = null;
  if (head.phase === "revealed") {
    revealed = readRevealedPairs(m.revealed, sheet, head.ballots, head.minN);
    if (!revealed) return null;
  }
  return {
    v: KIND_STATE_VERSION,
    kind: "pair",
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

/**
 * A pair round's counts: a scale `Tally` whose "points" are the P² joint
 * cells, so the scale fold, its checks and its reveal rule count pairs
 * unchanged. `counts[item][first × P + second]`.
 */
export type PairTally = Tally;

export function emptyPairTally(roundId: string, s: PairSheet): PairTally {
  const width = s.answers.length * s.answers.length;
  return {
    roundId,
    points: width,
    counts: s.items.map(() => new Array<number>(width).fill(0)),
    responses: s.items.map(() => 0),
    ballots: 0,
  };
}

/**
 * Count `by`'s pairs (joint indexes, -1 for skipped, as `readPairString`
 * returns them), with the scale fold's checks. Never mutates its inputs.
 */
export function foldPair(
  t: PairTally,
  ledger: BallotLedger,
  by: string,
  joints: readonly number[],
  ctx: FoldContext
): FoldResult {
  return foldBallot(t, ledger, by, joints, ctx);
}

/**
 * Add joint counts entered by a facilitator (paper answers):
 * `joints[item][first × P + second]`, `ballots` the people. Null on the
 * same rules as `foldCounts` (an item can't have more answers than people).
 */
export function foldPairCounts(
  t: PairTally,
  joints: readonly (readonly number[])[],
  ballots: number
): PairTally | null {
  return foldCounts(t, joints, ballots);
}

/** Whether the round has enough ballots to reveal. */
export function canRevealPairs(t: PairTally, minN: number): boolean {
  return t.ballots >= effectiveMinN(minN);
}

/** Every item's result: its joint only when it has at least minN answers. */
export function revealPairs(t: PairTally, minN: number): RevealedPair[] {
  return revealTally(t, minN).map((r) => ({ responses: r.responses, joint: r.distribution }));
}

// ── The saved result ─────────────────────────────────────────────────

/** A closed pair round as a tool saves it: joint totals only. No ids, no names, nothing per person. */
export interface PairRoundResult {
  kind: "pair";
  roundId: string;
  tool: PairRoomTool;
  sheetId: string;
  title: string;
  prompts: PairPrompts;
  /** The answers, in order: `joint[first × answers.length + second]`. */
  answers: string[];
  /** ISO timestamp of Reveal (or of the facilitator's entry). */
  closedAt: string;
  minN: number;
  ballots: number;
  /** "live": answered in a vote room; "facilitator": counts entered by hand. */
  source: "live" | "facilitator";
  items: {
    id: string;
    text: string;
    responses: number;
    /** People per answer pair; null when withheld (fewer than minN answers). */
    joint: number[] | null;
  }[];
}

/**
 * The result to hand a tool's `onSave`. Applies the minN rule again, so a
 * caller can't save a joint the room would have withheld.
 */
export function toPairResult(
  s: PairSheet,
  revealed: readonly RevealedPair[],
  meta: RoundResultMeta & { tool: PairRoomTool }
): PairRoundResult {
  const minN = effectiveMinN(meta.minN, meta.tool);
  const width = s.answers.length * s.answers.length;
  return {
    kind: "pair",
    roundId: meta.roundId,
    tool: meta.tool,
    sheetId: s.id,
    title: s.title,
    prompts: { first: s.prompts.first, second: s.prompts.second },
    answers: s.answers.slice(),
    closedAt: meta.closedAt,
    minN,
    ballots: meta.ballots,
    source: meta.source,
    items: s.items.map((item, i) => {
      const r = revealed[i];
      const responses = r?.responses ?? 0;
      const joint =
        r?.joint && r.joint.length === width && responses >= minN ? r.joint.slice() : null;
      return { id: item.id, text: item.text, responses, joint };
    }),
  };
}

// ── Reading a joint ──────────────────────────────────────────────────

/** People who gave `first` to the first question and `second` to the second. */
export function pairCount(
  joint: readonly number[],
  points: number,
  first: number,
  second: number
): number {
  return joint[jointIndex(first, second, points)] ?? 0;
}

/** Each question on its own: people per answer to the first, and to the second. */
export function pairMarginals(
  joint: readonly number[],
  points: number
): { first: number[]; second: number[] } {
  const first = new Array<number>(points).fill(0);
  const second = new Array<number>(points).fill(0);
  for (let f = 0; f < points; f++) {
    for (let g = 0; g < points; g++) {
      const n = pairCount(joint, points, f, g);
      first[f] += n;
      second[g] += n;
    }
  }
  return { first, second };
}

/** The most common answer pairs (several on a tie), or [] with no answers. */
export function commonPairs(
  joint: readonly number[],
  points: number
): { first: number; second: number; count: number }[] {
  const top = Math.max(0, ...joint);
  if (top === 0) return [];
  const out: { first: number; second: number; count: number }[] = [];
  for (let f = 0; f < points; f++) {
    for (let g = 0; g < points; g++) {
      if (pairCount(joint, points, f, g) === top) out.push({ first: f, second: g, count: top });
    }
  }
  return out;
}

/** The round as Markdown: one answer-pair table per item, withheld items said plainly. */
export function pairRoundMarkdown(r: PairRoundResult): string {
  const how = r.source === "live" ? "answered anonymously in a live round" : "entered by hand";
  const labels = r.answers.map(mdCell);
  const points = r.answers.length;
  const lines = [
    `# ${mdCell(r.title)}`,
    "",
    `${r.ballots} ${r.ballots === 1 ? "person" : "people"} ${how}, ${r.closedAt.slice(0, 10)}. ` +
      `An item shows its results from ${r.minN} answers.`,
    "",
    `Rows: ${mdCell(r.prompts.first)} Columns: ${mdCell(r.prompts.second)}`,
  ];
  r.items.forEach((item, i) => {
    lines.push("", `## ${i + 1}. ${mdCell(item.text)}`, "");
    if (!item.joint) {
      lines.push(
        `Withheld: ${item.responses} ${item.responses === 1 ? "answer" : "answers"}, fewer than ${r.minN}.`
      );
      return;
    }
    lines.push(
      `${item.responses} ${item.responses === 1 ? "answer" : "answers"}.`,
      "",
      `| | ${labels.join(" | ")} |`,
      `| --- | ${labels.map(() => "---:").join(" | ")} |`
    );
    for (let f = 0; f < points; f++) {
      const row = labels.map((_, g) => String(pairCount(item.joint!, points, f, g)));
      lines.push(`| ${labels[f]} | ${row.join(" | ")} |`);
    }
  });
  return `${lines.join("\n")}\n`;
}
