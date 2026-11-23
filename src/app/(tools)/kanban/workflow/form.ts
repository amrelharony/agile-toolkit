/**
 * The Definition of Workflow editor's draft: every field as a string, keyed
 * flat ("enter:review", "target:debt"), so the form can hold only what the
 * person changed on top of the stored definition (an AI suggestion accepted
 * meanwhile still shows in the fields nobody touched). Pure, so the
 * checks are testable without a browser.
 */

import {
  MEETING_CADENCES,
  WORK_TYPES,
  WORKFLOW_SLE_PERCENTILES,
  type KanbanCadence,
  type KanbanClassOfService,
  type MeetingCadence,
  type WorkflowDefinition,
  type WorkflowSlePercentile,
  type WorkType,
} from "@/lib/stores/workspace-types";
import {
  CADENCE_MINUTES,
  SLE_DAYS,
  WORKFLOW_TEXT_MAX,
  describedBoard,
  mergeWorkflow,
  policyStages,
  type WorkflowBoard,
  type WorkflowPatch,
} from "@/lib/kanban/workflow";
import {
  validateTargetSplit,
  withTargetSplit,
  type TargetSplit,
  type TargetSplitDraft,
} from "@/lib/flow/work-types";
import { isBlank, parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";

export type WorkflowDraft = Record<string, string>;

export const CLASSES: readonly KanbanClassOfService[] = [
  "standard",
  "expedite",
  "fixed_date",
  "intangible",
];

/** The plain text fields, in the order the editor shows them. */
export const TEXT_FIELDS = [
  "workItem",
  "startPoint",
  "finishPoint",
  "wipPolicy",
  "pullPolicy",
  "blockerPolicy",
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

const enterKey = (stage: string) => `enter:${stage}`;
const exitKey = (stage: string) => `exit:${stage}`;
const classKey = (cls: KanbanClassOfService) => `class:${cls}`;
const meaningKey = (t: WorkType) => `meaning:${t}`;
const targetKey = (t: WorkType) => `target:${t}`;
export const draftKeys = { enterKey, exitKey, classKey, meaningKey, targetKey };

/** Every stage id either board can have a policy for. */
const ALL_STAGES = Array.from(
  new Set([...policyStages("flow"), ...policyStages("sprint")].map((s) => s.id))
);

/** The draft a stored definition opens as; `view` is the board on screen, for a new one. */
export function draftFromWorkflow(
  def: WorkflowDefinition | null | undefined,
  view: WorkflowBoard
): WorkflowDraft {
  const draft: WorkflowDraft = { board: describedBoard(def) ?? view };
  for (const key of TEXT_FIELDS) draft[key] = def?.[key] ?? "";
  for (const stage of ALL_STAGES) {
    const p = (def?.policies ?? []).find((x) => x.stage === stage);
    draft[enterKey(stage)] = p?.enter ?? "";
    draft[exitKey(stage)] = p?.exit ?? "";
  }
  for (const cls of CLASSES) {
    draft[classKey(cls)] = (def?.classPolicies ?? []).find((c) => c.class === cls)?.policy ?? "";
  }
  draft.sleDays = def?.sle ? String(def.sle.days) : "";
  draft.slePct = String(def?.sle?.pct ?? 85);
  for (const t of WORK_TYPES) {
    const w = (def?.workTypes ?? []).find((x) => x.type === t);
    draft[meaningKey(t)] = w?.meaning ?? "";
    draft[targetKey(t)] = w?.targetPct === undefined ? "" : String(w.targetPct);
  }
  return draft;
}

/** What a valid draft saves: the change, and the target mix (null clears it). */
export interface WorkflowValues {
  patch: WorkflowPatch;
  split: TargetSplit | null;
}

const tooLong = (v: string) => v.trim().length > WORKFLOW_TEXT_MAX;
const TOO_LONG = `Keep it under ${WORKFLOW_TEXT_MAX + 1} characters.`;

/**
 * Check the draft: every text at most WORKFLOW_TEXT_MAX characters, the
 * SLE's days a whole number from 1 to 365 (or blank for none), and the
 * target mix four whole numbers adding up to 100 (or all blank). Errors are
 * keyed by draft key; the mix's sum is "target:total".
 */
export function validateWorkflowDraft(draft: WorkflowDraft): Validation<WorkflowValues, string> {
  const errors: FormErrors<string> = {};
  const board: WorkflowBoard = draft.board === "sprint" ? "sprint" : "flow";
  for (const [key, value] of Object.entries(draft)) {
    if (key.startsWith("target:") || key === "sleDays" || key === "slePct" || key === "board") {
      continue;
    }
    if (tooLong(value ?? "")) errors[key] = TOO_LONG;
  }
  let sle: WorkflowPatch["sle"] = null;
  if (!isBlank(draft.sleDays)) {
    const days = parseNumber(draft.sleDays);
    if (
      days === undefined ||
      !Number.isInteger(days) ||
      days < SLE_DAYS.min ||
      days > SLE_DAYS.max
    ) {
      errors.sleDays = `Enter whole days from ${SLE_DAYS.min} to ${SLE_DAYS.max}, or leave it blank.`;
    } else {
      const pct = Number(draft.slePct) as WorkflowSlePercentile;
      sle = { days, pct: (WORKFLOW_SLE_PERCENTILES as readonly number[]).includes(pct) ? pct : 85 };
    }
  }
  const splitDraft: TargetSplitDraft = Object.fromEntries(
    WORK_TYPES.map((t) => [t, draft[targetKey(t)] ?? ""])
  );
  const split = validateTargetSplit(splitDraft);
  if (!split.ok) {
    for (const [field, message] of Object.entries(split.errors)) {
      errors[`target:${field}`] = message;
    }
  }
  if (Object.keys(errors).length > 0 || !split.ok) return { ok: false, errors };

  const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const patch: WorkflowPatch = { board, sle };
  for (const key of TEXT_FIELDS) patch[key] = text(draft[key]);
  patch.policies = policyStages(board).flatMap((s) => {
    const enter = text(draft[enterKey(s.id)]);
    const exit = text(draft[exitKey(s.id)]);
    return enter || exit
      ? [{ stage: s.id, ...(enter ? { enter } : {}), ...(exit ? { exit } : {}) }]
      : [];
  });
  // Classes of service are the Flow board's: on the Sprint board they stay as they were.
  if (board === "flow") {
    patch.classPolicies = CLASSES.flatMap((cls) => {
      const policy = text(draft[classKey(cls)]);
      return policy ? [{ class: cls, policy }] : [];
    });
  }
  patch.workTypes = WORK_TYPES.flatMap((t) => {
    const meaning = text(draft[meaningKey(t)]);
    return meaning ? [{ type: t, meaning }] : [];
  });
  return { ok: true, values: { patch, split: split.values } };
}

/** The definition a valid draft saves over `def`. The same `def` when nothing changed. */
export function applyWorkflowValues(
  def: WorkflowDefinition | null | undefined,
  { patch, split }: WorkflowValues,
  at: string = new Date().toISOString()
): WorkflowDefinition {
  const merged = mergeWorkflow(def, patch, at);
  const next = withTargetSplit(merged, split, at);
  if (def && JSON.stringify(strip(next)) === JSON.stringify(strip(def))) return def;
  return next;
}

function strip(def: WorkflowDefinition) {
  const out: Partial<WorkflowDefinition> = { ...def };
  delete out.createdAt;
  delete out.updatedAt;
  return out;
}

/** The add-a-cadence form's draft. */
export interface CadenceDraft {
  name: string;
  cadence: string;
  minutes: string;
  purpose: string;
}

export const EMPTY_CADENCE: CadenceDraft = {
  name: "",
  cadence: "weekly",
  minutes: "",
  purpose: "",
};

export type CadenceValues = Omit<KanbanCadence, "id">;

/** A cadence needs a name and a known cadence; minutes 5–240 when given. */
export function validateCadence(
  d: CadenceDraft
): Validation<CadenceValues, "name" | "minutes" | "purpose"> {
  const errors: FormErrors<"name" | "minutes" | "purpose"> = {};
  const name = d.name.trim();
  if (!name) errors.name = "Name the meeting.";
  else if (name.length > WORKFLOW_TEXT_MAX) errors.name = TOO_LONG;
  if (d.purpose.trim().length > WORKFLOW_TEXT_MAX) errors.purpose = TOO_LONG;
  let minutes: number | undefined;
  if (!isBlank(d.minutes)) {
    minutes = parseNumber(d.minutes);
    if (
      minutes === undefined ||
      !Number.isInteger(minutes) ||
      minutes < CADENCE_MINUTES.min ||
      minutes > CADENCE_MINUTES.max
    ) {
      errors.minutes = `Enter whole minutes from ${CADENCE_MINUTES.min} to ${CADENCE_MINUTES.max}, or leave it blank.`;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const cadence = (MEETING_CADENCES as readonly string[]).includes(d.cadence)
    ? (d.cadence as MeetingCadence)
    : "weekly";
  const purpose = d.purpose.trim();
  return {
    ok: true,
    values: {
      name,
      cadence,
      ...(minutes !== undefined ? { minutes } : {}),
      ...(purpose ? { purpose } : {}),
    },
  };
}

/** Which parts of the definition a save changed, for the history log (kinds, never text). */
export function changedParts(
  before: WorkflowDefinition | null | undefined,
  after: WorkflowDefinition
): string[] {
  const parts: [string, (d: WorkflowDefinition | null | undefined) => unknown][] = [
    ["board", (d) => d?.board],
    ["basics", (d) => [d?.workItem, d?.startPoint, d?.finishPoint]],
    ["policies", (d) => d?.policies],
    ["classes", (d) => d?.classPolicies],
    ["wip", (d) => d?.wipPolicy],
    ["pull", (d) => d?.pullPolicy],
    ["blockers", (d) => d?.blockerPolicy],
    ["sle", (d) => d?.sle],
    ["work_types", (d) => d?.workTypes],
  ];
  return parts
    .filter(([, get]) => JSON.stringify(get(before)) !== JSON.stringify(get(after)))
    .map(([name]) => name);
}
