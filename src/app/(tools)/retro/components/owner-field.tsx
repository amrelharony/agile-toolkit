"use client";

/**
 * An action item's owner, picked from the team roster (PersonPicker).
 *
 * The old assignee box wrote to the synced board on every keystroke, so
 * "S", "Sa", "Sam" each went to every open tab, and no assignment was ever
 * logged. Here the name is a draft until the field is left or Enter is
 * pressed, then saved once (and logged); Escape puts the saved name back.
 * "Add to the team" inside the picker is a click, so it saves at once.
 */

import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { PersonPicker } from "@/components/team/person-picker";

export function OwnerField({
  value,
  onCommit,
  label = "Owner",
}: {
  /** The saved owner; "" for none. */
  value: string;
  /** Called once per change, with the trimmed name ("" clears it). */
  onCommit: (name: string) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const shown = draft ?? value;

  const commit = (name: string = shown) => {
    setDraft(null);
    const clean = name.trim();
    if (clean !== value.trim()) onCommit(clean);
  };

  const onBlur = (e: FocusEvent<HTMLFormElement>) => {
    // Moving to "Add to the team" inside the picker isn't leaving it.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (draft !== null) commit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape" && draft !== null) {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      commit();
    }
  };

  const onChange = (name: string) => {
    // Typing keeps a draft; a change made while the input isn't focused is
    // the picker's own "Add to the team", which saves straight away.
    const input = formRef.current?.querySelector("input");
    if (input && document.activeElement === input) setDraft(name);
    else commit(name);
  };

  return (
    // Enter and Escape are conveniences on top of leaving the field.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="min-w-0 flex-1 basis-40"
    >
      <PersonPicker
        label={label}
        hideLabel
        value={shown}
        onChange={onChange}
        placeholder="Who owns it?"
      />
    </form>
  );
}
