import { MOOD_LABELS, MOOD_SCORES, type MoodScore } from "@/lib/team/mood";

/**
 * The five faces in theme colours (classes, never hex): red for rough
 * through to green for great, neutral in the middle. `bg` fills a picked
 * face or a heatmap cell; `text` sits on it. The two soft fills take the page's
 * own text at /40: a stronger wash turns mid-tone, where neither light nor dark
 * words clear AA in every mode (test/design/theme-contrast.test.ts).
 */
export const FACES: readonly { score: MoodScore; label: string; bg: string; text: string }[] =
  MOOD_SCORES.map((score) => ({
    score,
    label: MOOD_LABELS[score],
    bg: {
      1: "bg-danger",
      2: "bg-warning",
      3: "bg-sub/40",
      4: "bg-success/40",
      5: "bg-success",
    }[score],
    text: score === 3 || score === 4 ? "text-text" : "text-bg",
  }));

export function faceOf(score: number | null | undefined) {
  return FACES.find((f) => f.score === score);
}
