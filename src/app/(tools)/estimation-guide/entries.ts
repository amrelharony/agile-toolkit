/**
 * Estimation Guide — per-scale keys for descriptions and examples.
 *
 * Entries used to be keyed by the bare value ("8"), so editing 8 under
 * Fibonacci also changed 8 under Powers of 2 and Linear. They're now keyed by
 * scale and value ("Fibonacci:8"). Stored data, share links and cloud
 * snapshots from before the change still use bare keys: `migrateDescriptions`
 * and `migrateExamples` copy each bare entry into every scale that has that
 * value, so nothing is lost, and `readEntry` falls back to a bare key that
 * arrives later (say, from a device still on the old version).
 */

import { scales, defaultDescriptions, type EstimationScale } from "@/lib/constants/scales";

type Entries = Record<string, string>;

/** Storage key for one value on one scale, e.g. "Fibonacci:8". */
export function entryKey(scale: string, value: string | number): string {
  return `${scale}:${value}`;
}

/** The built-in description for a value, or "" if there isn't one. */
export function defaultDescription(value: string | number): string {
  return defaultDescriptions[String(value)] ?? "";
}

/** Default descriptions for every value of every scale, keyed per scale. */
export function defaultScaleDescriptions(): Entries {
  const out: Entries = {};
  for (const scale of scales) {
    for (const v of scale.values) {
      const d = defaultDescription(v);
      if (d) out[entryKey(scale.name, v)] = d;
    }
  }
  return out;
}

/**
 * Re-key a stored map. Each bare key that is a value on some scale is copied
 * to every scale with that value (an existing per-scale entry wins) and then
 * dropped. Keys that are already per scale, or match no value, are kept.
 */
function rekey(map: unknown): Entries {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const src = map as Record<string, unknown>;
  const out: Entries = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== "string") continue;
    const owners = k.includes(":")
      ? []
      : scales.filter((s) => s.values.some((val) => String(val) === k));
    if (owners.length === 0) {
      out[k] = v;
      continue;
    }
    for (const s of owners) {
      const key = entryKey(s.name, k);
      if (typeof src[key] !== "string") out[key] = v;
    }
  }
  return out;
}

/** Stored descriptions, re-keyed per scale, with defaults for any value missing one. */
export function migrateDescriptions(map: unknown): Entries {
  return { ...defaultScaleDescriptions(), ...rekey(map) };
}

/** Stored examples, re-keyed per scale. */
export function migrateExamples(map: unknown): Entries {
  return rekey(map);
}

/** True when `migrated` holds exactly the same entries as `map`. */
export function sameEntries(map: Entries, migrated: Entries): boolean {
  const a = Object.keys(map);
  return a.length === Object.keys(migrated).length && a.every((k) => migrated[k] === map[k]);
}

/**
 * One entry for one value on one scale: the per-scale entry, else a bare
 * legacy entry, else `fallback`. An entry the user cleared ("") stays empty.
 */
export function readEntry(
  map: Entries,
  scale: string,
  value: string | number,
  fallback = ""
): string {
  return map[entryKey(scale, value)] ?? map[String(value)] ?? fallback;
}

/** Every value of the scale, keyed by bare value, for the AI prompts. */
export function entriesForScale(
  map: Entries,
  scale: EstimationScale,
  withDefaults: boolean
): Entries {
  const out: Entries = {};
  for (const v of scale.values) {
    out[String(v)] = readEntry(map, scale.name, v, withDefaults ? defaultDescription(v) : "");
  }
  return out;
}
