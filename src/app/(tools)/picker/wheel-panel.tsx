"use client";

/**
 * The wheel: what it spins (the team or a saved list), the spin itself, its
 * rules (everyone once, names that leave once picked), each name's weight,
 * and the names taken off. The spin and what it saves are the page's
 * (`onSpin`); this panel only shows them and edits the rules.
 */

import Link from "next/link";
import { Disc3, Minus, MonitorUp, Plus, RotateCcw, Undo2, Users } from "lucide-react";
import { PickerWheel, wheelLabel } from "@/components/picker/picker-wheel";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { nameKey } from "@/lib/team/names";
import {
  PICKER_LIMITS,
  TEAM_SOURCE,
  poolLabel,
  sourceLabel,
  type PickerEntry,
  type PickerState,
  type WheelView,
} from "@/lib/picker/model";
import { SPIN_BUTTON_ID, byId, focusSoon } from "./focus";
import type { WheelSpin } from "./use-wheel-spin";

const RESTART_ID = "picker-restart-round";
const PUT_BACK_ID = "picker-put-back";
const REMOVE_PICKED_ID = "picker-remove-picked";

export interface WheelPanelProps {
  state: PickerState;
  /** The source's names, removed ones included. */
  entries: readonly PickerEntry[];
  view: WheelView;
  spin: WheelSpin;
  /** The name the last spin landed on, while the wheel shows it. */
  result: string | null;
  /** A live room is open: offer "Spin for the room". */
  roomLive: boolean;
  /** The team hasn't loaded yet: hold the empty state back. */
  rosterReady: boolean;
  onSpin: (forRoom: boolean) => void;
  onSource: (source: string) => void;
  onRules: (patch: Partial<Pick<PickerState, "everyoneOnce" | "removePicked">>) => void;
  onWeight: (name: string, weight: number) => void;
  onPutBack: () => void;
  onRestartRound: () => void;
  canLoadExample: boolean;
  onLoadExample: () => void;
}

