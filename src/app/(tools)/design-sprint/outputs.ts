import { INTERVIEWS, OUTPUT_TEXT_MAX, OUTPUT_URL_MAX, isWebLink } from "@/lib/design-sprint/doc";
import type {
  DesignSprintDayNumber,
  DesignSprintOutput,
  DesignSprintOutputKind,
} from "@/lib/stores/workspace-types";
import { parseNumber, type Validation } from "@/lib/utils/form";

/**
 * What each design-sprint day produces, and the place on the page for it.
 *
 * The days used to share one list of free-text "artifacts", so nothing held
 * the long-term goal, the decision or the prototype link, and Test day's
 * findings couldn't go anywhere. Each day now declares typed slots: Map
 * holds the goal, the sprint questions and the target; Sketch the
 * solution sketches; Decide the decision and the storyboard; Prototype the
 * prototype; Test the findings (and, on the Map day's questions, their
 * answers). Every day keeps a Notes slot, where the old artifacts show.
 */

// The limits are shared with the agent actions.
export { INTERVIEWS, OUTPUT_TEXT_MAX, OUTPUT_URL_MAX } from "@/lib/design-sprint/doc";

export type FindingSignal = NonNullable<DesignSprintOutput["signal"]>;
export type QuestionAnswer = NonNullable<DesignSprintOutput["answer"]>;

export interface OutputSlot {
  kind: DesignSprintOutputKind;
  /** The section heading: "Long-term goal", "Sprint questions". */
  heading: string;
  /** One item, not a list: the goal, the target, the decision, the prototype. */
  single: boolean;
  /** One of them, lower case, for toasts and button names: "sprint question". */
  noun: string;
  /** The add form's button: "Set the long-term goal", "Add a sketch". */
  addLabel: string;
  /** The text field's label. */
  textLabel: string;
  placeholder: string;
  hint?: string;
  /** Offer a link (a Figma file, a photo of the whiteboard, the prototype). */
  link: boolean;
  /** Shown while the slot is empty. */
  emptyText: string;
}

const NOTES: OutputSlot = {
  kind: "note",
  heading: "Notes",
  single: false,
  noun: "note",
  addLabel: "Add a note",
  textLabel: "Note",
  placeholder: "Anything else worth keeping from today",
  link: true,
  emptyText: "No notes yet.",
};

export const DAY_SLOTS: Readonly<Record<DesignSprintDayNumber, readonly OutputSlot[]>> = {
  1: [
    {
      kind: "long-term-goal",
      heading: "Long-term goal",
      single: true,
      noun: "long-term goal",
      addLabel: "Set the long-term goal",
      textLabel: "Long-term goal",
      placeholder: "In two years' time, …",
      hint: "Why are we doing this project? Where do we want to be in six months, a year, or even five years from now?",
      link: false,
      emptyText: "Not set yet.",
    },
    {
      kind: "sprint-question",
      heading: "Sprint questions",
      single: false,
      noun: "sprint question",
      addLabel: "Add a sprint question",
      textLabel: "Sprint question",
      placeholder: "Can we …? Will customers …?",
      hint: "What could stop us from reaching the goal, phrased as a question. Test day answers each one.",
      link: false,
      emptyText: "No sprint questions yet.",
    },
    {
      kind: "target",
      heading: "Target",
      single: true,
      noun: "target",
      addLabel: "Set the target",
      textLabel: "Target",
      placeholder: "The customer and the moment on the map to focus on",
      hint: "The Decider picks one customer and one event on the map.",
      link: true,
      emptyText: "Not picked yet.",
    },
    NOTES,
  ],
  2: [
    {
      kind: "sketch",
      heading: "Solution sketches",
      single: false,
      noun: "sketch",
      addLabel: "Add a sketch",
      textLabel: "Sketch",
      placeholder: "A catchy title for the idea",
      hint: "One per person, anonymous; link a photo or a scan.",
      link: true,
      emptyText: "No sketches yet.",
    },
    NOTES,
  ],
  3: [
    {
      kind: "decision",
      heading: "Decision",
      single: true,
      noun: "decision",
      addLabel: "Record the decision",
      textLabel: "Decision",
      placeholder: "The winning sketch, and anything borrowed from the others",
      hint: "The Decider's supervote.",
      link: false,
      emptyText: "Not decided yet.",
    },
    {
      kind: "storyboard",
      heading: "Storyboard",
      single: true,
      noun: "storyboard",
      addLabel: "Add the storyboard",
      textLabel: "Storyboard",
      placeholder: "What the storyboard covers, from first contact to the end",
      link: true,
      emptyText: "Not drawn yet.",
    },
    NOTES,
  ],
  4: [
    {
      kind: "prototype",
      heading: "Prototype",
      single: true,
      noun: "prototype",
      addLabel: "Add the prototype",
      textLabel: "Prototype",
      placeholder: "What the prototype is, e.g. a clickable checkout in Figma",
      hint: "Link it so the interviewer can open it on Test day.",
      link: true,
      emptyText: "Not built yet.",
    },
    NOTES,
  ],
  5: [
    {
      kind: "finding",
      heading: "Findings",
      single: false,
      noun: "finding",
      addLabel: "Add a finding",
      textLabel: "Finding",
      placeholder: "What customers did or said",
      hint: "A pattern you saw in the interviews. Send it on as a hypothesis or a backlog story.",
      link: false,
      emptyText: "No findings yet.",
    },
    NOTES,
  ],
};

const SLOT_KINDS = (day: DesignSprintDayNumber) => new Set(DAY_SLOTS[day].map((s) => s.kind));

