/**
 * SMART checks for a sprint goal's acceptance criteria. Heuristic: they
 * look for vague words, numbers and a time reference; "Relevant" is the
 * user's own tick.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AcceptanceCriterion {
  id: string;
  text: string;
  relevantChecked: boolean;
}

export interface SmartResult {
  specific: boolean;
  measurable: boolean;
  achievable: boolean;
  relevant: boolean;
  timeBound: boolean;
}

// ─── SMART validation helpers ───────────────────────────────────────────────

const VAGUE_WORDS = [
  "improve",
  "better",
  "good",
  "nice",
  "fine",
  "some",
  "various",
  "stuff",
  "things",
  "enhance",
  "optimize",
  "miscellaneous",
];

const QUANTIFIABLE_PATTERNS =
  /\d+|percent|%|percentage|count|total|average|ratio|rate|score|increase by|decrease by|reduce by|at least|no more than|minimum|maximum/i;

const TIME_PATTERNS =
  /by end of sprint|by sprint end|deadline|before|after|within \d|by \w+day|by \d{1,2}\/|by \d{4}|end of day|EOD|end of week|EOW|by close|due date|sprint \d|week \d|day \d|hours?|days?|date/i;

export function validateSmart(criterion: AcceptanceCriterion): SmartResult {
  const text = criterion.text.trim();
  const words = text.toLowerCase().split(/\s+/);

  // Match by stem so "improving" / "optimization" / "enhanced" still trip
  // the vague-word detector. Strip simple verb/noun suffixes before testing.
  const stem = (w: string) => w.replace(/(?:ing|ed|es|s|ation|ment|ly)$/, "");
  // BUG-T8-sprint-goal-1: the prior `s === vague || s.startsWith(vague)`
  // never matched plural VAGUE_WORDS entries like "things" or "various"
  // because the word's plural-s gets stripped to "thing"/"variou", which
  // neither equals "things" nor starts with it. Compare with the
  // ALSO-stemmed vague word too, so plural list entries fire.
  // A vague verb ending in "e" loses it before a suffix ("improve" →
  // "improving" → stem "improv"), so also match on the root without that
  // "e". Only for roots of five letters or more: "fine" → "fin" would flag
  // "finish" and "final".
  const hasVague = words.some((w) => {
    const s = stem(w);
    return VAGUE_WORDS.some((vague) => {
      const v = stem(vague);
      const root = v.replace(/e$/, "");
      return s === vague || s === v || s.startsWith(v) || (root.length >= 5 && s.startsWith(root));
    });
  });
  const hasConcreteNoun = text.length > 10 && !hasVague;

  const specific = hasConcreteNoun;
  const measurable = QUANTIFIABLE_PATTERNS.test(text);
  const achievable = text.length >= 20 && text.length <= 300;
  const relevant = criterion.relevantChecked;
  const timeBound = TIME_PATTERNS.test(text);

  return { specific, measurable, achievable, relevant, timeBound };
}
