/**
 * How close a revealed round is, measured in cards on the deck.
 *
 * The verdict used to subtract the values: 1 vs 3 was a spread of 2 and
 * read "Near consensus", while 13 vs 21, the next card up, was a spread of
 * 8 and read "Discussion needed". A T-shirt deck has no numbers, so it
 * never got a verdict at all. Counting card positions treats every deck
 * alike: the same card is consensus, neighbouring cards are near, anything
 * further apart needs a conversation.
 *
 * The "can't estimate" cards ("?", "∞" for too big, a coffee break) say
 * something, but not a size: they stay out of the positions and are
 * counted on their own.
 */

/** Cards that aren't a size. Compared case-insensitively. */
const NON_ESTIMATE = new Set(["?", "∞", "☕", "☕️", "coffee"]);

export function isEstimateCard(card: string): boolean {
  const c = card.trim();
  return c !== "" && !NON_ESTIMATE.has(c.toLowerCase());
}

/** The deck's estimate cards in deck order, each once: the order positions are counted in. */
export function estimateCards(deck: readonly string[]): string[] {
  return Array.from(new Set(deck.filter(isEstimateCard)));
}

export type ConsensusLevel = "agree" | "close" | "spread";

export interface Consensus {
  /** Null when nobody played an estimate card (every vote was "?" or ∞). */
  level: ConsensusLevel | null;
  /** Votes that are a card on the deck's estimate cards. */
  estimates: number;
  /** Votes that aren't: "?", "∞", coffee, or a value not on this deck. */
  abstained: number;
  /** Lowest and highest estimate played, by deck position. */
  low: string | null;
  high: string | null;
  /** Deck positions between `low` and `high`: 0 is the same card. */
  apart: number | null;
  /**
   * The card to accept by default: the middle of the votes by deck
   * position. With an even split it's the higher of the two middle cards,
   * since an estimate is more often too small than too big; between two
   * cards that aren't neighbours it can be a card nobody played (3 and 8
   * suggest 5).
   */
  suggested: string | null;
}

const NONE: Consensus = {
  level: null,
  estimates: 0,
  abstained: 0,
  low: null,
  high: null,
  apart: null,
  suggested: null,
};

/** The round's agreement, counted in positions on `deck`. */
export function consensusOf(votes: readonly string[], deck: readonly string[]): Consensus {
  const cards = estimateCards(deck);
  const positions: number[] = [];
  let abstained = 0;
  for (const v of votes) {
    const at = isEstimateCard(v) ? cards.indexOf(v.trim()) : -1;
    if (at === -1) abstained++;
    else positions.push(at);
  }
  if (positions.length === 0) return { ...NONE, abstained };

  positions.sort((a, b) => a - b);
  const lo = positions[0];
  const hi = positions[positions.length - 1];
  const apart = hi - lo;
  const mid = (positions.length - 1) / 2;
  const middle = Math.ceil((positions[Math.floor(mid)] + positions[Math.ceil(mid)]) / 2);
  return {
    level: apart === 0 ? "agree" : apart === 1 ? "close" : "spread",
    estimates: positions.length,
    abstained,
    low: cards[lo],
    high: cards[hi],
    apart,
    suggested: cards[middle],
  };
}

export const CONSENSUS_LABELS: Record<ConsensusLevel, string> = {
  agree: "Full consensus",
  close: "Near consensus",
  spread: "Discussion needed",
};

const cardsApart = (n: number) => (n === 1 ? "one card" : `${n} cards`);

/** "1 person" / "2 people", for the non-estimate cards. */
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/**
 * One sentence on what to do with the round, under the consensus label.
 * A "?" alongside agreement is worth a word: someone may not be on board.
 */
export function consensusVerdict(c: Consensus): string {
  const unsure =
    c.abstained > 0 ? ` ${people(c.abstained)} couldn't estimate: ask what's unclear.` : "";
  if (c.level === null) {
    return c.abstained > 0
      ? "Nobody could estimate this one: talk through what's unclear, or split the story."
      : "No votes yet.";
  }
  if (c.level === "agree") {
    return c.estimates === 1
      ? `Only one estimate: ${c.low}.${unsure}`
      : c.abstained > 0
        ? `Everyone who estimated played ${c.low}.${unsure}`
        : `Everyone played ${c.low}.`;
  }
  if (c.level === "close") {
    return `Neighbouring cards, ${c.low} and ${c.high}: settle on ${c.suggested} unless someone sees more.${unsure}`;
  }
  return `${cardsApart(c.apart ?? 0)} apart, ${c.low} to ${c.high}: hear from whoever played ${c.low} and ${c.high}, then vote again.${unsure}`;
}
