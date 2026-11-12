/**
 * Recurring themes across past retros (Retro Actions): what keeps coming
 * up, retro after retro, and what came back after the action for it was
 * marked done.
 *
 * A theme is a word (stop words dropped, light stemming, as the board's
 * common words: retro/themes) that cards in three or more archived retros
 * use. Each card joins one theme at most, the one spread over the most
 * retros, so no card is counted twice. Amr can name the themes instead
 * (retro-actions.themes); his groups are read through the same rules (three
 * retros or more, cards from the boards only), and these keyword themes
 * are his fallback.
 *
 * A theme "came back after done" when one of its cards is an action marked
 * done and a card on the same theme sits on a retro archived after that
 * day. A carried-over copy of an action is the same action, not the theme
 * coming back, so copies are left out.
 *
 * Pure: the caller passes the boards.
 */

import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";
import { RETRO_ARCHIVE_LIMIT, pastRetros } from "@/app/(tools)/retro/archive";
import { cardWords, stem } from "@/app/(tools)/retro/themes";
import { isExampleId } from "@/lib/utils/example-id";

/** Retros a theme has to come up in. */
export const RECURRING_MIN_RETROS = 3;
/** Themes shown at most. */
export const RECURRING_THEMES_MAX = 10;
/** Cards Amr reads at most (the newest ones). */
export const THEME_CARDS_MAX = 400;
/** Characters of each card Amr reads. */
export const THEME_CARD_TEXT_MAX = 100;

/** A card as the theme finder reads it. */
export interface ThemeCard {
  id: string;
  /** Which retro it is on (a board id, or Amr's retro number). */
  retro: string;
  text: string;
}

export interface KeywordGroup {
  /** The word as the cards spell it most often. */
  name: string;
  cardIds: string[];
  /** The retros its cards are on, in the order given. */
  retros: string[];
}

/** The spelling used most; ties go to the shorter, then the alphabetically first. */
function displayForm(forms: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const f of forms) counts.set(f, (counts.get(f) ?? 0) + 1);
  return Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])
  )[0][0];
}

/**
 * Words that cards in `minRetros` or more retros share, most retros first
 * (then most cards, then alphabetically). Each card joins one theme at
 * most, so a word whose cards were all taken drops out. `retroOrder` gives
 * the retros' order for each theme's list (default: as the cards come).
 */
export function keywordRecurring(
  cards: readonly ThemeCard[],
  {
    minRetros = RECURRING_MIN_RETROS,
    max = RECURRING_THEMES_MAX,
  }: { minRetros?: number; max?: number } = {}
): KeywordGroup[] {
  const order = new Map<string, number>();
  const byStem = new Map<string, { cards: ThemeCard[]; forms: string[] }>();
  for (const card of cards) {
    if (!order.has(card.retro)) order.set(card.retro, order.size);
    const seen = new Set<string>();
    for (const word of cardWords(card.text)) {
      const s = stem(word);
      const entry = byStem.get(s) ?? { cards: [], forms: [] };
      entry.forms.push(word);
      if (!seen.has(s)) {
        entry.cards.push(card);
        seen.add(s);
      }
      byStem.set(s, entry);
    }
  }
  const taken = new Set<string>();
  const out: KeywordGroup[] = [];
  while (out.length < max) {
    let best: { stem: string; cards: ThemeCard[]; retros: number } | null = null;
    for (const [s, entry] of Array.from(byStem.entries())) {
      const free = entry.cards.filter((c) => !taken.has(c.id));
      const retros = new Set(free.map((c) => c.retro)).size;
      if (retros < minRetros) continue;
      const better =
        !best ||
        retros > best.retros ||
        (retros === best.retros &&
          (free.length > best.cards.length ||
            (free.length === best.cards.length && s < best.stem)));
      if (better) best = { stem: s, cards: free, retros };
    }
    if (!best) break;
    const chosen = best;
    for (const c of chosen.cards) taken.add(c.id);
    const retros = Array.from(new Set(chosen.cards.map((c) => c.retro))).sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
    );
    out.push({
      name: displayForm(byStem.get(chosen.stem)?.forms ?? [chosen.stem]),
      cardIds: chosen.cards.map((c) => c.id),
      retros,
    });
  }
  return out;
}

