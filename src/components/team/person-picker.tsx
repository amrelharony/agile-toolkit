"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  addToRoster,
  findRosterMember,
  nameKey,
  useTeamRoster,
  useWorkspaceHydrated,
} from "@/lib/team/use-team-roster";

/** The roster's names as <datalist> suggestions under one input. */
function RosterOptions({ id }: { id: string }) {
  const roster = useTeamRoster();
  return (
    <datalist id={id}>
      {roster.map((m) => (
        <option key={m.id} value={m.name} />
      ))}
    </datalist>
  );
}

/**
 * Under the input: a name that isn't on the team gets an explicit "Add to
 * the team"; an empty roster points at the Team page.
 */
function RosterNote({
  name,
  offerAdd,
  onAdded,
}: {
  name: string;
  offerAdd: boolean;
  onAdded: (name: string) => void;
}) {
  const roster = useTeamRoster();
  const hydrated = useWorkspaceHydrated();
  if (!hydrated) return null;
  const typed = name.trim();

  if (roster.length === 0 && !typed) {
    return (
      <p className="text-xs text-sub">
        Add your team on the{" "}
        <Link href="/team" className="text-accent underline-offset-2 hover:underline">
          Team page
        </Link>{" "}
        to pick names here.
      </p>
    );
  }
  if (!typed || findRosterMember(roster, typed)) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-sub">
      <span>“{typed}” isn’t on the team.</span>
      {offerAdd && (
        <button
          type="button"
          onClick={() => onAdded(addToRoster(typed).name)}
          className="min-touch-coarse inline-flex items-center gap-1 rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Add to the team
        </button>
      )}
    </p>
  );
}

export interface PersonPickerProps {
  label: ReactNode;
  /** The person's name; "" when nobody is picked. */
  value: string;
  onChange: (name: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  hideLabel?: boolean;
  placeholder?: string;
  /** Offer "Add to the team" for a name that isn't on the roster (default true). */
  offerAddToRoster?: boolean;
  className?: string;
}

/**
 * One person, picked from the workspace roster (the Team page).
 *
 * Owners, assignees and facilitators were free text in most tools, so the
 * same person was spelled three ways and nothing could be counted per
 * person. This suggests roster names as you type but still accepts any
 * name — and adding someone to the team is a separate, explicit click,
 * never a side effect of typing (Standup used to do that silently).
 */
export function PersonPicker({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  hideLabel,
  placeholder,
  offerAddToRoster = true,
  className,
}: PersonPickerProps) {
  const listId = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Field label={label} hint={hint} error={error} required={required} hideLabel={hideLabel}>
        {(props) => (
          <Input
            {...props}
            list={listId}
            autoComplete="off"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
      <RosterOptions id={listId} />
      <RosterNote name={value} offerAdd={offerAddToRoster} onAdded={onChange} />
    </div>
  );
}

export interface PeoplePickerProps {
  label: string;
  /** The picked names, in order. */
  values: readonly string[];
  onChange: (names: string[]) => void;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  /** Offer "Add everyone on the team" while someone on the roster is missing. */
  offerEveryone?: boolean;
  offerAddToRoster?: boolean;
  className?: string;
}

/**
 * Several people (approvers, consenting members, a hat-wearing group): chips
 * plus an input that adds on Enter or "Add". Names are de-duplicated
 * case-insensitively, and a roster name is stored with the roster's spelling.
 */
export function PeoplePicker({
  label,
  values,
  onChange,
  hint,
  error,
  placeholder = "Type a name",
  offerEveryone = false,
  offerAddToRoster = true,
  className,
}: PeoplePickerProps) {
  const roster = useTeamRoster();
  const listId = useId();
  const [typed, setTyped] = useState("");
  const picked = new Set(values.map(nameKey));

  const add = (name: string) => {
    const clean = (findRosterMember(roster, name)?.name ?? name).trim();
    if (!clean || picked.has(nameKey(clean))) {
      setTyped("");
      return;
    }
    onChange([...values, clean]);
    setTyped("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // Enter adds the name; it must not submit the surrounding form.
    e.preventDefault();
    add(typed);
  };

  const missing = roster.filter((m) => !picked.has(nameKey(m.name)));

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {values.map((name) => (
            <li
              key={nameKey(name)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-0.5 text-xs text-text"
            >
              {name}
              <IconButton
                label={`Remove ${name}`}
                tooltip={false}
                icon={<X className="h-3.5 w-3.5" />}
                className="h-6 w-6"
                onClick={() => onChange(values.filter((v) => nameKey(v) !== nameKey(name)))}
              />
            </li>
          ))}
        </ul>
      )}
      <Field label={label} hint={hint} error={error}>
        {(props) => (
          <div className="flex min-w-0 gap-2">
            <Input
              {...props}
              list={listId}
              autoComplete="off"
              placeholder={placeholder}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1"
              aria-label={`Add to ${label}`}
              onClick={() => add(typed)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        )}
      </Field>
      <datalist id={listId}>
        {missing.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>
      <RosterNote name={typed} offerAdd={offerAddToRoster} onAdded={add} />
      {offerEveryone && missing.length > 0 && values.length < roster.length && (
        <button
          type="button"
          onClick={() => onChange([...values, ...missing.map((m) => m.name)])}
          className="min-touch-coarse self-start rounded text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Add everyone on the team ({missing.length})
        </button>
      )}
    </div>
  );
}
