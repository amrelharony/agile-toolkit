/**
 * Tapping Amr while he's in the middle of a scene joins in: instead of the usual
 * giggle he carries on with another scene of the same family. Tap him while he
 * bounces the ball and he kicks it; while he listens to music, he drums.
 *
 * Only his own scenes take part (the day's, the weather's and his games): a
 * tool's scenes each mean something that happened in the tool, so a tap must not
 * play "blocker cleared" after "blocker raised".
 *
 * Pure; the scene lists and the chance are passed in.
 */

import { OCCASION_SCENES, PLAY_SCENES, WEATHER_SCENES } from "@/lib/agent/mascot/context/moments";
import { pickFresh } from "@/lib/agent/mascot/brain/choose";

/** A scene's family: `ball.kick` belongs to `ball`. */
export function sceneFamily(name: string): string {
  return name.split(".")[0];
}

/** The scenes a tap may carry on with: his own, not a tool's. */
export const OWN_SCENES: readonly string[] = Array.from(
  new Set([
    ...PLAY_SCENES,
    ...Object.values(WEATHER_SCENES).flat(),
    ...Object.values(OCCASION_SCENES).flat(),
  ])
);

/**
 * The scene that follows a tap on him while `current` plays: another shipped
 * scene of its family, one he hasn't just played. Null when `current` isn't one
 * of his own scenes or has no other in its family.
 */
export function followUp(
  current: string,
  shipped: (scene: string) => boolean,
  recent: readonly string[] = [],
  random: () => number = Math.random,
  own: readonly string[] = OWN_SCENES
): string | null {
  if (!own.includes(current)) return null;
  const family = sceneFamily(current);
  const others = own.filter((s) => s !== current && sceneFamily(s) === family && shipped(s));
  return pickFresh(others, recent, random);
}

/** The scene a shot is playing, from the sprite's `data-amr-shot`, or null. */
export function sceneOfShot(shot: string | undefined | null): string | null {
  const prefix = "clip:scene:";
  return shot?.startsWith(prefix) ? shot.slice(prefix.length) : null;
}
