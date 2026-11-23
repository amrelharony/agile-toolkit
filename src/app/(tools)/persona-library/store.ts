/**
 * The Persona Library's writes, on the one store its agent verbs and next
 * step read (workspace.personas). Each read is fresh, so an Undo that lands
 * after another write never puts back a stale copy. Store writes stamp
 * nothing: the page stamps createdAt and updatedAt, as the workspace CRUD
 * does for agents.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Persona } from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

/** Every stored persona, fresh (not a render's copy). */
export const currentPersonas = (): Persona[] => ws().personas ?? [];

/** One stored persona as it is now, or undefined when it is gone. */
export const findPersona = (id: string): Persona | undefined =>
  currentPersonas().find((p) => p.id === id);

/** Save a persona as given (Undo puts back exactly what it had). */
export function savePersona(persona: Persona): void {
  ws().upsertPersona(persona);
}

/** Remove a persona; returns what was removed (for Undo), or null when it was already gone. */
export function removePersona(id: string): Persona | null {
  const stored = findPersona(id);
  if (!stored) return null;
  ws().removePersona(id);
  return stored;
}
