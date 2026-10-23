"use client";

/**
 * The reference stories on one card of the guide: done stories pinned as
 * "this is what an 8 looks like here", and done stories with that many
 * points to pin. The client wraps Unpin in an Undo toast.
 *
 * Pinning or unpinning removes the button that was pressed (a pinned story
 * leaves the suggestions; an unpinned one loses its row), so focus moves on
 * by hand instead of dropping to the page: to the new pin's Unpin button,
 * or to the next pin, else to the "Reference stories" label.
 */

import { useEffect, useId, useRef } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { Story } from "@/lib/stores/workspace-types";
import { pinDrift, type ReferenceStory } from "./references";

export function ReferenceStoriesField({
  value,
  pinned,
  suggestions,
  full,
  onPin,
  onUnpin,
}: {
  value: string;
  pinned: readonly ReferenceStory[];
  /** Done stories with this many points that aren't pinned yet. */
  suggestions: readonly Story[];
  /** The card holds as many pins as it takes. */
  full: boolean;
  onPin: (story: Story) => void;
  onUnpin: (story: ReferenceStory) => void;
}) {
  const labelId = useId();
  const unit = value === "1" ? "point" : "points";
  const offered = full ? [] : suggestions;

  const labelRef = useRef<HTMLParagraphElement>(null);
  const unpinRefs = useRef(new Map<string, HTMLButtonElement>());
  // Where focus goes once the pin or unpin has rendered: a pin's id, or
  // null for the label.
  const focusNext = useRef<{ id: string | null } | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    const target = next.id === null ? undefined : unpinRefs.current.get(next.id);
    (target ?? labelRef.current)?.focus();
  });

  const pin = (s: Story) => {
    focusNext.current = { id: s.id };
    onPin(s);
  };
  const unpin = (s: ReferenceStory, i: number) => {
    focusNext.current = { id: (pinned[i + 1] ?? pinned[i - 1])?.id ?? null };
    onUnpin(s);
  };

  return (
    <div className="space-y-1.5">
      <p
        id={labelId}
        ref={labelRef}
        tabIndex={-1}
        className="text-xs font-medium uppercase tracking-wider text-sub outline-none"
      >
        Reference stories
      </p>
      {pinned.length > 0 && (
        <ul aria-labelledby={labelId} className="space-y-1">
          {pinned.map((s, i) => {
            const drift = pinDrift(s, value);
            return (
              <li
                key={s.id}
                className="flex items-start gap-1 rounded-md border border-border bg-bg py-1 pl-2 pr-1 text-sm text-text"
              >
                <span className="min-w-0 flex-1 break-words py-1">
                  {s.title}
                  {s.example && <span className="ml-1 text-xs text-sub">(example)</span>}
                  {drift && <span className="ml-1 text-xs text-warning">({drift})</span>}
                </span>
                <IconButton
                  ref={(el) => {
                    if (el) unpinRefs.current.set(s.id, el);
                    else unpinRefs.current.delete(s.id);
                  }}
                  label={`Unpin ${s.title}`}
                  icon={<PinOff aria-hidden="true" />}
                  tooltip={false}
                  onClick={() => unpin(s, i)}
                  className="shrink-0 text-sub hover:text-text md:h-7 md:w-7"
                />
              </li>
            );
          })}
        </ul>
      )}
      {offered.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-sub">
            Done at {value} {unit}, pin one as the reference:
          </p>
          <ul className="flex flex-col gap-1">
            {offered.map((s) => (
              <li key={s.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => pin(s)}
                  aria-label={`Pin “${s.title}” as a reference for ${value}`}
                  className="h-auto w-full justify-start whitespace-normal py-1.5 text-left text-sub hover:text-text"
                >
                  <Pin aria-hidden="true" />
                  <span className="min-w-0 break-words">{s.title}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        pinned.length === 0 && (
          <p className="text-xs text-sub">No done {value}-point stories to pin yet.</p>
        )
      )}
    </div>
  );
}