/* ── Across the boards ─────────────────────────────────────────────── */

/** A card on an archived retro, with where it sits. */
export interface ArchivedCard {
  card: RetroCard;
  board: RetroBoard;
}

/**
 * The past retros' cards a theme can come from, oldest retro first: the
 * team's own cards with text (example cards on a real board left out),
 * without carried-over copies. At most the latest RETRO_ARCHIVE_LIMIT retros.
 */
export function archivedCards(boards: readonly RetroBoard[]): ArchivedCard[] {
  const past = pastRetros(boards).slice(0, RETRO_ARCHIVE_LIMIT).reverse();
  const out: ArchivedCard[] = [];
  for (const board of past) {
    const example = isExampleId(board.id);
    for (const card of board.cards) {
      if (!card.text.trim() || card.carriedFrom) continue;
      if (!example && isExampleId(card.id)) continue;
      out.push({ card, board });
    }
  }
  return out;
}

export interface CameBack {
  /** The action that was marked done. */
  actionId: string;
  actionText: string;
  doneAt: string;
  /** The first retro the theme came up in after that. */
  boardId: string;
  archivedAt: string;
}

export interface RecurringTheme {
  name: string;
  /** Its cards, oldest retro first. */
  cardIds: string[];
  /** The retros it came up in, oldest first. */
  boardIds: string[];
  /** Came back after its action was marked done; null when it didn't. */
  cameBack: CameBack | null;
}

/**
 * Whether a theme came back after done: an action among its cards marked
 * done, and a card of the theme on a retro archived after that time.
 */
export function cameBackAfterDone(items: readonly ArchivedCard[]): CameBack | null {
  const done = items
    .filter(({ card }) => card.isActionItem && card.done && typeof card.doneAt === "string")
    .sort((a, b) => (a.card.doneAt ?? "").localeCompare(b.card.doneAt ?? ""));
  for (const { card } of done) {
    const at = card.doneAt as string;
    const later = items
      .filter(({ board }) => (board.archivedAt ?? "") > at)
      .sort((a, b) => (a.board.archivedAt ?? "").localeCompare(b.board.archivedAt ?? ""))[0];
    if (later) {
      return {
        actionId: card.id,
        actionText: card.text,
        doneAt: at,
        boardId: later.board.id,
        archivedAt: later.board.archivedAt ?? "",
      };
    }
  }
  return null;
}

/**
 * A group of card ids (keywords' or Amr's) read against the boards: only
 * cards the archives hold, each once, and only when they span
 * `minRetros` retros. Null otherwise.
 */
export function themeOf(
  name: string,
  cardIds: readonly string[],
  byId: ReadonlyMap<string, ArchivedCard>,
  minRetros: number = RECURRING_MIN_RETROS
): RecurringTheme | null {
  const items: ArchivedCard[] = [];
  const seen = new Set<string>();
  for (const id of cardIds) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    items.push(item);
  }
  items.sort((a, b) => (a.board.archivedAt ?? "").localeCompare(b.board.archivedAt ?? ""));
  const boardIds = Array.from(new Set(items.map((i) => i.board.id)));
  if (boardIds.length < minRetros) return null;
  return {
    name: name.trim(),
    cardIds: items.map((i) => i.card.id),
    boardIds,
    cameBack: cameBackAfterDone(items),
  };
}

/** The keyword themes across the archived retros, most retros first. */
export function recurringThemes(
  boards: readonly RetroBoard[],
  { max = RECURRING_THEMES_MAX }: { max?: number } = {}
): RecurringTheme[] {
  const cards = archivedCards(boards);
  const byId = new Map(cards.map((c) => [c.card.id, c]));
  return keywordRecurring(
    cards.map(({ card, board }) => ({ id: card.id, retro: board.id, text: card.text })),
    { max }
  ).flatMap((g) => {
    const t = themeOf(g.name, g.cardIds, byId);
    return t ? [t] : [];
  });
}

