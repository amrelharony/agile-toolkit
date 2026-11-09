/**
 * One spot drawing per navigation section (lib/constants/sections.ts), shown in
 * the header of every tool in that section. Each is a few pen strokes on a
 * 96-unit square: lines a little wavy, corners that overshoot, one wash.
 * test/ink/drawings.test.ts checks every section has one and the size budget.
 *
 * One file per drawing: a page that shows a single one imports its file, so it
 * doesn't download the set (the drawings compute their paths when they load,
 * which keeps a bundler from dropping the unused ones).
 */
import { planArt } from "./plan";
import { runArt } from "./run";
import { retroArt } from "./retro";
import { deliveryArt } from "./delivery";
import { teamArt } from "./team";
import { prioritizeArt } from "./prioritize";
import { outcomesArt } from "./outcomes";
import { qualityArt } from "./quality";
import { aiArt } from "./ai";
import { libraryArt } from "./library";
import { vipArt } from "./vip";
import type { InkDrawing } from "../../types";

export { SECTION_TONE } from "../section-tone";

export const SECTION_ART: Record<string, InkDrawing> = {
  plan: planArt,
  run: runArt,
  retro: retroArt,
  delivery: deliveryArt,
  team: teamArt,
  prioritize: prioritizeArt,
  outcomes: outcomesArt,
  quality: qualityArt,
  ai: aiArt,
  library: libraryArt,
  vip: vipArt,
};
