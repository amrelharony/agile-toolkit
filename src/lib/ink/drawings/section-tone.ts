import type { InkTone } from "../types";

/** The wash colour each section's art (and its tool cards) carries. */
export const SECTION_TONE: Record<string, InkTone> = {
  plan: "accent2",
  run: "accent",
  retro: "accent3",
  delivery: "success",
  team: "plum",
  prioritize: "warning",
  outcomes: "accent",
  quality: "info",
  ai: "accent2",
  library: "moss",
  vip: "wood",
};
