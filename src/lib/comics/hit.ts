import { BOOK_EPISODE_COUNT } from "./entry";
import type { EntryHit } from "./entry-beacon";

const BUILDINGS = 10;

function inRange(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * What a counter request may say. An allowlist with no free text, so whatever
 * reaches the table is one of a fixed set of values and nothing about a person.
 */
export function parseHit(body: unknown): EntryHit | null {
  if (!body || typeof body !== "object") return null;
  const { entry, ep, b } = body as { entry?: unknown; ep?: unknown; b?: unknown };
  if (entry === "poster" && inRange(ep, BOOK_EPISODE_COUNT) && inRange(b, BUILDINGS)) {
    return { entry, ep, b };
  }
  if (entry === "direct" && ep === undefined && b === undefined) return { entry };
  return null;
}
