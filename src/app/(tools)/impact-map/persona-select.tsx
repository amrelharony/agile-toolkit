"use client";

/**
 * Which persona an actor is, from the Persona Library (ws.personas): a
 * labelled native select, "No persona" first. Picking one on a blank actor
 * fills its name. A persona deleted since shows as nothing chosen; the
 * actor keeps its own text.
 */

import { useId } from "react";
import type { Persona } from "@/lib/stores/workspace-types";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** "Maya, shift worker". */
export const personaLabel = (p: Pick<Persona, "name" | "role">) =>
  [p.name.trim(), p.role.trim()].filter(Boolean).join(", ");

export function PersonaSelect({
  personas,
  value,
  onChange,
}: {
  personas: readonly Persona[];
  /** The persona id, or "" for none. */
  value: string;
  onChange: (personaId: string, persona: Persona | undefined) => void;
}) {
  const id = useId();
  const known = personas.some((p) => p.id === value);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-text">
        Persona
      </label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={known ? value : ""}
        aria-describedby={`${id}-hint`}
        onChange={(e) =>
          onChange(
            e.target.value,
            personas.find((p) => p.id === e.target.value)
          )
        }
      >
        <option value="">No persona</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {personaLabel(p)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="text-xs text-sub">
        {personas.length === 0
          ? "Optional. Personas you add in the Persona Library show here."
          : "Optional. Who this actor is, from the Persona Library."}
      </p>
    </div>
  );
}
