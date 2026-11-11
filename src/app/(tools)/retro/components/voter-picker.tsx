"use client";

/**
 * Facilitator mode for the Vote phase. On one shared screen the facilitator
 * picks who the next vote belongs to ("Voting as"), and each person spends
 * their own budget (the board's "Votes each"). "Me (single voter)" is the
 * board's original single budget. Without a team roster the facilitator
 * types the names in.
 */

import Link from "@/components/motion/transition-link";
import { UserPlus } from "lucide-react";
import { useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import type { Validation } from "@/lib/utils/form";
import { votesCastBy } from "../helpers";

/** The "Me (single voter)" choice: no name, so votes count in `userVotes`. */
export const SINGLE_VOTER = "";

interface VoterDraft {
  name: string;
}

const EMPTY_VOTER: VoterDraft = { name: "" };

/** A voter typed in by hand: a name, trimmed. */
export function validateVoterName(draft: VoterDraft): Validation<string, "name"> {
  const name = draft.name.trim();
  return name ? { ok: true, values: name } : { ok: false, errors: { name: "Type a name first." } };
}

export function VoterPicker({
  names,
  votesBy,
  votesPerPerson,
  voter,
  onVoterChange,
  showAddVoter,
  onAddVoter,
}: {
  /** Everyone who can vote, roster first. */
  names: string[];
  votesBy?: Record<string, number>;
  /** Votes each person has (the board's "Votes each"). */
  votesPerPerson: number;
  /** The name voting now, or SINGLE_VOTER. */
  voter: string;
  onVoterChange: (voter: string) => void;
  /** Offer a field to type a voter in (when the team roster is empty). */
  showAddVoter: boolean;
  onAddVoter: (name: string) => void;
}) {
  // Draft-then-save: an empty Enter says what's missing instead of doing nothing.
  const form = useItemForm<VoterDraft, string, "name">({
    initial: EMPTY_VOTER,
    validate: validateVoterName,
    onSave: onAddVoter,
  });

  const options: ToggleOption<string>[] = [
    { value: SINGLE_VOTER, label: "Me (single voter)" },
    ...names.map((name) => {
      const left = Math.max(0, votesPerPerson - votesCastBy(votesBy, name));
      return { value: name, label: `${name} · ${left} left` };
    }),
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-text" aria-hidden="true">
          Voting as
        </span>
        <ToggleGroup
          label="Voting as"
          size="sm"
          options={options}
          value={voter}
          onValueChange={onVoterChange}
        />
      </div>
      <p className="text-xs text-sub">
        On a shared screen, pick a name before each vote. Everyone gets {votesPerPerson} votes.
      </p>
      {showAddVoter && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <form ref={form.formRef} onSubmit={form.submit} noValidate>
            {/* The button sits in the field's row, so an error shows under both. */}
            <Field label="Add a voter" error={form.errors.name}>
              {(props) => (
                <div className="flex items-center gap-1.5">
                  <Input
                    {...props}
                    value={form.draft.name}
                    onChange={(e) => form.update({ name: e.target.value })}
                    placeholder="Name"
                    autoComplete="off"
                    className="h-8 w-40 text-xs bg-cardH border-border text-text placeholder:text-sub"
                  />
                  {/* Never disabled: pressing it on an empty name is how the error shows. */}
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs border-border text-sub hover:border-accent-cyan/50 hover:text-accent"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" /> Add voter
                  </Button>
                </div>
              )}
            </Field>
          </form>
          <p className="text-xs text-sub">
            Or{" "}
            <Link href="/team" className="text-accent underline-offset-4 hover:underline">
              set up your team
            </Link>{" "}
            to list everyone here.
          </p>
        </div>
      )}
    </div>
  );
}
