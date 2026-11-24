"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AiButton, AiSuggestions } from "@/components/ai";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  WORK_TYPES,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_SLE_PERCENTILES,
  type KanbanCard,
  type KanbanColumnId,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import {
  BOARD_NAME,
  CLASS_LABEL,
  WORKFLOW_TEXT_MAX,
  mergeWorkflow,
  policyStages,
  sleFromHistory,
  wipColumns,
  type WorkflowBoard,
  type WorkflowPatch,
} from "@/lib/kanban/workflow";
import { WORK_TYPE_LABEL, WORK_TYPE_MEANING } from "@/lib/flow/work-types";
import { finishedItems } from "@/lib/flow/cycle";
import type { FlowItem } from "@/lib/flow/types";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import type { AiSource } from "@/lib/ai/task-types";
import {
  cleanPoliciesAnswer,
  kanbanPoliciesTask,
  type PoliciesInput,
  type PoliciesOutput,
} from "@/lib/ai/tasks/kanban.lite";
import { focusFirstInvalid, type FormErrors } from "@/lib/utils/form";
import {
  CLASSES,
  applyWorkflowValues,
  changedParts,
  draftFromWorkflow,
  draftKeys,
  validateWorkflowDraft,
  type TextField as TextKey,
  type WorkflowDraft,
} from "./form";
import { policiesInput } from "./ai-input";
import { SELECT_CLASS, TextField } from "./fields";
import type { WorkflowController } from "./use-workflow";

const LABEL: Record<TextKey, { label: string; hint?: string; placeholder?: string }> = {
  workItem: {
    label: "What one work item is",
    placeholder: "e.g. A customer request we change code for",
  },
  startPoint: {
    label: "Work starts when",
    placeholder: "e.g. Someone pulls it into In progress",
  },
  finishPoint: {
    label: "Work is finished when",
    placeholder: "e.g. It is live and the asker knows",
  },
  wipPolicy: { label: "WIP policy", placeholder: "e.g. When a column is full, help clear it" },
  pullPolicy: {
    label: "Pull policy",
    hint: "Which item to pull next.",
    placeholder: "e.g. Expedite first, then the oldest",
  },
  blockerPolicy: {
    label: "Blocker policy",
    hint: "What the team does when an item is blocked.",
    placeholder: "e.g. Flag it the same day and say why",
  },
};

/** One accepted-or-not line of "Draft policies". */
type Suggestion =
  | { kind: "policy"; stage: string; enter?: string; exit?: string }
  | { kind: "startPoint" | "finishPoint" | "blockerPolicy"; text: string };

function suggestionsOf(out: PoliciesOutput): Suggestion[] {
  const list: Suggestion[] = out.policies.map((p) => ({ kind: "policy", ...p }));
  for (const kind of ["startPoint", "finishPoint", "blockerPolicy"] as const) {
    const text = out[kind];
    if (text) list.push({ kind, text });
  }
  return list;
}

const SUGGESTION_TITLE: Record<Exclude<Suggestion["kind"], "policy">, string> = {
  startPoint: "Work starts when",
  finishPoint: "Work is finished when",
  blockerPolicy: "Blocker policy",
};

/** The history part an accepted suggestion changes. */
const partOf = (item: Suggestion) =>
  item.kind === "policy" ? "policies" : item.kind === "blockerPolicy" ? "blockers" : "basics";

/**
 * `base` with one accepted suggestion: a stage policy fills the entry or
 * exit it brings and keeps the other one written; a text replaces its
 * field. A definition with no board yet describes the one in the editor.
 */
function withSuggestion(
  base: WorkflowDefinition,
  item: Suggestion,
  board: WorkflowBoard
): WorkflowDefinition {
  if (item.kind === "policy") {
    const others = (base.policies ?? []).filter((p) => p.stage !== item.stage);
    const had = (base.policies ?? []).find((p) => p.stage === item.stage);
    const policy = {
      stage: item.stage,
      ...(item.enter || had?.enter ? { enter: item.enter ?? had?.enter } : {}),
      ...(item.exit || had?.exit ? { exit: item.exit ?? had?.exit } : {}),
    };
    return mergeWorkflow(base, { board: base.board ?? board, policies: [...others, policy] });
  }
  const patch: WorkflowPatch = { board: base.board ?? board };
  patch[item.kind] = item.text;
  return mergeWorkflow(base, patch);
}

