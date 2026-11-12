"use client";

import { useEffect, useId, useState } from "react";
import { Shuffle, SlidersHorizontal } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import {
  MIXER_LIMITS,
  type Balance,
  type MixMode,
  type OddPolicy,
  type Split,
} from "@/lib/team-mixer/model";
import type { MixerState } from "@/lib/team-mixer/state";
import { NativeSelect, WholeNumberField } from "./fields";

const MODES: ToggleOption<MixMode>[] = [
  { value: "groups", label: "Groups" },
  { value: "pairs", label: "Pairs", description: "Pair rotation or coffee chats" },
  { value: "cafe", label: "World Café", description: "Tables with hosts who stay" },
];
const SPLITS: ToggleOption<Split>[] = [
  { value: "size", label: "Group size" },
  { value: "count", label: "Number of groups" },
];
const ODDS: ToggleOption<OddPolicy>[] = [
  { value: "trio", label: "Make a group of 3" },
  { value: "sit-out", label: "One person sits out" },
];
const BALANCES: ToggleOption<Balance>[] = [
  { value: "none", label: "Just random" },
  { value: "role", label: "By role" },
  { value: "skill", label: "By skill" },
];

export interface SettingsCardProps {
  state: MixerState;
  onChange: (patch: Partial<MixerState>) => void;
  onMix: () => void;
  /** Why it can't mix now, in plain words. */
  problem: string | null;
  /** What the settings make, in one line. */
  preview: string | null;
}

/** The one line naming a toggle group, tied to it for screen readers. */
function GroupLabel({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="text-sm text-text">
      {children}
    </p>
  );
}

/**
 * What the groups are for. Typed freely and saved when the field is left
 * (or Enter is pressed), so the saved copy's tidying never eats a space
 * mid-word.
 */
function TitleField({ value, onCommit }: { value: string; onCommit: (title: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <Field
      label="What are the groups for? (optional)"
      hint="Shown with the groups, and on everyone's phone in a live room."
    >
      {(props) => (
        <Input
          {...props}
          value={text}
          maxLength={MIXER_LIMITS.title}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      )}
    </Field>
  );
}

/** How to mix: groups, pairs or a World Café, the sizes, the balance, and the Mix button. */
export function SettingsCard({ state, onChange, onMix, problem, preview }: SettingsCardProps) {
  const id = useId();
  const mixed = state.mode === "cafe" ? state.cafe !== null : state.rounds.length > 0;
  const label =
    state.mode === "cafe"
      ? mixed
        ? "Plan the café again"
        : "Plan the café"
      : mixed
        ? "Mix the next round"
        : state.mode === "pairs"
          ? "Mix pairs"
          : "Mix groups";
  const hostOptions = state.people.map((p) => p.name);

  return (
    <SectionCard title="How to mix" icon={SlidersHorizontal}>
      <div className="space-y-5">
        <div className="space-y-1.5">
          <GroupLabel id={`${id}-mode`}>Mix into</GroupLabel>
          <ToggleGroup
            label="Mix into"
            options={MODES}
            value={state.mode}
            onValueChange={(mode) => onChange({ mode })}
          />
        </div>

        {state.mode === "groups" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <GroupLabel id={`${id}-split`}>Split by</GroupLabel>
              <ToggleGroup
                label="Split by"
                options={SPLITS}
                value={state.split}
                onValueChange={(split) => onChange({ split })}
              />
            </div>
            {state.split === "size" ? (
              <WholeNumberField
                label="People in each group"
                value={state.size}
                min={2}
                max={MIXER_LIMITS.groupSize}
                onChange={(size) => onChange({ size })}
              />
            ) : (
              <WholeNumberField
                label="Number of groups"
                value={state.count}
                min={2}
                max={MIXER_LIMITS.groups}
                onChange={(count) => onChange({ count })}
              />
            )}
          </div>
        )}

        {state.mode === "pairs" && (
          <div className="space-y-1.5">
            <GroupLabel id={`${id}-odd`}>With an odd number of people</GroupLabel>
            <ToggleGroup
              label="With an odd number of people"
              options={ODDS}
              value={state.odd}
              onValueChange={(odd) => onChange({ odd })}
            />
            <p className="text-xs text-sub">
              Each round pairs people who haven&apos;t paired yet: everyone meets everyone before
              anyone pairs twice.
            </p>
          </div>
        )}

        {state.mode === "cafe" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <WholeNumberField
                label="Tables"
                value={state.tables}
                min={2}
                max={MIXER_LIMITS.tables}
                onChange={(tables) => onChange({ tables })}
              />
              <WholeNumberField
                label="Rounds"
                value={state.cafeRounds}
                min={1}
                max={MIXER_LIMITS.cafeRounds}
                onChange={(cafeRounds) => onChange({ cafeRounds })}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm text-text">Table hosts (they stay all session)</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: state.tables }, (_, t) => (
                  <Field key={t} label={`Table ${t + 1}`}>
                    {(props) => (
                      <NativeSelect
                        {...props}
                        value={state.hosts[t] ?? ""}
                        onChange={(e) => {
                          const hosts = Array.from(
                            { length: state.tables },
                            (_, i) => state.hosts[i] ?? ""
                          );
                          hosts[t] = e.target.value;
                          onChange({ hosts });
                        }}
                      >
                        <option value="">Pick at random</option>
                        {hostOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div className="space-y-1.5">
          <GroupLabel id={`${id}-balance`}>Balance</GroupLabel>
          <ToggleGroup
            label="Balance"
            options={BALANCES}
            value={state.balance}
            onValueChange={(balance) => onChange({ balance })}
          />
          <p className="text-xs text-sub">
            Spreads each role, or each skill, across the groups, from the Team page.
          </p>
        </div>

        <TitleField value={state.title} onCommit={(title) => onChange({ title })} />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="toolkit"
            className="gap-1.5"
            aria-disabled={problem ? true : undefined}
            aria-describedby={`${id}-preview`}
            onClick={onMix}
          >
            <Shuffle className="h-4 w-4" aria-hidden="true" />
            {label}
          </Button>
          <p
            id={`${id}-preview`}
            role="status"
            className="min-w-0 flex-1 basis-48 text-sm text-text"
          >
            {problem ?? preview ?? ""}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
