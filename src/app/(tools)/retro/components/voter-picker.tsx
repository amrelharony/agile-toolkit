"use client";

/**
 * Facilitator mode for the Vote phase. On one shared screen the facilitator
 * picks who the next vote belongs to ("Voting as"), and each person spends
 * their own MAX_VOTES. "Me (single voter)" is the board's original single
 * budget. Without a team roster the facilitator types the names in.
 */

import { useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { MAX_VOTES } from "../types";
import { votesCastBy } from "../helpers";

/** The "Me (single voter)" choice: no name, so votes count in `userVotes`. */
export const SINGLE_VOTER = "";

export function VoterPicker({
  names,
  votesBy,
  voter,
  onVoterChange,
  showAddVoter,
  onAddVoter,
}: {
  /** Everyone who can vote, roster first. */
  names: string[];
  votesBy?: Record<string, number>;
  /** The name voting now, or SINGLE_VOTER. */
  voter: string;
  onVoterChange: (voter: string) => void;
  /** Offer a field to type a voter in (when the team roster is empty). */
  showAddVoter: boolean;
  onAddVoter: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const options: ToggleOption<string>[] = [
    { value: SINGLE_VOTER, label: "Me (single voter)" },
    ...names.map((name) => {
      const left = Math.max(0, MAX_VOTES - votesCastBy(votesBy, name));
      return { value: name, label: `${name} · ${left} left` };
    }),
  ];

  function addVoter() {
    const name = draft.trim();
    if (!name) return;
    onAddVoter(name);
    setDraft("");
  }

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
        On a shared screen, pick a name before each vote. Everyone gets {MAX_VOTES} votes.
      </p>
      {showAddVoter && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addVoter();
            }}
            className="flex items-end gap-1.5"
          >
            <Field label="Add a voter">
              {(props) => (
                <Input
                  {...props}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Name"
                  autoComplete="off"
                  className="h-8 w-40 text-xs bg-cardH border-border text-text placeholder:text-sub"
                />
              )}
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!draft.trim()}
              className="h-8 px-3 text-xs border-border text-sub hover:border-accent-cyan/50 hover:text-accent"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" /> Add voter
            </Button>
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
