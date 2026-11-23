"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  LIST_LABEL,
  LIST_ONE,
  PERSONA_POINTS_MAX,
  PERSONA_POINT_MAX,
  type PersonaList,
} from "@/lib/personas/model";

const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * One of a persona's lists in the form: its points, each with a Remove
 * button (the form offers Undo), and a line to add one. Enter in the line
 * adds the point instead of saving the form. Full at PERSONA_POINTS_MAX.
 */
export function PointsField({
  list,
  items,
  error,
  onAdd,
  onRemove,
}: {
  list: PersonaList;
  items: readonly string[];
  error?: string;
  /** Add a point; returns why it wasn't added, or null. */
  onAdd: (point: string) => string | null;
  onRemove: (index: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const one = LIST_ONE[list];
  const full = items.length >= PERSONA_POINTS_MAX;

  const add = () => {
    const point = text.replace(/\s+/g, " ").trim();
    if (!point) {
      setNote(`Type a ${one} first.`);
      return;
    }
    const why = onAdd(point);
    setNote(why);
    if (!why) setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add();
  };

  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={`${id}-hint`}>
      <legend className="text-sm text-text">{LIST_LABEL[list]}</legend>
      {items.length > 0 && (
        <ul className="space-y-1" aria-label={LIST_LABEL[list]}>
          {items.map((item, i) => (
            <li
              key={`${i}:${item}`}
              className="flex items-start gap-2 rounded-md border border-border bg-card px-2 py-1"
            >
              <span className="min-w-0 flex-1 break-words py-1.5 text-sm text-text">{item}</span>
              <IconButton
                label={`Remove ${one} “${short(item)}”`}
                icon={<X className="h-4 w-4" />}
                className="text-sub hover:text-danger"
                onClick={() => onRemove(i)}
              />
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p id={`${id}-hint`} className="text-xs text-sub">
          Full: {PERSONA_POINTS_MAX} is the most. Remove one to add another.
        </p>
      ) : (
        <>
          <div className="flex min-w-0 gap-2">
            <label htmlFor={`${id}-add`} className="sr-only">
              {`Add a ${one}`}
            </label>
            <Input
              id={`${id}-add`}
              value={text}
              maxLength={PERSONA_POINT_MAX}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              placeholder={`Add a ${one}`}
              onChange={(e) => {
                setText(e.target.value);
                setNote(null);
              }}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1"
              onClick={add}
              aria-label={`Add ${one}`}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>
          <p id={`${id}-hint`} className="text-xs text-sub">
            {note ?? `Up to ${PERSONA_POINTS_MAX}, each a short line.`}
          </p>
        </>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
