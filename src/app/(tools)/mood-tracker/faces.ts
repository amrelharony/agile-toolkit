import { MOOD_LABELS, MOOD_SCORES, type MoodScore } from "@/lib/team/mood";

/**
 * The five faces in theme colours (classes, never hex): red for rough
 * through to green for great, neutral in the middle. `bg` fills a picked
 * face or a heatmap cell; `text` sits on it.
 */
export const FACES: readonly { score: MoodScore; label: string; bg: string; text: string }[] =
  MOOD_SCORES.map((score) => ({
    score,
    label: MOOD_LABELS[score],
    bg: {
      1: "bg-danger",
      2: "bg-warning",
      3: "bg-sub/60",
      4: "bg-success/60",
      5: "bg-success",
    }[score],
    text: score === 3 ? "text-text" : "text-bg",
  }));

export function faceOf(score: number | null | undefined) {
  return FACES.find((f) => f.score === score);
}
