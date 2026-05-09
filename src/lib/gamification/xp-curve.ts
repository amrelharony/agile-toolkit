import type { LevelInfo } from "./types";

export const MAX_LEVEL = 20;
export const LEVEL_CURVE_BASE = 100;
export const LEVEL_CURVE_EXP = 1.8;
export const PRESTIGE_MULTIPLIER = 0.2; // each prestige adds 20% to XP requirements

/**
 * Cumulative XP required to REACH level N (from 1 → N).  Level 1 is 0 XP.
 * Level 2 is 100 XP, level 20 is ~16k XP.  With prestige P the curve scales
 * by (1 + 0.2 * P).
 */
export function cumulativeXpForLevel(level: number, prestige = 0): number {
  if (level <= 1) return 0;
  const scale = 1 + prestige * PRESTIGE_MULTIPLIER;
  return Math.floor(LEVEL_CURVE_BASE * Math.pow(level - 1, LEVEL_CURVE_EXP) * scale);
}

/** XP needed to advance from level N → level N+1 (excluding prior levels). */
export function xpNeededForLevel(level: number, prestige = 0): number {
  if (level >= MAX_LEVEL) return 0;
  return cumulativeXpForLevel(level + 1, prestige) - cumulativeXpForLevel(level, prestige);
}

/**
 * Given total `xp` (within the current prestige run), compute the level and
 * progress info.  Caps at MAX_LEVEL.
 */
export function computeLevel(xp: number, prestige = 0): LevelInfo {
  let level = 1;
  while (level < MAX_LEVEL && xp >= cumulativeXpForLevel(level + 1, prestige)) {
    level++;
  }
  const currentLevelXp = cumulativeXpForLevel(level, prestige);
  const nextLevelXp = cumulativeXpForLevel(level + 1, prestige);
  const atMax = level >= MAX_LEVEL;
  const xpIntoLevel = xp - currentLevelXp;
  const xpNeeded = atMax ? 0 : nextLevelXp - currentLevelXp;
  const progress01 = atMax ? 1 : xpIntoLevel / Math.max(1, xpNeeded);
  return {
    level,
    currentLevelXp,
    nextLevelXp,
    progress01: Math.max(0, Math.min(1, progress01)),
    xpIntoLevel,
    xpNeededForLevel: xpNeeded,
    atMax,
  };
}

/** True if adding `amount` would cross a level threshold. */
export function awardingCrossesLevel(currentXp: number, amount: number, prestige = 0): boolean {
  const before = computeLevel(currentXp, prestige).level;
  const after = computeLevel(currentXp + amount, prestige).level;
  return after > before;
}
