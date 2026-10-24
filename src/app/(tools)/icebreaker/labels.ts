import type { IceBreaker } from "@/lib/constants/icebreakers";

/** Badge colours, theme tokens only, so they read in light and high-contrast themes too. */
export const ENERGY_COLORS: Record<IceBreaker["energyLevel"], string> = {
  low: "bg-accent-green/20 text-accent-green border-accent-green/30",
  medium: "bg-accent-amber/20 text-accent-amber border-accent-amber/30",
  high: "bg-status-red/20 text-status-red border-status-red/30",
};

export const CATEGORY_COLORS: Record<IceBreaker["category"], string> = {
  question: "bg-accent-cyan/20 text-accent border-accent-cyan/30",
  activity: "bg-accent-green/20 text-accent-green border-accent-green/30",
  game: "bg-accent-magenta/20 text-accent-magenta border-accent-magenta/30",
  creative: "bg-accent-amber/20 text-accent-amber border-accent-amber/30",
  // Was palette purple, which ignored the theme.
  agile: "bg-info/20 text-info border-info/30",
};

export const TIME_CHOICES: readonly (readonly [number | null, string])[] = [
  [null, "All"],
  [2, "Up to 2 min"],
  [5, "Up to 5 min"],
  [10, "Up to 10 min"],
  [15, "Up to 15 min"],
];

export const ENERGY_CHOICES: readonly (readonly [IceBreaker["energyLevel"] | null, string])[] = [
  [null, "All"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
];

export const CATEGORY_CHOICES: readonly (readonly [IceBreaker["category"] | null, string])[] = [
  [null, "All"],
  ["question", "Question"],
  ["activity", "Activity"],
  ["game", "Game"],
  ["creative", "Creative"],
  ["agile", "Agile"],
];
