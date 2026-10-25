/**
 * Velocity's AI prompts: lib/ai-prompts/velocity's three, with their
 * summary statistics replaced by the page's own lines. That builder labels
 * the share it is given as "completed ≥ committed" (the page's number is
 * the graded share that met 90–110%) and prints a number that isn't known
 * yet as 0, so the block is rewritten here, from the tiles' numbers, until
 * the builder takes these lines itself.
 */

import { generateVelocityPrompts } from "@/lib/ai-prompts/velocity";
import type { PromptDefinition } from "@/lib/ai-prompts/types";
import { fmt } from "@/lib/sprints/hub-view";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface VelocityPromptStats {
  /** The shared velocity (the Velocity tile). */
  velocity: { average: number | null; count: number };
  /** The graded say/do (the "Met the commitment" tile): pct is the share that met it. */
  sayDo: { count: number; met: number; pct: number | null };
  /** Standard deviation of the finished sprints; null below MIN_SAMPLE.distribution. */
  spread: number | null;
  /** Mann-Kendall's direction, or why there's none. */
  trend: string;
}

/** The statistics in words: what isn't known yet says so, never 0. */
export function velocityStatsLines(stats: VelocityPromptStats): string[] {
  const { velocity, sayDo, spread, trend } = stats;
  return [
    velocity.average === null
      ? "Velocity: not known yet (no finished sprint)"
      : `Velocity: ${fmt(velocity.average)} pts/sprint (the last ${plural(velocity.count, "finished sprint")})`,
    sayDo.count === 0 || sayDo.pct === null
      ? "Met the commitment (90–110% of it): no finished sprint had a commitment"
      : `Met the commitment (90–110% of it): ${sayDo.met} of the last ${plural(sayDo.count, "sprint")} with a commitment (${sayDo.pct}%)`,
    spread === null
      ? "Standard deviation: not enough finished sprints yet"
      : `Standard deviation: ${fmt(spread)} pts`,
    `Trend direction: ${trend}`,
  ];
}

/** The builder's statistics block, between its two headings. */
const STATS_BLOCK = /## Summary Statistics\n\n[\s\S]*?\n\n## Questions/;

export function velocityPrompts(
  sprints: { name: string; committed: number; completed: number }[],
  stats: VelocityPromptStats
): PromptDefinition[] {
  const block = `## Summary Statistics\n\n${velocityStatsLines(stats).join("\n")}\n\n## Questions`;
  // The builder needs numbers; its block is replaced below, so these never show.
  const placeholders = {
    avgVelocity: stats.velocity.average ?? 0,
    predictability: stats.sayDo.pct ?? 0,
    sd: stats.spread ?? 0,
    trendDir: stats.trend,
  };
  return generateVelocityPrompts({ sprints, stats: placeholders }).map((p) => ({
    ...p,
    prompt: p.prompt.replace(STATS_BLOCK, () => block),
  }));
}
