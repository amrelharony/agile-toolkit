/**
 * Lightweight lexicon sentiment for the mascot's mood, ported from the vanilla
 * mascot (Personal Website mascot-assistant.js analyzeSentiment).
 *
 * Pure + deterministic: valence shifts ±0.08 per positive/negative word, energy
 * (arousal) bumps for question marks, exclamation marks, and question words.
 * Output feeds useMascotStore.setMood, which maps {valence, energy} to a facial
 * expression + accent colour. No LLM call — cheap enough to run per reply.
 */

export interface Sentiment {
  /** negative ↔ positive (0..1) */
  valence: number;
  /** calm ↔ excited (0..1) */
  energy: number;
}

const POSITIVE_WORDS = new Set([
  "thanks",
  "great",
  "awesome",
  "love",
  "cool",
  "nice",
  "helpful",
  "amazing",
  "excellent",
  "perfect",
  "good",
  "appreciate",
  "wonderful",
  "fantastic",
  "brilliant",
]);

const NEGATIVE_WORDS = new Set([
  "bad",
  "wrong",
  "hate",
  "terrible",
  "confused",
  "broken",
  "error",
  "annoying",
  "frustrated",
  "disappointed",
  "awful",
  "problem",
  "fail",
  "stuck",
  "issue",
]);

const QUESTION_WORDS = ["how", "what", "why", "where", "when", "who"];

export function analyzeSentiment(text: string): Sentiment {
  if (!text) return { valence: 0.5, energy: 0.5 };
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/);

  let valence = 0.5;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) valence = Math.min(1, valence + 0.08);
    if (NEGATIVE_WORDS.has(w)) valence = Math.max(0, valence - 0.08);
  }

  let energy = 0.5;
  if (lower.includes("?")) energy = Math.min(1, energy + 0.05);
  if (lower.includes("!")) energy = Math.min(1, energy + 0.1);
  if (QUESTION_WORDS.some((q) => words.includes(q))) energy = Math.min(1, energy + 0.03);

  return { valence, energy };
}
