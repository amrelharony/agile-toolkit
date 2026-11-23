/**
 * Example Mapping's reads and writes on workspace.exampleMaps. The store
 * stamps nothing: the page stamps `createdAt` and `updatedAt` through the
 * model's write helpers. Every read goes through `readMap`, so a synced row
 * that holds anything is drawn as the CRUD would take it.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ExampleMap, Story } from "@/lib/stores/workspace-types";
import { readMap, readMaps, rowTooBig } from "@/lib/example-mapping/model";

const ws = () => useWorkspaceStore.getState();

export function currentMaps(): ExampleMap[] {
  return readMaps(ws().exampleMaps ?? []);
}

export function findMap(id: string): ExampleMap | null {
  const raw = (ws().exampleMaps ?? []).find((m) => m.id === id);
  return raw ? readMap(raw) : null;
}

export function saveMap(map: ExampleMap): ExampleMap {
  ws().upsertExampleMap(map);
  return map;
}

/**
 * Change a stored map; nothing happens when it is gone, `fn` returns null,
 * or the change would grow it past one synced row (as the CRUD refuses it:
 * an Undo restore or a link write on a map that grew since).
 */
export function patchMap(
  id: string,
  fn: (map: ExampleMap) => ExampleMap | null
): ExampleMap | null {
  const current = findMap(id);
  if (!current) return null;
  const next = fn(current);
  if (!next || rowTooBig(next, current)) return null;
  ws().upsertExampleMap(next);
  return next;
}

/** Remove a map; returns what was removed, for Undo. */
export function removeMap(id: string): ExampleMap | null {
  const current = findMap(id);
  if (!current) return null;
  ws().removeExampleMap(id);
  return current;
}

export function findStory(id: string | undefined): Story | undefined {
  return id ? (ws().stories ?? []).find((s) => s.id === id) : undefined;
}