/**
 * The outputs a slot shows. Notes also take any output whose kind doesn't
 * belong to the day (an agent's, or a future kind), so nothing is hidden.
 */
export function outputsIn(
  day: DesignSprintDayNumber,
  slot: OutputSlot,
  outputs: readonly DesignSprintOutput[]
): DesignSprintOutput[] {
  if (slot.kind !== "note") return outputs.filter((o) => o.kind === slot.kind);
  const kinds = SLOT_KINDS(day);
  return outputs.filter((o) => o.kind === "note" || !kinds.has(o.kind));
}

export const SIGNAL_LABEL: Readonly<Record<FindingSignal, string>> = {
  positive: "Positive",
  negative: "Negative",
  mixed: "Mixed",
};

export const ANSWER_LABEL: Readonly<Record<QuestionAnswer, string>> = {
  yes: "Yes",
  no: "No",
  unclear: "Unclear",
};

export const isSignal = (v: unknown): v is FindingSignal =>
  v === "positive" || v === "negative" || v === "mixed";
export const isAnswer = (v: unknown): v is QuestionAnswer =>
  v === "yes" || v === "no" || v === "unclear";

/** A finding's signal and interview count, the parts that are set: "Positive · seen in 4 of 5 interviews". */
export function findingMeta(o: Pick<DesignSprintOutput, "signal" | "seenIn">): string {
  const parts: string[] = [];
  if (isSignal(o.signal)) parts.push(SIGNAL_LABEL[o.signal]);
  if (typeof o.seenIn === "number" && Number.isFinite(o.seenIn)) {
    parts.push(`seen in ${o.seenIn} of ${INTERVIEWS} interviews`);
  }
  return parts.join(" · ");
}

/* ── The add and edit forms ─────────────────────────────────────────── */

/** "none" is the explicit "Not judged" choice. */
export type SignalChoice = FindingSignal | "none";

export interface OutputDraft {
  text: string;
  url: string;
  signal: SignalChoice;
  /** As typed: "" until counted. */
  seenIn: string;
}

export type OutputField = keyof OutputDraft;

export interface OutputValues {
  text: string;
  url?: string;
  signal?: FindingSignal;
  seenIn?: number;
}

export const EMPTY_OUTPUT_DRAFT: OutputDraft = { text: "", url: "", signal: "none", seenIn: "" };

export function outputDraftFrom(o: DesignSprintOutput): OutputDraft {
  return {
    text: o.text,
    url: o.url ?? "",
    signal: isSignal(o.signal) ? o.signal : "none",
    seenIn: typeof o.seenIn === "number" && Number.isFinite(o.seenIn) ? String(o.seenIn) : "",
  };
}

/**
 * Check an output draft for `slot`. The text is required; a link, when the
 * slot takes one, must be a full web address; a finding's interview count,
 * when given, is a whole number from 0 to 5. Fields the slot doesn't show
 * are left out of the values.
 */
export function validateOutput(
  slot: Pick<OutputSlot, "kind" | "link" | "noun">,
  d: OutputDraft
): Validation<OutputValues, OutputField> {
  const errors: Partial<Record<OutputField, string>> = {};
  const text = d.text.trim();
  if (!text) errors.text = `Describe the ${slot.noun}.`;
  else if (text.length > OUTPUT_TEXT_MAX)
    errors.text = `Keep it under ${OUTPUT_TEXT_MAX} characters.`;

  const url = slot.link ? d.url.trim() : "";
  if (url && (url.length > OUTPUT_URL_MAX || !isWebLink(url))) {
    errors.url = "Enter a full link, starting with https://";
  }

  const finding = slot.kind === "finding";
  const seenIn = finding ? parseNumber(d.seenIn) : undefined;
  if (seenIn !== undefined && (!Number.isInteger(seenIn) || seenIn < 0 || seenIn > INTERVIEWS)) {
    errors.seenIn = `Enter a whole number from 0 to ${INTERVIEWS}, or leave it empty.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      text,
      ...(url ? { url } : {}),
      ...(finding && d.signal !== "none" ? { signal: d.signal } : {}),
      ...(seenIn !== undefined ? { seenIn } : {}),
    },
  };
}

/**
 * The output with `values` applied. A field the slot's form shows and the
 * user cleared is removed; a field it doesn't show (a link an agent added
 * to the goal) is kept as it was.
 */
export function withOutputValues(
  slot: Pick<OutputSlot, "kind" | "link">,
  o: DesignSprintOutput,
  v: OutputValues
): DesignSprintOutput {
  const next: DesignSprintOutput = { ...o, text: v.text };
  if (slot.link) {
    if (v.url) next.url = v.url;
    else delete next.url;
  }
  if (slot.kind === "finding") {
    if (v.signal) next.signal = v.signal;
    else delete next.signal;
    if (v.seenIn !== undefined) next.seenIn = v.seenIn;
    else delete next.seenIn;
  }
  return next;
}

/** Whether saving `values` would change nothing the form shows. */
export function sameOutputValues(
  slot: Pick<OutputSlot, "kind" | "link">,
  o: DesignSprintOutput,
  v: OutputValues
): boolean {
  if (o.text !== v.text) return false;
  if (slot.link && (o.url || undefined) !== v.url) return false;
  if (slot.kind !== "finding") return true;
  const seenIn = typeof o.seenIn === "number" && Number.isFinite(o.seenIn) ? o.seenIn : undefined;
  return (isSignal(o.signal) ? o.signal : undefined) === v.signal && seenIn === v.seenIn;
}

// Shared with the agent actions (lib/design-sprint/doc).
export { isWebLink } from "@/lib/design-sprint/doc";
