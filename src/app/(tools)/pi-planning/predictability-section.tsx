"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { Flag, Trash2 } from "lucide-react";
import { ChartFigure } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cheer } from "@/lib/celebrate/cheer";
import { NO_VALUE, listAnd } from "@/lib/charts/chart-text";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import {
  ACTUAL_BV_MAX,
  BAND_MAX,
  DEFAULT_BAND,
  HISTORY_MAX,
  PI_NAME_MAX,
  appendCapped,
  localDayOf,
  removeAppended,
  type PiBand,
  type PiObjective,
  type PiRecord,
  type PiState,
} from "@/lib/pi-planning/model";
import {
  HISTORY_AVERAGE_MIN,
  bandOf,
  bandText,
  historyAverage,
  piPredictability,
  predictabilityVerdict,
  recordFrom,
  recordPct,
  teamPctText,
  type TeamPredictability,
} from "@/lib/pi-planning/predictability";
import { cn } from "@/lib/utils";
import { parseNumber, type Validation } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import { dayLabel } from "../dependency-map/format";
import { SelectField } from "../dependency-map/fields";

type Log = (action: string, payload?: Record<string, unknown>) => void;
type Update = (fn: (s: PiState) => PiState) => void;

/* ── The PI's name and band ─────────────────────────────────────────── */

interface SettingsDraft {
  name: string;
  low: string;
  high: string;
}
export interface SettingsValues {
  name?: string;
  /** Undefined: back to the common aim. */
  band?: PiBand;
}

/**
 * The PI's name is optional. The band's two ends are whole percentages
 * from 0 to BAND_MAX, the lower one first; both blank goes back to the
 * common aim (80–100%), one blank is an error rather than a guess.
 */
