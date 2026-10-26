/**
 * The prioritization method engine: the shapes every method shares.
 *
 * Each method (MoSCoW, WSJF, RICE, Value/Effort, ICE, Kano, Cost of Delay,
 * Eisenhower) is one plain module in this folder holding its inputs, their
 * scales and what each value means, and the only scoring code for it. The
 * method tools, the Backlog Prioritizer hub, Sprint Planning, the AI
 * prompts and the agent actions all score through it, so one item reads
 * the same number everywhere.
 *
 * Plain modules only: no "use client", no store, no components. The MCP
 * route calls them on the server, where a client module's export is only a
 * reference and calling it throws.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";

/** The methods, keyed as their rows' `PrioritizationItem.framework`. */
export type MethodId =
  | "moscow"
  | "wsjf"
  | "rice"
  | "value-effort"
  | "ice"
  | "kano"
  | "cost-of-delay"
  | "eisenhower";

/** A row's stored inputs (the `PrioritizationItem.fields` bag). */
export type RowFields = Record<string, number | string>;

/**
 * A method's inputs as read from a row, an item or a form draft, by the
 * method's input keys. `undefined` means not set: never a mid-range default.
 */
export type Values = Record<string, number | string | undefined>;

/**
 * One value on a method's scale, e.g. RICE impact 3 "Massive". Structurally
 * the ScalePicker's step (components/shared/scale-picker.tsx), so a method's
 * steps pass straight to the picker; `example` is extra copy for rubrics.
 */
export interface ScaleStep {
  value: number;
  /** A word shown after the number ("Massive"). */
  name?: string;
  /** What the value means; the option's tooltip and accessible description. */
  meaning?: string;
  /** A concrete case of this value, for a "How sure?" style rubric. */
  example?: string;
}

/** One option of a choice input (a MoSCoW bucket, a CoD urgency profile). */
export interface ChoiceOption {
  id: string;
  label: string;
  meaning?: string;
}

interface InputBase {
  /** The key in `Values` (and the form draft). */
  key: string;
  label: string;
  /** One line under the input: what the scale means. */
  hint: string;
  /** The error when it's left blank ("Pick an impact."). */
  missing: string;
  /** The BacklogItem field holding this input, for a method the backlog holds. */
  backlogKey?: keyof BacklogItem;
  /** Not needed for a score (shown, never required). */
  optional?: boolean;
}

export type MethodInput =
  | (InputBase & {
      kind: "scale";
      steps: readonly ScaleStep[];
      /** How a value reads: "pct" → "80%", "x" → "2x". */
      format?: "pct" | "x";
    })
  | (InputBase & {
      kind: "number";
      min: number;
      max?: number;
      step?: number;
      unit?: string;
    })
  | (InputBase & { kind: "choice"; options: readonly ChoiceOption[] })
  /** A "YYYY-MM-DD" day; it can be in the past. */
  | (InputBase & { kind: "date" })
  /** A roster person's name (PersonPicker). */
  | (InputBase & { kind: "person" });

/** Theme token family a bucket is drawn in (never a hex). */
export type BucketTone = "success" | "accent" | "warning" | "danger" | "muted";

/** A category a method sorts into: a MoSCoW bucket, a quadrant, a Kano category, a CoD lane. */
export interface BucketDef {
  id: string;
  label: string;
  meaning: string;
  /** Display order, 0 first (the order the method's tool lists them). */
  order: number;
  tone: BucketTone;
}

/**
 * What a method makes of one set of inputs.
 *
 * - `score`: the method's number, unrounded (display rounds through
 *   `format`); null when a required input is missing: "Not scored".
 * - `bucket`: its category (MoSCoW bucket, quadrant, Kano category, CoD
 *   lane), null when there is none. Never a default bucket.
 * - `sortKey`: what orders scored results, highest first, when the method
 *   has no `compare` of its own; null exactly when `score` is null.
 * - `missing`: the input keys that keep it from a score.
 * - `warnings`: a set input the score had to treat specially (RICE effort
 *   below the minimum), in words for the row.
 * - `extra`: method-specific results (Kano Better/Worse, a CoD latest start).
 */
export interface MethodScore {
  score: number | null;
  bucket: string | null;
  sortKey: number | null;
  missing: string[];
  warnings: string[];
  extra?: Record<string, number | string | boolean | null | undefined>;
}

/** What a score may depend on besides its inputs. */
export interface EvalContext {
  /** Today, "YYYY-MM-DD" in the user's time zone (Eisenhower's due dates). */
  today?: string;
}

export interface PrioritizationMethod {
  id: MethodId;
  /** The tool id, which is also its route segment. */
  toolId: string;
  /** Short name for column headers and links. */
  label: string;
  /**
   * The backlog item holds this method's inputs (`owns`): a linked row
   * reads them from the item and writes them back (lib/prioritization/binding).
   */
  embedded: boolean;
  inputs: readonly MethodInput[];
  buckets?: readonly BucketDef[];
  /** A row's stored fields as inputs: legacy keys, numeric strings and off-scale values kept. */
  read(fields: RowFields | undefined): Values;
  /**
   * `fields` with these inputs written: unset ones removed, every other
   * key kept (and the legacy key a row already uses for an input). A
   * derived value is never written (a quadrant, a Kano category).
   */
  write(fields: RowFields | undefined, v: Values): RowFields;
  /** A draft checked for saving: a blank required input is an error, never a default. */
  validate(draft: Values): Validation<Values, string>;
  /** The score of a set of inputs. Pure. */
  evaluate(v: Values, ctx?: EvalContext): MethodScore;
  /**
   * Order of two scored results, negative when `a` goes first (Cost of
   * Delay's urgency lanes). Absent: `sortKey` descending.
   */
  compare?(a: MethodScore, b: MethodScore): number;
  /** A score for display (RICE to 1 decimal place, the others to 2). */
  format(score: number): string;
  /** The BacklogItem fields this method owns (embedded methods only). */
  owns?: readonly (keyof BacklogItem)[];
  /** The method's inputs as the backlog item holds them (old defaults cleared, legacy value read). */
  fromBacklog?(item: BacklogItem): Values;
  /** The backlog fields for a set of inputs: only the set ones, the exact values. */
  toBacklog?(v: Values): Partial<BacklogItem>;
}
