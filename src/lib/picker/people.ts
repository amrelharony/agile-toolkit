/**
 * The people a facilitation tool picks from: the team roster, or a list
 * someone typed or pasted. Picker spins them; Team Mixer mixes the same
 * people into groups, so both read them the same way here.
 *
 * Names are matched the way every tool matches the roster (`nameKey`:
 * trimmed, case-insensitive), so "sam" and "Sam " are one person. Pure and
 * server-safe.
 */

import { nameKey } from "@/lib/team/names";
import { pastedLines } from "@/lib/utils/paste-lines";

/** Most people one wheel, list or mix takes. */
export const PEOPLE_MAX = 40;
/** Longest name kept. */
export const PERSON_NAME_MAX = 40;

/** One line, trimmed, inner runs of spaces made one, cut to `max`. */
function line(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
}

/**
 * Names from the team roster: trimmed, each once (by name key), in roster
 * order, at most `cap`.
 */
export function rosterNames(
  roster: readonly { name: string }[] | null | undefined,
  cap: number = PEOPLE_MAX
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of roster ?? []) {
    const name = line(m?.name, PERSON_NAME_MAX);
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

export interface ParsedNames {
  /** Clean names, each once, in the order typed, at most `cap`. */
  names: string[];
  /** Lines that repeated a name already in the list. */
  repeats: number;
  /** Names left out because of the cap. */
  dropped: number;
  /** Names cut to the length cap. */
  cut: number;
}

/**
 * A typed or pasted list: one name per line, or comma-separated on one line;
 * list markers ("- ", "1. ") dropped, repeats skipped, each name cut to 40
 * characters, at most `cap` names.
 */
export function parseNames(text: string, cap: number = PEOPLE_MAX): ParsedNames {
  const raw = pastedLines(text, 1000).lines;
  const parts = raw.length === 1 && raw[0].includes(",") ? raw[0].split(",") : raw;
  const seen = new Set<string>();
  const names: string[] = [];
  let repeats = 0;
  let dropped = 0;
  let cut = 0;
  for (const part of parts) {
    const flat = line(part, Number.MAX_SAFE_INTEGER);
    if (!flat) continue;
    const name = line(flat, PERSON_NAME_MAX);
    const key = nameKey(name);
    if (seen.has(key)) {
      repeats += 1;
      continue;
    }
    if (names.length >= cap) {
      dropped += 1;
      continue;
    }
    if (name.length < flat.length) cut += 1;
    seen.add(key);
    names.push(name);
  }
  return { names, repeats, dropped, cut };
}