export function validatePiSettings(
  d: SettingsDraft
): Validation<SettingsValues, keyof SettingsDraft> {
  const errors: Partial<Record<keyof SettingsDraft, string>> = {};
  const low = parseNumber(d.low);
  const high = parseNumber(d.high);
  const bad = (v: number | undefined) =>
    v === undefined || !Number.isInteger(v) || v < 0 || v > BAND_MAX;
  const blank = low === undefined && high === undefined;
  if (!blank) {
    if (bad(low)) errors.low = `Give the lower end as a whole number from 0 to ${BAND_MAX}.`;
    if (bad(high)) errors.high = `Give the upper end as a whole number from 0 to ${BAND_MAX}.`;
    if (!errors.low && !errors.high && (low as number) > (high as number)) {
      errors.high = "The upper end can't be below the lower one.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const name = d.name.trim().slice(0, PI_NAME_MAX).trim();
  return {
    ok: true,
    values: {
      ...(name ? { name } : {}),
      ...(blank ? {} : { band: { low: low as number, high: high as number } }),
    },
  };
}

function SettingsForm({ state, onSave }: { state: PiState; onSave: (v: SettingsValues) => void }) {
  const band = bandOf(state);
  const form = useItemForm<SettingsDraft, SettingsValues, keyof SettingsDraft>({
    initial: () => ({ name: state.name ?? "", low: String(band.low), high: String(band.high) }),
    validate: validatePiSettings,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Save name and aim" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem]">
        <Field label="PI name" hint="Optional. Its closed record keeps it." error={errors.name}>
          {(props) => (
            <Input
              {...props}
              maxLength={PI_NAME_MAX}
              value={draft.name}
              placeholder="e.g. PI 2026.4"
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Aim from (%)" error={errors.low}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={0}
              max={BAND_MAX}
              value={draft.low}
              onChange={(e) => update({ low: e.target.value })}
            />
          )}
        </Field>
        <Field label="Aim to (%)" error={errors.high}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={0}
              max={BAND_MAX}
              value={draft.high}
              onChange={(e) => update({ high: e.target.value })}
            />
          )}
        </Field>
      </div>
      <p className="text-xs text-sub">
        {DEFAULT_BAND.low}–{DEFAULT_BAND.high}% is a common aim, not a rule: set the band your train
        agrees on, or clear both ends to go back to it.
      </p>
    </ItemForm>
  );
}

/* ── Bars ───────────────────────────────────────────────────────────── */

const STATUS_BAR: Record<TeamPredictability["status"], string> = {
  "nothing-planned": "bg-sub/40",
  "to-score": "bg-sub/40",
  below: "bg-warning",
  within: "bg-success",
  above: "bg-accent",
};

const STATUS_WORDS: Record<TeamPredictability["status"], string> = {
  "nothing-planned": "",
  "to-score": "",
  below: "below the aim",
  within: "within the aim",
  above: "above the aim",
};

function PredictabilityBars({ state }: { state: PiState }) {
  const p = piPredictability(state);
  const pcts = p.teams.flatMap((t) => (t.pct === null ? [] : [t.pct]));
  // The scale's right end: 120%, or further when a team or the band goes past it.
  const top = Math.max(120, p.band.high, ...pcts, p.total?.pct ?? 0);
  const at = (pct: number) => `${Math.min(100, (pct / top) * 100)}%`;
  const rows = [
    ...p.teams.map((t) => ({ key: t.teamId, name: t.name || "Unnamed team", row: t })),
    ...(p.total && p.total.teams > 1
      ? [
          {
            key: "train",
            name: "Train",
            row: { ...p.total, toScore: 0 } as Pick<
              TeamPredictability,
              "pct" | "status" | "toScore" | "plannedBv" | "actualBv"
            >,
          },
        ]
      : []),
  ];
  return (
    <ChartFigure
      label="Predictability per team"
      summary={predictabilityVerdict(p)}
      table={{
        caption: "Planned against actual business value per team",
        columns: ["Team", "Planned BV", "Actual BV", "Predictability"],
        rows: rows.map(({ name, row }) => [
          name,
          row.plannedBv,
          row.plannedBv > 0 ? row.actualBv : NO_VALUE,
          teamPctText(row),
        ]),
      }}
    >
      <ul className="space-y-2">
        {rows.map(({ key, name, row }) => (
          <li
            key={key}
            className={cn(
              "grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-2 gap-y-0.5 text-xs sm:grid-cols-[minmax(0,8rem)_1fr_auto]",
              key === "train" && "border-t border-border pt-2 font-medium"
            )}
          >
            <span className="truncate text-text">{name}</span>
            <span className="relative h-3 overflow-hidden rounded-full bg-sub/15">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 bg-success/20"
                style={{
                  left: at(p.band.low),
                  width: `calc(${at(p.band.high)} - ${at(p.band.low)})`,
                }}
              />
              {row.pct !== null && (
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", STATUS_BAR[row.status])}
                  style={{ width: at(row.pct) }}
                />
              )}
            </span>
            <span className="col-span-2 font-mono text-text sm:col-span-1 sm:text-right">
              {teamPctText(row)}
              {row.pct !== null && (
                <span className="font-sans text-sub">
                  {" "}
                  · BV {row.actualBv} of {row.plannedBv} · {STATUS_WORDS[row.status]}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-sub">
        The shaded part of each bar is the aim, {bandText(p.band)}.
      </p>
    </ChartFigure>
  );
}

/* ── The section ────────────────────────────────────────────────────── */

const ACTUAL_OPTIONS = [
  { value: "", label: "Not scored" },
  ...Array.from({ length: ACTUAL_BV_MAX + 1 }, (_, i) => ({ value: String(i), label: String(i) })),
];

/**
 * "Predictability": each objective's actual business value (0–10), each
 * team's actual against its planned value as a percentage, the train's
 * total, all against the band; "Close this PI" keeps the scored teams'
 * numbers in the history (the board stays as it is), with Undo; the closed
 * PIs, and their average from three.
 */
export function PredictabilitySection({
  state,
  update,
  log,
  today,
}: {
  state: PiState;
  update: Update;
  log: Log;
  today: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const objectives = state.objectives ?? [];
  const p = piPredictability(state);
  const scored = p.teams.filter((t) => t.pct !== null);
  const waiting = p.teams.filter((t) => t.pct === null && t.plannedBv > 0);
  const history = state.history ?? [];
  const average = historyAverage(history);
  const band = bandOf(state);

  const scoreObjective = (o: PiObjective, raw: string) => {
    const actual = raw === "" ? undefined : Number(raw);
    if (actual === o.actualBusinessValue) return;
    update((s) => ({
      ...s,
      objectives: (s.objectives ?? []).map((x) => {
        if (x.id !== o.id) return x;
        const next = { ...x };
        if (actual === undefined) delete next.actualBusinessValue;
        else next.actualBusinessValue = actual;
        return next;
      }),
    }));
    log(PI_PLANNING_ACTIONS.OBJECTIVE_SCORED, {
      objectiveId: o.id,
      planned: o.businessValue ?? null,
      actual: actual ?? null,
    });
  };

  const saveSettings = (v: SettingsValues) =>
    update((s) => {
      const next = { ...s };
      if (v.name) next.name = v.name;
      else delete next.name;
      if (v.band) next.band = v.band;
      else delete next.band;
      return next;
    });

  const closePi = () => {
    const record = recordFrom(state, {
      id: nanoid(8),
      name: state.name?.trim() || `PI closed ${dayLabel(today, true)}`,
      closedAt: new Date().toISOString(),
    });
    if (!record) return;
    const pct = recordPct(record);
    // The closed PIs the cap drops to make room come back on Undo.
    let dropped: PiRecord[] = [];
    undoable({
      label: `Closed ${record.name}`,
      description: pct === null ? undefined : `${pct}% predictability kept in the history`,
      kind: "success",
      apply: () =>
        update((s) => {
          const next = appendCapped(s.history ?? [], record, HISTORY_MAX);
          dropped = next.dropped;
          return { ...s, history: next.list };
        }),
      revert: () =>
        update((s) => ({
          ...s,
          history: removeAppended(s.history ?? [], record.id, dropped, HISTORY_MAX),
        })),
    });
    log(PI_PLANNING_ACTIONS.PI_CLOSED, {
      recordId: record.id,
      predictability: pct,
      teams: record.teams.length,
    });
    cheer("pi-planning", "milestone");
  };

  const removeRecord = (record: PiRecord) => {
    let index = -1;
    undoable({
      label: `Deleted ${record.name || "the closed PI"} from the history`,
      apply: () =>
        update((s) => {
          const list = s.history ?? [];
          index = list.findIndex((r) => r.id === record.id);
          return { ...s, history: list.filter((r) => r.id !== record.id) };
        }),
      revert: () =>
        update((s) => {
          const list = [...(s.history ?? [])];
          if (list.some((r) => r.id === record.id)) return s;
          list.splice(index < 0 ? list.length : Math.min(index, list.length), 0, record);
          return { ...s, history: list.slice(-HISTORY_MAX) };
        }),
    });
  };

  const closeText = () => {
    const parts = [
      `It keeps ${listAnd(scored.map((t) => `${t.name || "a team"} (${t.pct}%)`))}${
        p.total && p.total.teams > 1 ? `, ${p.total.pct}% for the train,` : ""
      } in the history below.`,
    ];
    if (waiting.length > 0) {
      parts.push(
        `${listAnd(waiting.map((t) => t.name || "A team"))} ${
          waiting.length === 1 ? "isn't" : "aren't"
        } scored yet, so ${waiting.length === 1 ? "it's" : "they're"} left out.`
      );
    }
    parts.push("The board stays as it is.");
    return parts.join(" ");
  };

  return (
    <div className="space-y-5">
      <SettingsForm
        key={`${state.name ?? ""}|${band.low}|${band.high}`}
        state={state}
        onSave={saveSettings}
      />

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-text">Actual value</h3>
        {objectives.length === 0 ? (
          <p className="text-sm text-sub">
            Add PI objectives above first. At the end of the PI the business owners score what each
            one delivered, from 0 to 10.
          </p>
        ) : (
          <>
            <p className="text-xs text-sub">
              At the end of the PI the business owners score what each objective delivered, from 0
              to 10. Uncommitted objectives add to the actual value but not the plan.
            </p>
            {state.teams
              .map((team) => ({ team, list: objectives.filter((o) => o.teamId === team.id) }))
              .filter(({ list }) => list.length > 0)
              .map(({ team, list }) => (
                <div key={team.id} className="space-y-1">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-sub">
                    {team.name || "Unnamed team"}
                  </h4>
                  <ul className="divide-y divide-border">
                    {list.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                        <span className="min-w-0 flex-1 basis-48">
                          <span className="block break-words text-sm text-text">{o.title}</span>
                          <span className="text-xs text-sub">
                            {o.committed ? "Committed" : "Uncommitted"} · BV{" "}
                            {o.businessValue ?? "not scored"}
                          </span>
                        </span>
                        <SelectField
                          label={`Actual value of ${o.title || "objective"}`}
                          hideLabel
                          className="w-36"
                          options={ACTUAL_OPTIONS}
                          value={
                            o.actualBusinessValue === undefined ? "" : String(o.actualBusinessValue)
                          }
                          onChange={(v) => scoreObjective(o, v)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <PredictabilityBars state={state} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={scored.length === 0}
            onClick={() => setConfirming(true)}
          >
            <Flag className="h-4 w-4" aria-hidden="true" />
            Close this PI
          </Button>
          {scored.length === 0 && (
            <p className="text-xs text-sub">
              Score at least one team&apos;s objectives before closing the PI.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-text">Closed PIs</h3>
        {history.length === 0 ? (
          <p className="text-sm text-sub">
            None yet. Close a PI once its objectives are scored, and it stays here when the board
            moves on.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border" aria-label="Closed PIs">
              {[...history].reverse().map((r) => {
                const pct = recordPct(r);
                const planned = r.teams.reduce((a, t) => a + t.plannedBv, 0);
                const actual = r.teams.reduce((a, t) => a + t.actualBv, 0);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block break-words text-sm text-text">
                        {r.name || "A closed PI"}
                      </span>
                      <span className="text-xs text-sub">
                        Closed {dayLabel(localDayOf(r.closedAt), true)} · BV {actual} of {planned} ·{" "}
                        {r.teams.length} {r.teams.length === 1 ? "team" : "teams"}
                      </span>
                    </span>
                    <span className="font-mono text-sm text-text">
                      {pct === null ? NO_VALUE : `${pct}%`}
                    </span>
                    <IconButton
                      label={`Delete ${r.name || "the closed PI"} from the history`}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="text-sub hover:text-danger"
                      onClick={() => removeRecord(r)}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-text">
              {average
                ? `Average over ${average.count} closed PIs: ${average.pct}%.`
                : `The average shows once ${HISTORY_AVERAGE_MIN} PIs are closed.`}
            </p>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Close this PI?"
        description={confirming ? closeText() : undefined}
        confirmLabel="Close this PI"
        tone="default"
        onConfirm={closePi}
      />
    </div>
  );
}
