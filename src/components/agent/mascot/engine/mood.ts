/**
 * Sentiment mood: store.mood ({valence,energy}) maps to a named mood, which sets
 * Amr's playback speed and the ambient drone (eased in by the drone itself).
 */

import type { DroneParams } from "./audio/mascot-drone";

export type MoodName =
  | "serene"
  | "playful"
  | "intense"
  | "curious"
  | "determined"
  | "neutral"
  | "warm";

export const MOOD_SPEED: Record<MoodName, number> = {
  serene: 0.7,
  playful: 1.3,
  intense: 1.5,
  curious: 1.1,
  determined: 1.1,
  neutral: 1.0,
  warm: 1.0,
};

/** Ambient drone per mood (source MascotAmbience). neutral = silent. */
export const MOOD_DRONE: Record<MoodName, DroneParams | null> = {
  serene: { freq: 110, type: "sine", vol: 0.004, filter: 250 },
  playful: { freq: 247, type: "triangle", vol: 0.006, filter: 650 },
  intense: { freq: 262, type: "triangle", vol: 0.006, filter: 700 },
  curious: { freq: 185, type: "triangle", vol: 0.005, filter: 550 },
  determined: { freq: 196, type: "triangle", vol: 0.005, filter: 600 },
  neutral: null,
  warm: { freq: 165, type: "sine", vol: 0.005, filter: 400 },
};

/** Map a sentiment {valence,energy} (0..1 each) to a mood. */
export function moodFor(valence: number, energy: number): MoodName {
  if (valence >= 0.6) return energy >= 0.6 ? "playful" : "warm";
  if (valence <= 0.4) return energy >= 0.6 ? "intense" : "determined";
  return energy >= 0.6 ? "curious" : energy <= 0.35 ? "serene" : "neutral";
}
