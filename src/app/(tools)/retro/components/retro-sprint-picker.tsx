"use client";

/**
 * "Retro for": which sprint a retro looks back on, on the format picker
 * (for the board about to start) and on the board itself. Always shown and
 * always changeable: a board's sprint decides which sprint's cockpit counts
 * it as held and which sprint the facts come from, so it's never set behind
 * the team's back. "Not linked" is a real choice too.
 */

import { useRef } from "react";
import Link from "next/link";
import { Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import type { Sprint } from "@/lib/stores/workspace-types";

export function RetroSprintPicker({
  sprints,
  sprintId,
  onChange,
  sprintGone = false,
  className,
}: {
  /** Every sprint, newest first. */
  sprints: Sprint[];
  sprintId: string | undefined;
  /** A sprint picked, or undefined for "Not linked". */
  onChange: (sprintId: string | undefined) => void;
  /** The board names a sprint that was deleted. */
  sprintGone?: boolean;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  if (sprints.length === 0) {
    return (
      <p className={`text-xs text-sub ${className ?? ""}`}>
        No sprints yet, so this retro isn&apos;t linked to one.{" "}
        <Link href="/sprint" className="text-accent underline-offset-2 hover:underline">
          Plan sprints in the Sprint Cockpit
        </Link>
      </p>
    );
  }
  const selected = sprintId && sprints.some((s) => s.id === sprintId) ? sprintId : undefined;
  return (
    <div ref={boxRef} className={`flex flex-wrap items-end gap-x-3 gap-y-1 ${className ?? ""}`}>
      {/* "" (not undefined) clears the select back to its placeholder, so it
          never remounts and a pick keeps focus on it. */}
      <SprintPicker
        sprints={sprints}
        selectedId={selected ?? ""}
        onSelect={(id) => onChange(id)}
        label="Retro for"
        allowCreate={false}
      />
      {selected ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // Unlink goes away with the link: focus moves to the select first.
            boxRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
            onChange(undefined);
          }}
          className="min-touch-coarse h-9 gap-1 text-xs text-sub hover:text-accent"
        >
          <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
          Unlink
        </Button>
      ) : (
        <p className="pb-2 text-xs text-sub">
          {sprintGone
            ? "Its sprint was deleted: pick another, or leave it unlinked."
            : "Not linked to a sprint."}
        </p>
      )}
    </div>
  );
}
