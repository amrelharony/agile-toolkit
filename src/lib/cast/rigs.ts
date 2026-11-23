/**
 * The cast rigs for server pages. A page picks the rigs it shows and passes
 * each to <CastFigure> as a prop, so the manifests reach the browser only for
 * the figures on that page, and never as a client-side index of all of them.
 */

import "server-only";

import type { RigManifest } from "./rig-types";
import { RIGS } from "./rigs.generated";

let byName: Map<string, RigManifest> | null = null;

function index(): Map<string, RigManifest> {
  if (byName) return byName;
  byName = new Map();
  for (const [id, rig] of Object.entries(RIGS)) {
    byName.set(id, rig);
    byName.set(rig.name, rig);
  }
  return byName;
}

/** The rig of a colleague, by cast name or id; null while it isn't shipped. */
export function rigFor(name: string): RigManifest | null {
  return index().get(name) ?? null;
}

export interface RigsForOptions {
  /** At most this many rigs. */
  max: number;
  /** At most this many bytes, counted as the 2x atlases (the bigger download). */
  bytes: number;
}

/**
 * The rigs for `names`, in that order. Unknown and unshipped names are left
 * out, and so is a repeat. It stops at `max`, and before the rig that would
 * take the 2x atlases past `bytes`, so the first names are never dropped for
 * later ones.
 */
export function rigsFor(names: readonly string[], { max, bytes }: RigsForOptions): RigManifest[] {
  const out: RigManifest[] = [];
  let total = 0;
  for (const name of names) {
    if (out.length >= max) break;
    const rig = rigFor(name);
    if (!rig || out.includes(rig)) continue;
    if (total + rig.atlas.bytes2 > bytes) break;
    total += rig.atlas.bytes2;
    out.push(rig);
  }
  return out;
}
