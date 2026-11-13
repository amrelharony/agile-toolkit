/**
 * A checked Quick Vote round (./draft.ts `RoundSetup`) as the vote kit
 * asks for it: a `Questionnaire` for a scale round, a `ChoiceSheet`,
 * `RankSheet` or `NumberSheet` for the others, with ids the kit can carry
 * (`[A-Za-z0-9:_-]`, 64 at most).
 *
 * The sheet's id names the format (`qv:<presetId>`, plus the backlog item
 * for value poker when its id fits), so a round saved after the host has
 * moved on to another format is still filed under the one it ran as.
 *
 * Pure: the kit's types only.
 */

import type { Questionnaire } from "@/lib/realtime/vote-room/protocol";
import type { ChoiceSheet } from "@/lib/realtime/vote-room/choice";
import type { NumberSheet } from "@/lib/realtime/vote-room/number";
import type { RankSheet } from "@/lib/realtime/vote-room/rank";
import type { RoundSetup } from "./draft";
import { isPresetId, type PresetId } from "./presets";

/** A round for the kit, tagged with its kind. */
export type QuickVoteRound =
  | { kind: "scale"; questionnaire: Questionnaire; minN: number }
  | { kind: "choice"; sheet: ChoiceSheet; minN: number }
  | { kind: "rank"; sheet: RankSheet; minN: number }
  | { kind: "number"; sheet: NumberSheet; minN: number };

const ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const PREFIX = "qv:";

/** The sheet id for a round of `setup`. */
export function sheetIdFor(setup: RoundSetup): string {
  const base = `${PREFIX}${setup.presetId}`;
  if (setup.kind === "choice" && setup.backlogItemId) {
    const withItem = `${base}:${setup.backlogItemId}`;
    if (ID_RE.test(withItem)) return withItem;
  }
  return base;
}

/** The format and backlog item a sheet id names (nulls for an id that isn't ours). */
export function readSheetId(id: string): {
  presetId: PresetId | null;
  backlogItemId: string | null;
} {
  if (!id.startsWith(PREFIX)) return { presetId: null, backlogItemId: null };
  const rest = id.slice(PREFIX.length);
  const cut = rest.indexOf(":");
  const preset = cut < 0 ? rest : rest.slice(0, cut);
  const item = cut < 0 ? "" : rest.slice(cut + 1);
  return {
    presetId: isPresetId(preset) ? preset : null,
    backlogItemId: preset === "value-poker" && item ? item : null,
  };
}

const optionId = (i: number) => `o${i + 1}`;

/** The round `setup` asks, as the kit takes it. */
export function roundFor(setup: RoundSetup): QuickVoteRound {
  const id = sheetIdFor(setup);
  switch (setup.kind) {
    case "scale":
      return {
        kind: "scale",
        minN: setup.minN,
        questionnaire: {
          id,
          title: setup.title,
          scale: { id: `${PREFIX}scale`, points: setup.points.map((p) => ({ ...p })) },
          questions: [{ id: "q1", text: setup.title }],
        },
      };
    case "choice":
      return {
        kind: "choice",
        minN: setup.minN,
        sheet: {
          id,
          title: setup.title,
          mode: setup.mode,
          limit: setup.mode === "single" ? 1 : setup.limit,
          options: setup.options.map((o, i) =>
            o.hint
              ? { id: optionId(i), text: o.text, hint: o.hint }
              : { id: optionId(i), text: o.text }
          ),
        },
      };
    case "rank":
      return {
        kind: "rank",
        minN: setup.minN,
        sheet: {
          id,
          title: setup.title,
          options: setup.options.map((o, i) => ({ id: optionId(i), text: o.text })),
        },
      };
    case "number":
      return {
        kind: "number",
        minN: setup.minN,
        sheet: {
          id,
          title: setup.title,
          min: setup.min,
          max: setup.max,
          decimals: setup.decimals,
          unit: setup.unit,
        },
      };
  }
}
