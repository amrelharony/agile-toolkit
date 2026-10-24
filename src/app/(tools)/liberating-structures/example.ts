import { exampleId } from "@/components/tool-frame/example-data";
import type { LsFavorite } from "@/lib/stores/workspace-types";
import type { CeremonyKind } from "@/lib/sprints/cadence";

/**
 * A retro built from three structures: Impromptu Networking to open,
 * 1-2-4-All to gather ideas from everyone, then 25/10 Crowd Sourcing to
 * pick the boldest. The favourites carry `example-` ids, so Clear example
 * removes exactly them, and the ceremony filter is set to Retro to show
 * what else fits.
 */
const FAVORITES: [key: string, structureId: string][] = [
  ["fav-1", "ls-impromptu"],
  ["fav-2", "ls-1-2-4-all"],
  ["fav-3", "ls-25-10"],
];

export const EXAMPLE_CEREMONY: CeremonyKind = "retro";

export function buildExample(now: Date = new Date()): {
  favorites: LsFavorite[];
  ceremony: CeremonyKind;
} {
  return {
    favorites: FAVORITES.map(([key, structureId], i) => ({
      id: exampleId(key),
      structureId,
      // A minute apart, in the order they run.
      ts: new Date(now.getTime() + i * 60_000).toISOString(),
    })),
    ceremony: EXAMPLE_CEREMONY,
  };
}
