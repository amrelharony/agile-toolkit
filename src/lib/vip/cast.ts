/**
 * The shape of a cast card and how cards link up. Holds no bible text, so client
 * components can import it; the text itself stays in the server-only
 * cast.generated.ts and arrives as props.
 */

export interface CastHook {
  /** A name from the cast, or two joined by " or ". */
  with: string;
  collision: string;
  /** How they move on. Blank for the two newest colleagues. */
  advance: string;
}

export interface CastCard {
  id: string;
  name: string;
  human_want: string;
  strength: string;
  overused_strength: string;
  relationship_hooks: CastHook[];
}

/** The cards a hook points at. The canon offers a choice as "A or B", so that links to both. */
export function hookTargets<C extends Pick<CastCard, "name">>(
  hook: Pick<CastHook, "with">,
  cast: readonly C[]
): C[] {
  return hook.with.split(/\s+or\s+/).flatMap((name) => cast.find((c) => c.name === name) ?? []);
}

/** Cards whose name contains `query`, ignoring case and surrounding spaces. */
export function filterCast<C extends Pick<CastCard, "name">>(
  cast: readonly C[],
  query: string
): readonly C[] {
  const q = query.trim().toLowerCase();
  return q ? cast.filter((c) => c.name.toLowerCase().includes(q)) : cast;
}

/** The anchor of a card on the page. */
export function castAnchor(id: string): string {
  return `cast-${id.toLowerCase()}`;
}