export function WheelPanel({
  state,
  entries,
  view,
  spin,
  result,
  roomLive,
  rosterReady,
  onSpin,
  onSource,
  onRules,
  onWeight,
  onPutBack,
  onRestartRound,
  canLoadExample,
  onLoadExample,
}: WheelPanelProps) {
  const team = state.source === TEAM_SOURCE;
  const eligible = new Set(view.eligible);
  const live = {
    names: view.shown.map((e) => e.name),
    weights: view.shown.map((e) => e.weight),
    out: view.shown.map((_, i) => i).filter((i) => !eligible.has(i)),
  };
  const picture = spin.picture ?? live;
  const empty = view.shown.length === 0;
  const sourceOptions = [
    { value: TEAM_SOURCE, label: "Team" },
    ...state.lists.map((l) => ({ value: l.id, label: l.name })),
  ];

  const status = empty
    ? ""
    : state.everyoneOnce
      ? view.roundOver
        ? `Everyone has had a turn. The next spin starts round ${view.round + 1}.`
        : `Round ${view.round}: ${view.left} of ${view.shown.length} still to come up.`
      : `${poolLabel(sourceLabel(state), view.shown.length, team)}. Anyone can come up.`;
  // Who already came up this round, in words: the wheel only greys them out.
  const hadTurn =
    state.everyoneOnce && !view.roundOver
      ? view.shown.filter((_, i) => !eligible.has(i)).map((e) => e.name)
      : [];
  const hadTurnKeys = new Set(hadTurn.map(nameKey));

  return (
    <section aria-labelledby="picker-wheel-heading" className="space-y-4">
      <h2 id="picker-wheel-heading" className="sr-only">
        Wheel
      </h2>

      {sourceOptions.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-sm text-text" aria-hidden="true">
            What to spin
          </p>
          <ToggleGroup
            label="What to spin"
            options={sourceOptions}
            value={state.source}
            onValueChange={(v) => {
              if (!spin.spinning) onSource(v);
            }}
            size="sm"
          />
        </div>
      )}

      {empty && view.removed.length === 0 ? (
        rosterReady || !team ? (
          <EmptyState
            icon={Users}
            action={
              <div className="flex flex-wrap gap-2">
                {team && (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/team">Add your team</Link>
                  </Button>
                )}
                {canLoadExample && <LoadExampleButton onLoad={onLoadExample} />}
              </div>
            }
          >
            {team
              ? "No names to spin yet. Add your team on the Team page, or make a list of any names below."
              : "This list has no names yet. Edit it below to add some."}
          </EmptyState>
        ) : (
          <p role="status" className="text-sm text-sub">
            Loading your team…
          </p>
        )
      ) : (
        <div className="space-y-3">
          {empty ? (
            <p className="text-sm text-text">Everyone has been picked and taken off the wheel.</p>
          ) : (
            <PickerWheel
              names={picture.names}
              weights={picture.weights}
              out={picture.out}
              rotation={spin.rotation}
              spinning={spin.spinning}
              winner={spin.winner}
              label={wheelLabel(picture.names.length)}
            />
          )}
          <p
            className="min-h-8 text-center font-display text-2xl font-bold text-text"
            data-testid="picker-result"
          >
            {spin.spinning ? "…" : (result ?? "")}
          </p>
          {status && <p className="text-center text-sm text-sub">{status}</p>}
          {hadTurn.length > 0 && (
            <p className="text-center text-sm text-sub">Had a turn: {hadTurn.join(", ")}.</p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              id={SPIN_BUTTON_ID}
              type="button"
              size="lg"
              variant="toolkit"
              className="gap-2"
              onClick={() => onSpin(false)}
              disabled={empty}
              aria-disabled={spin.spinning || undefined}
            >
              <Disc3
                aria-hidden="true"
                className={spin.spinning ? "motion-safe:animate-spin" : ""}
              />
              {spin.spinning ? "Spinning…" : "Spin"}
            </Button>
            {roomLive && (
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={() => onSpin(true)}
                disabled={empty}
                aria-disabled={spin.spinning || undefined}
              >
                <MonitorUp aria-hidden="true" />
                Spin for the room
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-text">Rules</h3>
        <RuleSwitch
          id="picker-everyone-once"
          label="Everyone once"
          hint="Nobody comes up twice until everyone has had a turn."
          checked={state.everyoneOnce}
          onChange={(v) => onRules({ everyoneOnce: v })}
        />
        <RuleSwitch
          id={REMOVE_PICKED_ID}
          label="Take a name off after it's picked"
          hint="It stays off the wheel until you put it back."
          checked={state.removePicked}
          onChange={(v) => onRules({ removePicked: v })}
        />
        <div className="flex flex-wrap gap-2">
          {state.everyoneOnce && view.left < view.shown.length && !view.roundOver && (
            <Button
              id={RESTART_ID}
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                onRestartRound();
                // The button goes once the round restarts: its neighbour takes focus.
                focusSoon(byId(PUT_BACK_ID), byId(REMOVE_PICKED_ID));
              }}
            >
              <RotateCcw aria-hidden="true" />
              Start the round again
            </Button>
          )}
          {view.removed.length > 0 && (
            <Button
              id={PUT_BACK_ID}
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                onPutBack();
                focusSoon(byId(RESTART_ID), byId(REMOVE_PICKED_ID));
              }}
            >
              <Undo2 aria-hidden="true" />
              Put {view.removed.length === 1 ? view.removed[0] : `all ${view.removed.length}`} back
            </Button>
          )}
        </div>
        {view.removed.length > 0 && (
          <p className="text-xs text-sub">Off the wheel: {view.removed.join(", ")}.</p>
        )}
      </div>

      {view.shown.length > 0 && (
        <details className="rounded-lg border border-border bg-card px-3 pb-3 sm:px-4 sm:pb-4">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-text">
            Weights
          </summary>
          <p className="text-xs text-sub">
            A weight of 2 comes up twice as often as 1. Weights change the odds, nothing else.
          </p>
          <ul className="mt-2 divide-y divide-rule">
            {view.shown.map((e) => {
              // At a limit the button stays focusable (aria-disabled), so
              // focus doesn't fall out of the list under the keyboard.
              const atMin = e.weight <= PICKER_LIMITS.minWeight;
              const atMax = e.weight >= PICKER_LIMITS.maxWeight;
              return (
                <li
                  key={nameKey(e.name)}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="min-w-0 truncate text-sm text-text">
                    {e.name}
                    {hadTurnKeys.has(nameKey(e.name)) && (
                      <span className="ml-1 text-xs text-sub">(had a turn)</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="aria-disabled:opacity-50"
                      aria-label={`Less weight for ${e.name}`}
                      aria-disabled={atMin || spin.spinning || undefined}
                      onClick={() => {
                        if (!atMin && !spin.spinning) onWeight(e.name, e.weight - 1);
                      }}
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <span className="w-6 text-center font-data text-sm text-text">{e.weight}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="aria-disabled:opacity-50"
                      aria-label={`More weight for ${e.name}`}
                      aria-disabled={atMax || spin.spinning || undefined}
                      onClick={() => {
                        if (!atMax && !spin.spinning) onWeight(e.name, e.weight + 1);
                      }}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          {entries.length > view.shown.length && (
            <p className="mt-2 text-xs text-sub">Names off the wheel keep their weights.</p>
          )}
        </details>
      )}
    </section>
  );
}

function RuleSwitch({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-text">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-sub">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}
