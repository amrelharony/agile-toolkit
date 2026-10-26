"use client";

/**
 * Draft-on-keystroke, commit-on-blur input and textarea variants.
 *
 * Use these in place of a bare `<Input>` / `<Textarea>` whose `onChange`
 * pushes into `usePersisted` (or any other persistent store) on every
 * keystroke. That pattern hits localStorage per character — visible
 * input lag on long lists, and a cross-tab sync storm when paired with
 * `useCloudPersisted`.
 *
 * Contract:
 *  - `value` is the committed value (parent state)
 *  - local `draft` mirrors the user's typing
 *  - `onCommit(next)` fires on blur (or Enter for single-line inputs)
 *  - external `value` changes re-sync the draft (so cross-tab updates
 *    aren't clobbered by a stale local draft)
 */

import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface BlurInputProps {
  value: string;
  onCommit: (next: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  id?: string;
  "aria-label"?: string;
  /** A note or error that explains the box (e.g. why a value was changed). */
  "aria-describedby"?: string;
  /** The on-screen keyboard, e.g. "numeric" for whole numbers. */
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  /** Bounds and step for a number box: hints for the browser, not a check of what's committed. */
  min?: number | string;
  max?: number | string;
  step?: number | string;
}

export function BlurInput(props: BlurInputProps) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <Input
      id={props.id}
      type={props.type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== props.value) props.onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && props.type !== "textarea") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={props.placeholder}
      className={props.className}
      maxLength={props.maxLength}
      inputMode={props.inputMode}
      min={props.min}
      max={props.max}
      step={props.step}
      aria-label={props["aria-label"]}
      aria-describedby={props["aria-describedby"]}
    />
  );
}

interface BlurTextareaProps {
  value: string;
  onCommit: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  id?: string;
  "aria-label"?: string;
}

export function BlurTextarea(props: BlurTextareaProps) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <Textarea
      id={props.id}
      rows={props.rows}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== props.value) props.onCommit(draft);
      }}
      placeholder={props.placeholder}
      className={props.className}
      maxLength={props.maxLength}
      aria-label={props["aria-label"]}
    />
  );
}