/** Archived retros, for "not enough retros yet" (below RECURRING_MIN_RETROS). */
export function archivedRetroCount(boards: readonly RetroBoard[]): number {
  return Math.min(pastRetros(boards).length, RETRO_ARCHIVE_LIMIT);
}

/* ── What Amr reads ────────────────────────────────────────────────── */

export interface ThemesInput {
  retros: { n: number; date: string }[];
  cards: { id: string; r: number; text: string }[];
}

/**
 * The archived cards as Amr's task takes them: each retro numbered from 1
 * (oldest) with its date, each card by a short id ("c1"…) with its retro's
 * number and its text cut to THEME_CARD_TEXT_MAX, the newest
 * THEME_CARDS_MAX cards that fit in THEMES_INPUT_BYTES. `ids` maps the
 * short ids back to the cards.
 */
export function themesInput(
  boards: readonly RetroBoard[],
  budget: number = THEMES_INPUT_BYTES
): {
  input: ThemesInput;
  ids: Map<string, string>;
} {
  const all = archivedCards(boards);
  // The newest cards first, while they fit the request: a team writing in a
  // script of two or three bytes a letter gets fewer cards, not a refusal.
  const cards: ArchivedCard[] = [];
  let bytes = 0;
  for (let i = all.length - 1; i >= 0 && cards.length < THEME_CARDS_MAX; i--) {
    const size = utf8Bytes(clip(all[i].card.text)) + CARD_OVERHEAD_BYTES;
    if (bytes + size > budget) break;
    bytes += size;
    cards.unshift(all[i]);
  }
  const numbers = new Map<string, number>();
  const retros: ThemesInput["retros"] = [];
  for (const { board } of cards) {
    if (numbers.has(board.id)) continue;
    numbers.set(board.id, retros.length + 1);
    retros.push({ n: retros.length + 1, date: (board.archivedAt ?? "").slice(0, 10) });
  }
  const ids = new Map<string, string>();
  const list = cards.map(({ card, board }, i) => {
    const short = `c${i + 1}`;
    ids.set(short, card.id);
    return { id: short, r: numbers.get(board.id) ?? 1, text: clip(card.text) };
  });
  return { input: { retros, cards: list }, ids };
}

/**
 * The cards' share of Amr's request, in bytes: under the visitor route's
 * 64 KB body cap with room for the retros' dates and the envelope.
 */
export const THEMES_INPUT_BYTES = 56_000;

/** What one card adds besides its text: `{"id":"c400","r":52,"text":""},`. */
const CARD_OVERHEAD_BYTES = 32;

/** One line of a card, cut to THEME_CARD_TEXT_MAX. */
function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > THEME_CARD_TEXT_MAX ? `${t.slice(0, THEME_CARD_TEXT_MAX - 1)}…` : t;
}

/** The text's UTF-8 size (JSON escapes aside, which plain card text rarely needs). */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Amr's themes read against the boards: short ids mapped back, unknown ones
 * dropped, and a theme kept only when its cards span three retros or more.
 */
export function themesFromAi(
  boards: readonly RetroBoard[],
  ids: ReadonlyMap<string, string>,
  themes: readonly { name: string; cardIds: readonly string[] }[]
): RecurringTheme[] {
  const byId = new Map(archivedCards(boards).map((c) => [c.card.id, c]));
  const used = new Set<string>();
  const out: RecurringTheme[] = [];
  for (const t of themes) {
    const real = t.cardIds
      .map((s) => ids.get(s))
      .filter((id): id is string => typeof id === "string" && !used.has(id));
    const theme = themeOf(t.name, real, byId);
    if (!theme || !theme.name) continue;
    for (const id of theme.cardIds) used.add(id);
    out.push(theme);
    if (out.length >= RECURRING_THEMES_MAX) break;
  }
  return out;
}
