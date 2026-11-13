"use client";

import { useId } from "react";
import { Plus, Shuffle as ShuffleIcon, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { PersonPicker } from "@/components/team/person-picker";
import { nameKey, useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import type { Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";
import { shortClock } from "./agenda";
import type { Participant, SpeakerPlan, SpeakerSlot } from "./speakers";

/** A name to add: required, and not already in the order (any case). */
export function validateSpeaker(
  draft: { name: string },
  speakers: readonly Participant[]
): Validation<string, "name"> {
  const name = draft.name.trim();
  if (!name) return { ok: false, errors: { name: "Enter a name." } };
  const taken = speakers.find((p) => nameKey(p.name) === nameKey(name));
  if (taken) return { ok: false, errors: { name: `“${taken.name}” is already in the list.` } };
  return { ok: true, values: name };
}

/**
 * What a speaker's row says about their turn in the round that's on. Before
 * the meeting starts nobody is speaking yet: everyone shows their share.
 */
function slotText(slot: SpeakerSlot, started: boolean): { text: string; over: boolean } {
  if (!started) return { text: `${shortClock(slot.shareSeconds)} each`, over: false };
  switch (slot.status) {
    case "done":
      return {
        text: `spoke ${shortClock(slot.spentSeconds)}`,
        over: slot.spentSeconds > slot.shareSeconds,
      };
    case "skipped":
      return { text: "skipped", over: false };
    case "current": {
      const left = slot.shareSeconds - slot.spentSeconds;
      return left < 0
        ? { text: `+${shortClock(-left)} over`, over: true }
        : { text: `${shortClock(left)} left`, over: false };
    }
    default:
      return { text: `${shortClock(slot.shareSeconds)} each`, over: false };
  }
}

export interface TurnsSwitch {
  /** "Speakers take turns" plus, in a longer agenda, the segment's name. */
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}

/**
 * The speaking order: who's in it, and during a round of turns who has
 * spoken, who's speaking, and each waiting speaker's share as it stands.
 * Names come from the team roster as suggestions; joining the team is a
 * separate, explicit "Add to the team".
 */
export interface ShuffleControl {
  /** How many speakers a shuffle would move (those still waiting in a round that's on). */
  movable: number;
  onShuffle: () => void;
}

export function SpeakersCard({
  speakers,
  plan,
  started,
  turns,
  locked,
  shuffle,
  onAdd,
  onRemove,
  onLoadTeam,
}: {
  speakers: readonly Participant[];
  /** The round in progress, when the segment on takes turns. */
  plan: SpeakerPlan | null;
  /** The meeting has started: until then nobody is the current speaker. */
  started: boolean;
  turns: TurnsSwitch | null;
  /** Removing is off while the timer runs: skip a speaker instead. */
  locked: boolean;
  /** Shuffle the speaking order (with Undo); absent hides it. */
  shuffle?: ShuffleControl;
  onAdd: (name: string) => void;
  onRemove: (speaker: Participant) => void;
  onLoadTeam: () => void;
}) {
  const roster = useTeamRoster();
  const workspaceReady = useWorkspaceHydrated();
  const switchId = useId();
  const lockedId = useId();
  const shuffleNoteId = useId();
  const canShuffle = Boolean(shuffle && shuffle.movable >= 2);
  const form = useItemForm<{ name: string }, string, "name">({
    initial: { name: "" },
    validate: (d) => validateSpeaker(d, speakers),
    onSave: (name) => onAdd(name),
  });
  const slots = new Map((plan?.slots ?? []).map((s) => [s.id, s]));

  return (
    <SectionCard
      title="Speakers"
      icon={Users}
      titleSize="sm"
      titleSuffix={speakers.length > 0 ? `(${speakers.length})` : undefined}
    >
      <div className="flex flex-col gap-4">
        {turns && (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={switchId} className="text-sm text-text">
              {turns.label}
            </Label>
            <Switch id={switchId} checked={turns.checked} onCheckedChange={turns.onChange} />
          </div>
        )}

        <ItemForm
          form={form}
          submitLabel="Add speaker"
          submitIcon={<Plus aria-hidden="true" />}
          footer={
            // With nobody on the team yet, the picker's own note points to
            // the Team page instead.
            !(workspaceReady && roster.length === 0) && (
              <Button
                type="button"
                variant="toolkit"
                onClick={onLoadTeam}
                disabled={roster.length === 0}
                className="gap-1.5"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Load team
              </Button>
            )
          }
        >
          <PersonPicker
            label="Speaker"
            value={form.draft.name}
            onChange={(name) => form.update({ name })}
            error={form.errors.name}
            placeholder="Name"
          />
        </ItemForm>

        {speakers.length > 0 ? (
          <ol className="flex flex-col gap-1" aria-label="Speaking order">
            {speakers.map((p, i) => {
              const slot = slots.get(p.id);
              const status = slot ? slotText(slot, started) : null;
              const isCurrent = started && slot?.status === "current";
              return (
                <li
                  key={p.id}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm",
                    isCurrent ? "bg-accent/10 text-accent" : "text-text",
                    slot?.status === "skipped" && "text-sub line-through decoration-sub/50"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-data text-xs text-sub">{i + 1}.</span>
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {status && (
                      <span
                        className={cn(
                          "font-data text-xs tabular-nums",
                          status.over ? "text-warning" : "text-sub"
                        )}
                      >
                        {status.text}
                      </span>
                    )}
                    <IconButton
                      label={`Remove ${p.name}`}
                      icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => onRemove(p)}
                      disabled={locked}
                      {...(locked ? { "aria-describedby": lockedId } : {})}
                      className="text-sub hover:text-danger"
                    />
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-1 text-center text-xs text-sub">
            Add the people who will speak, to give each a fair share of the round.
          </p>
        )}

        {locked && speakers.length > 0 && (
          <p id={lockedId} className="text-xs text-sub">
            {plan
              ? "Pause the timer to remove someone, or use Skip speaker."
              : "Pause the timer to remove someone."}
          </p>
        )}

        {plan?.overbooked && (
          <p className="text-xs text-warning">
            Everyone left gets the minimum half minute, so this round will run over.
          </p>
        )}

        {shuffle && speakers.length >= 2 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={shuffle.onShuffle}
              disabled={!canShuffle}
              {...(!canShuffle ? { "aria-describedby": shuffleNoteId } : {})}
            >
              <ShuffleIcon className="h-4 w-4" aria-hidden="true" />
              Shuffle order
            </Button>
            <span id={shuffleNoteId} className="text-xs text-sub">
              {canShuffle
                ? plan && started
                  ? "Only those still waiting move."
                  : "A random order, with Undo."
                : "Nobody else is waiting to speak."}
            </span>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