/**
 * The Definition of Workflow tab: which board it describes, what one work
 * item is, start and finish, entry and exit policies per stage (Done is
 * the Definition of Done), the WIP, pull and blocker policies, a policy
 * per class of service (Flow board only), the SLE and the work types with
 * their target mix. One Save, with Undo. The fields hold only what the
 * person changed, over the stored definition, so a policy accepted from
 * "Draft policies" shows in every field nobody is editing.
 */
export function DowEditor({
  controller,
  view,
  wipLimits,
  cards,
  itemsFor,
  log,
}: {
  controller: WorkflowController;
  view: WorkflowBoard;
  wipLimits: Record<KanbanColumnId, number>;
  /** The Flow board's cards (the classes of service in use). */
  cards: readonly KanbanCard[];
  /** The board's items, for an SLE from history. */
  itemsFor: (board: WorkflowBoard) => FlowItem[];
  log: (action: string, payload: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const def = controller.def;
  const formRef = useRef<HTMLFormElement>(null);
  const [overrides, setOverrides] = useState<WorkflowDraft>({});
  const [errors, setErrors] = useState<FormErrors<string>>({});
  const [sleNote, setSleNote] = useState<string | null>(null);
  const [sleShort, setSleShort] = useState<number | null>(null);
  const sleHintId = useId();
  const [suggested, setSuggested] = useState<{
    items: Suggestion[];
    questions: string[];
    source: AiSource;
  } | null>(null);
  const aiInput = useRef<PoliciesInput | null>(null);
  const aiRef = useRef<HTMLDivElement>(null);

  const draft = useMemo(
    () => ({ ...draftFromWorkflow(def, view), ...overrides }),
    [def, view, overrides]
  );
  const board: WorkflowBoard = draft.board === "sprint" ? "sprint" : "flow";
  const stages = policyStages(board);
  const set = (patch: WorkflowDraft) => setOverrides((o) => ({ ...o, ...patch }));
  const forget = (keys: string[]) =>
    setOverrides((o) => {
      const next = { ...o };
      for (const k of keys) delete next[k];
      return next;
    });
  const logged = (payload: Record<string, unknown>) => {
    if (!controller.example) log(KANBAN_ACTIONS.WORKFLOW_UPDATED, payload);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateWorkflowDraft(draft);
    if (!v.ok) {
      setErrors(v.errors);
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    const before = controller.current();
    const saved = controller.save(
      (cur) => applyWorkflowValues(cur, v.values),
      "Saved the Definition of Workflow"
    );
    setOverrides({});
    if (!saved) {
      announce("Nothing changed in the Definition of Workflow.");
      return;
    }
    logged({ parts: changedParts(before, saved) });
    announce("Saved the Definition of Workflow.");
  };

  const suggestSle = () => {
    const pct = Number(draft.slePct) as (typeof WORKFLOW_SLE_PERCENTILES)[number];
    const items = itemsFor(board);
    const s = sleFromHistory(items, pct);
    if (!s) {
      setSleShort(finishedItems(items).length);
      setSleNote(null);
      return;
    }
    setSleShort(null);
    set({ sleDays: String(s.days) });
    setSleNote(
      `${s.pct}% of ${s.sample} finished items took ${s.days} ${s.days === 1 ? "day" : "days"} or less. Save to keep it.`
    );
  };

  const titleOf = (item: Suggestion) =>
    item.kind === "policy"
      ? `the ${stages.find((s) => s.id === item.stage)?.label ?? item.stage} policy`
      : `the ${SUGGESTION_TITLE[item.kind].toLowerCase()}`;

  /**
   * Add accepted suggestions in one save: one Undo toast and one history
   * row, whether it is one item or "Add all" (whose Undo then takes back
   * every one of them).
   */
  const accept = (items: Suggestion[]) => {
    if (items.length === 0) return;
    const label =
      items.length === 1 ? `Added ${titleOf(items[0])}` : `Added ${items.length} suggestions`;
    const saved = controller.save(
      (cur) =>
        items.reduce<WorkflowDefinition>(
          (base, item) => withSuggestion(base, item, board),
          cur ?? { id: WORKFLOW_DEFINITION_ID }
        ),
      label
    );
    forget(
      items.flatMap((item) =>
        item.kind === "policy"
          ? [draftKeys.enterKey(item.stage), draftKeys.exitKey(item.stage)]
          : [item.kind]
      )
    );
    if (saved) {
      const parts = Array.from(new Set(items.map(partOf)));
      logged({ parts, source: suggested?.source ?? "fallback" });
    }
  };

  const err = (key: string) => errors[key];

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="It describes" hint="Policies and the SLE show on this board.">
          {(p) => (
            <select
              {...p}
              className={SELECT_CLASS}
              value={board}
              onChange={(e) => set({ board: e.target.value })}
            >
              {(["sprint", "flow"] as const).map((b) => (
                <option key={b} value={b}>
                  {BOARD_NAME[b]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <TextField
          {...LABEL.workItem}
          value={draft.workItem}
          max={WORKFLOW_TEXT_MAX}
          error={err("workItem")}
          onChange={(v) => set({ workItem: v })}
        />
        <TextField
          {...LABEL.startPoint}
          value={draft.startPoint}
          max={WORKFLOW_TEXT_MAX}
          error={err("startPoint")}
          onChange={(v) => set({ startPoint: v })}
        />
        <TextField
          {...LABEL.finishPoint}
          value={draft.finishPoint}
          max={WORKFLOW_TEXT_MAX}
          error={err("finishPoint")}
          onChange={(v) => set({ finishPoint: v })}
        />
      </div>
      <p className="text-xs text-sub">
        Start and finish are words for the team: the board still counts cycle time from the day an
        item enters In progress or Review.
      </p>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-text">Policies per stage</legend>
        {stages.map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text">
              {s.label}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label={
                  <>
                    <span className="sr-only">{s.label}: </span>Enters when
                  </>
                }
                value={draft[draftKeys.enterKey(s.id)] ?? ""}
                max={WORKFLOW_TEXT_MAX}
                error={err(draftKeys.enterKey(s.id))}
                onChange={(v) => set({ [draftKeys.enterKey(s.id)]: v })}
              />
              <TextField
                label={
                  <>
                    <span className="sr-only">{s.label}: </span>Leaves when
                  </>
                }
                value={draft[draftKeys.exitKey(s.id)] ?? ""}
                max={WORKFLOW_TEXT_MAX}
                error={err(draftKeys.exitKey(s.id))}
                onChange={(v) => set({ [draftKeys.exitKey(s.id)]: v })}
              />
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-sub">
          <span className="font-semibold uppercase tracking-wider text-text text-xs">Done</span>{" "}
          means your Definition of Done.{" "}
          <Link href="/dod-builder" className="text-accent underline-offset-2 hover:underline">
            Open the DoD builder
          </Link>
        </div>
      </fieldset>

      <div ref={aiRef} className="space-y-3">
        <AiButton
          task={kanbanPoliciesTask}
          label="Draft policies"
          fallbackLabel="Start from a template"
          variant="outline"
          input={() => {
            const input = policiesInput({
              board,
              draft,
              statik: def?.statik,
              wipLimits,
              cards,
            });
            aiInput.current = input;
            return input;
          }}
          onResult={(data, meta) => {
            const input = aiInput.current;
            const clean = input ? cleanPoliciesAnswer(data, input) : data;
            setSuggested({
              items: suggestionsOf(clean),
              questions: clean.questions ?? [],
              source: meta.source,
            });
          }}
        />
        {suggested && (
          <>
            <AiSuggestions<Suggestion>
              items={suggested.items}
              source={suggested.source}
              title="Suggested policies"
              render={(item) =>
                item.kind === "policy"
                  ? {
                      title: stages.find((s) => s.id === item.stage)?.label ?? item.stage,
                      detail: [
                        item.enter ? `Enters when: ${item.enter}` : null,
                        item.exit ? `Leaves when: ${item.exit}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    }
                  : { title: SUGGESTION_TITLE[item.kind], detail: item.text }
              }
              onAccept={(item) => accept([item])}
              onAcceptAll={(items) => accept(items)}
              onDismiss={() => setSuggested(null)}
              returnFocus={() =>
                aiRef.current?.querySelector<HTMLElement>("[data-testid=ai-button]")
              }
            />
            {suggested.questions.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text">
                  <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
                  Questions to answer next
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-sub">
                  {suggested.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-text">WIP, pull and blockers</legend>
        <p className="text-sm text-sub">
          WIP limits on the {BOARD_NAME[board]}:{" "}
          <span className="font-data text-text">
            {wipColumns(board)
              .map((c) => `${c.label} ${wipLimits[c.key] ? wipLimits[c.key] : "no limit"}`)
              .join(" · ")}
          </span>
          . Change them on the board&apos;s column headers.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["wipPolicy", "pullPolicy", "blockerPolicy"] as const).map((key) => (
            <TextField
              key={key}
              {...LABEL[key]}
              value={draft[key]}
              max={WORKFLOW_TEXT_MAX}
              error={err(key)}
              onChange={(v) => set({ [key]: v })}
            />
          ))}
        </div>
      </fieldset>

      {board === "flow" && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-text">Classes of service</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {CLASSES.map((cls) => (
              <TextField
                key={cls}
                label={`${CLASS_LABEL[cls]} policy`}
                value={draft[draftKeys.classKey(cls)] ?? ""}
                max={WORKFLOW_TEXT_MAX}
                error={err(draftKeys.classKey(cls))}
                onChange={(v) => set({ [draftKeys.classKey(cls)]: v })}
              />
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-text">Service level expectation</legend>
        {/* The hint sits under the row, not under its field, so the three
            controls line up; the days column fits its label on one line. */}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,11rem)_auto] sm:items-end">
          <Field label="Share of items">
            {(p) => (
              <select
                {...p}
                aria-describedby={sleHintId}
                className={SELECT_CLASS}
                value={draft.slePct}
                onChange={(e) => set({ slePct: e.target.value })}
              >
                {WORKFLOW_SLE_PERCENTILES.map((pct) => (
                  <option key={pct} value={String(pct)}>
                    {pct}%
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Finish within (days)" error={err("sleDays")}>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={draft.sleDays}
                onChange={(e) => set({ sleDays: e.target.value })}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={suggestSle}
          >
            Suggest from history
          </Button>
        </div>
        <p id={sleHintId} className="text-xs text-sub">
          The shares are Cycle Time&apos;s percentiles.
        </p>
        {sleNote && (
          <p role="status" className="text-sm text-sub">
            {sleNote}
          </p>
        )}
        {sleShort !== null && (
          <NotEnoughData
            have={sleShort}
            need="distribution"
            unit={["finished item", "finished items"]}
            action="Finish"
            what="an SLE from history"
          />
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium text-text">Work types and target mix</legend>
        <p className="text-xs text-sub">
          The target mix applies to both boards: Flow Insights compares what you finish with it.
          Four whole numbers that add up to 100, or leave all four blank.
        </p>
        {WORK_TYPES.map((t) => (
          <div key={t} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,7rem)]">
            <TextField
              label={`${WORK_TYPE_LABEL[t]}: what it means here`}
              placeholder={WORK_TYPE_MEANING[t]}
              value={draft[draftKeys.meaningKey(t)] ?? ""}
              max={WORKFLOW_TEXT_MAX}
              error={err(draftKeys.meaningKey(t))}
              onChange={(v) => set({ [draftKeys.meaningKey(t)]: v })}
            />
            <Field label={`${WORK_TYPE_LABEL[t]} target %`} error={err(`target:${t}`)}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={draft[draftKeys.targetKey(t)] ?? ""}
                  onChange={(e) => set({ [draftKeys.targetKey(t)]: e.target.value })}
                />
              )}
            </Field>
          </div>
        ))}
        {errors["target:total"] && (
          <p role="alert" className="text-sm text-danger">
            {errors["target:total"]}
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">
          <Save aria-hidden="true" />
          Save the workflow
        </Button>
        {Object.keys(overrides).length > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOverrides({});
              setErrors({});
            }}
          >
            Discard changes
          </Button>
        )}
      </div>
    </form>
  );
}
