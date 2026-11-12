"use client";

import { useId, useState } from "react";
import { ClipboardList, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { PeoplePicker } from "@/components/team/person-picker";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { MIXER_LIMITS, nameKey } from "@/lib/team-mixer/model";
import { parseNames } from "@/lib/team-mixer/ops";
import type { MixerPersonRow } from "@/lib/team-mixer/state";
import { findRosterMember } from "@/lib/team/names";

export interface PeopleCardProps {
  people: readonly MixerPersonRow[];
  roster: readonly TeamMember[];
  onAdd: (names: string[]) => void;
  onRemove: (person: MixerPersonRow) => void;
  onClear: () => void;
  onLoadExample: () => void;
  /** A line after an add (how many came in, or that the list is full). */
  notice: string | null;
}

/**
 * Who is in the mix: names from the Team page (they bring their role and
 * skills), typed one by one, or pasted as a list. Removing someone has
 * Undo; nobody is ever added to the Team page from here.
 */
export function PeopleCard({
  people,
  roster,
  onAdd,
  onRemove,
  onClear,
  onLoadExample,
  notice,
}: PeopleCardProps) {
  const pasteId = useId();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const names = people.map((p) => p.name);
  const withTraits = people.filter((p) => {
    const m = findRosterMember(roster, p.name);
    return Boolean(m?.role?.trim() || m?.skills?.some((s) => s.trim()));
  }).length;

  const onPickerChange = (next: string[]) => {
    const keep = new Set(next.map(nameKey));
    const have = new Set(names.map(nameKey));
    const removed = people.filter((p) => !keep.has(nameKey(p.name)));
    const added = next.filter((n) => !have.has(nameKey(n)));
    removed.forEach(onRemove);
    if (added.length > 0) onAdd(added);
  };

  return (
    <SectionCard
      title={`Who's mixing (${people.length})`}
      icon={Users}
      actions={
        people.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear the list
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {people.length === 0 && (
          <EmptyState
            icon={Users}
            padding="md"
            action={<LoadExampleButton onLoad={onLoadExample} />}
          >
            Nobody in the mix yet. Add your team from the Team page, type names, or paste a list.
          </EmptyState>
        )}
        <PeoplePicker
          label="People in the mix"
          values={names}
          onChange={onPickerChange}
          offerEveryone
          offerAddToRoster={false}
          hint={`Up to ${MIXER_LIMITS.people} people. Removing someone keeps the earlier rounds.`}
        />
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-expanded={pasteOpen}
            aria-controls={pasteId}
            onClick={() => setPasteOpen((o) => !o)}
          >
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            {pasteOpen ? "Hide the paste box" : "Paste a list of names"}
          </Button>
          {pasteOpen && (
            <div id={pasteId} className="space-y-2">
              <label htmlFor={`${pasteId}-text`} className="text-sm text-text">
                Names, one per line or separated by commas
              </label>
              <Textarea
                id={`${pasteId}-text`}
                rows={4}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={parseNames(paste).length === 0}
                onClick={() => {
                  onAdd(parseNames(paste));
                  setPaste("");
                }}
              >
                Add these names
              </Button>
            </div>
          )}
        </div>
        {notice && (
          <p role="status" className="text-sm text-text">
            {notice}
          </p>
        )}
        {people.length > 0 && (
          <p className="text-xs text-sub">
            {withTraits === 0
              ? "Nobody here has a role or skills on the Team page, so groups can't be balanced yet."
              : `${withTraits} of ${people.length} have a role or skills on the Team page, for balancing.`}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
