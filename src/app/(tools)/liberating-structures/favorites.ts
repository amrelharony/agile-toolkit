import { lsStructure, type LsStructure } from "@/lib/liberating-structures/catalog";
import type { LsFavorite } from "@/lib/stores/workspace-types";

/**
 * The favourites as the page shows them. The saved list can hold rows the
 * catalog doesn't know (the agent's toggle accepts any id) and the same
 * structure twice (two tabs, an agent and the page), so the count used to
 * run ahead of what the strip showed. Here each structure counts once, in
 * the order it was first saved.
 */
export function catalogFavorites(
  favorites: readonly (LsFavorite | null | undefined)[] | null | undefined
): { favorite: LsFavorite; structure: LsStructure }[] {
  const seen = new Set<string>();
  const out: { favorite: LsFavorite; structure: LsStructure }[] = [];
  for (const f of favorites ?? []) {
    const structure = lsStructure(f?.structureId);
    if (!f || !structure || seen.has(structure.id)) continue;
    seen.add(structure.id);
    out.push({ favorite: f, structure });
  }
  return out;
}

/** The list with `structureId` saved once more, unless it already is. */
export function withFavorite(favorites: readonly LsFavorite[], favorite: LsFavorite): LsFavorite[] {
  return favorites.some((f) => f?.structureId === favorite.structureId)
    ? [...favorites]
    : [...favorites, favorite];
}
