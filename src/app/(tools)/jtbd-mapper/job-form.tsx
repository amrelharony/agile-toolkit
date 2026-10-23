"use client";

import { Plus } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import type { JobStory } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { descendantIds, jobSentence, jobsInTreeOrder, wouldCycle } from "./jobs";
import { OPPORTUNITY_TREE_HREF, opportunityIds } from "./opportunities";
import type { OpportunityGroup } from "./opportunities";

/** Per clause; the sentence is shown in full, so a pasted page is an error. */
export const CLAUSE_MAX = 500;
export const NOTES_MAX = 4000;

export interface JobDraft {
  situation: string;
  motivation: string;
  outcome: string;
  description: string;
  /** "" for a top-level job. */
  parentJobId: string;
  /**
   * The Opportunity Tree opportunity it serves; "" for none. Only the add
   * form sets it: a saved job's link changes from its row (Link, Unlink),
   * so editing the clauses never touches it.
   */
  opportunityId?: string;
}

export interface JobValues {
  situation: string;
  motivation: string;
  outcome: string;
  description?: string;
  parentJobId?: string;
  opportunityId?: string;
}

export type JobField = keyof JobDraft;

export const EMPTY_JOB_DRAFT: JobDraft = {
  situation: "",
  motivation: "",
  outcome: "",
  description: "",
  parentJobId: "",
  opportunityId: "",
};

type Clause = "situation" | "motivation" | "outcome";
const CLAUSES: readonly Clause[] = ["situation", "motivation", "outcome"];

/**
 * The sentence supplies "When", "I want to" and "so I can", so a clause
 * typed with its lead-in ("When I travel") would read "When When I
 * travel". The lead-in and a trailing full stop are dropped.
 */
const LEAD_IN: Record<Clause, RegExp> = {
  situation: /^when\b[\s,]*/i,
  motivation: /^i\s+(?:want|need)\s+to\b[\s,]*/i,
  outcome: /^so\s+(?:that\s+)?i\s+can\b[\s,]*/i,
};

export function cleanClause(clause: Clause, raw: string): string {
  return raw
    .trim()
    .replace(LEAD_IN[clause], "")
    .replace(/[\s.,;:]+$/, "");
}

const MISSING: Record<Clause, string> = {
  situation: "Describe the situation: when does this job come up?",
  motivation: "Say what they want to do.",
  outcome: "Say what it lets them do.",
};

export interface JobContext {
  /** Every job, to check the parent against. */
  jobs: readonly JobStory[];
  /** The job being edited (it can't sit under itself or its own sub-jobs). */
  editingId?: string;
  /** The opportunities a new job may link to (the add form's picker). */
  opportunityIds?: ReadonlySet<string>;
}

/**
 * Check a draft. A job story needs all three clauses: the form used to
 * save a job with only "When" filled in, which then read "I want to
 * (motivation), so I can (outcome)" forever.
 */
export function validateJob(d: JobDraft, ctx: JobContext): Validation<JobValues, JobField> {
  const errors: FormErrors<JobField> = {};
  const clean = {
    situation: cleanClause("situation", d.situation),
    motivation: cleanClause("motivation", d.motivation),
    outcome: cleanClause("outcome", d.outcome),
  };
  for (const key of CLAUSES) {
    if (!clean[key]) errors[key] = MISSING[key];
    else if (clean[key].length > CLAUSE_MAX)
      errors[key] = `Keep it to ${CLAUSE_MAX} characters (now ${clean[key].length}).`;
  }
  const description = d.description.trim();
  if (description.length > NOTES_MAX)
    errors.description = `Keep the notes to ${NOTES_MAX.toLocaleString("en-GB")} characters.`;

  const parentJobId = d.parentJobId;
  if (parentJobId) {
    if (!ctx.jobs.some((j) => j.id === parentJobId))
      errors.parentJobId = "That job was removed. Pick another, or none.";
    else if (ctx.editingId && wouldCycle(ctx.jobs, ctx.editingId, parentJobId))
      errors.parentJobId = "A job can’t sit under itself or one of its own sub-jobs.";
  }

  // The pick can vanish while the form is open (deleted in the tree in
  // another tab, or by an agent); saving it would start the job dangling.
  const opportunityId = d.opportunityId ?? "";
  if (opportunityId && ctx.opportunityIds && !ctx.opportunityIds.has(opportunityId))
    errors.opportunityId = "That opportunity was removed from the tree. Pick another, or none.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      ...clean,
      ...(description ? { description } : {}),
      ...(parentJobId ? { parentJobId } : {}),
      ...(opportunityId ? { opportunityId } : {}),
    },
  };
}

/** A draft from a stored job (legacy rows may have blank clauses). */
export function jobDraftFrom(job: JobStory): JobDraft {
  return {
    situation: job.situation ?? "",
    motivation: job.motivation ?? "",
    outcome: job.outcome ?? "",
    description: job.description ?? "",
    parentJobId: job.parentJobId ?? "",
  };
}

/** The job with the saved values; cleared notes and parent leave no empty keys behind. */
export function withJobValues(job: JobStory, v: JobValues): JobStory {
  const next: JobStory = {
    ...job,
    situation: v.situation,
    motivation: v.motivation,
    outcome: v.outcome,
  };
  if (v.description) next.description = v.description;
  else delete next.description;
  if (v.parentJobId) next.parentJobId = v.parentJobId;
  else delete next.parentJobId;
  return next;
}

export function sameJob(job: JobStory, v: JobValues): boolean {
  return (
    job.situation === v.situation &&
    job.motivation === v.motivation &&
    job.outcome === v.outcome &&
    (job.description ?? "") === (v.description ?? "") &&
    (job.parentJobId ?? "") === (v.parentJobId ?? "")
  );
}

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm";

const short = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * The three clauses, a preview of the sentence, the parent and notes, and
 * (in the add form only, when `opportunities` is given) the opportunity.
 */
function JobFields({
  draft,
  update,
  errors,
  ctx,
  opportunities,
}: {
  draft: JobDraft;
  update: (patch: Partial<JobDraft>) => void;
  errors: FormErrors<JobField>;
  ctx: JobContext;
  opportunities?: readonly OpportunityGroup[];
}) {
  // A job can go under any other job except itself and its own sub-jobs.
  const blocked = ctx.editingId
    ? descendantIds(ctx.jobs, ctx.editingId).add(ctx.editingId)
    : new Set<string>();
  const parents = jobsInTreeOrder(ctx.jobs).filter(({ job }) => !blocked.has(job.id));
  const preview = jobSentence({
    situation: cleanClause("situation", draft.situation),
    motivation: cleanClause("motivation", draft.motivation),
    outcome: cleanClause("outcome", draft.outcome),
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="When (the situation)" error={errors.situation} required>
          {(props) => (
            <Input
              {...props}
              value={draft.situation}
              onChange={(e) => update({ situation: e.target.value })}
              placeholder="e.g. a customer asks where their order is"
            />
          )}
        </Field>
        <Field label="I want to (the motivation)" error={errors.motivation} required>
          {(props) => (
            <Input
              {...props}
              value={draft.motivation}
              onChange={(e) => update({ motivation: e.target.value })}
              placeholder="e.g. see the parcel’s latest scan"
            />
          )}
        </Field>
        <Field label="So I can (the outcome)" error={errors.outcome} required>
          {(props) => (
            <Input
              {...props}
              value={draft.outcome}
              onChange={(e) => update({ outcome: e.target.value })}
              placeholder="e.g. give a delivery date in my first reply"
            />
          )}
        </Field>
      </div>
      <p className="break-words text-xs text-sub">
        <span className="font-medium text-text">Reads: </span>
        {preview}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="Under job"
          hint="Optional: nest it under a broader job."
          error={errors.parentJobId}
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.parentJobId}
              onChange={(e) => update({ parentJobId: e.target.value })}
            >
              <option value="">None (top level)</option>
              {parents.map(({ job, depth }) => (
                <option key={job.id} value={job.id}>
                  {`${"— ".repeat(Math.min(depth, 6))}${short(jobSentence(job))}`}
                </option>
              ))}
            </select>
          )}
        </Field>
        {opportunities && (
          <OpportunityField
            groups={opportunities}
            value={draft.opportunityId ?? ""}
            error={errors.opportunityId}
            onChange={(opportunityId) => update({ opportunityId })}
          />
        )}
        <Field
          label="Notes"
          hint="Optional: context, evidence, open questions."
          error={errors.description}
          // With the opportunity beside the parent, the notes take the full row.
          className={opportunities ? "md:col-span-2" : undefined}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              className="resize-y"
            />
          )}
        </Field>
      </div>
    </>
  );
}

/**
 * "Opportunity": optional, grouped under each opportunity's outcome
 * for context. With none in the tree yet the picker is off and the hint
 * points to the Opportunity Tree.
 */
function OpportunityField({
  groups,
  value,
  error,
  onChange,
}: {
  groups: readonly OpportunityGroup[];
  value: string;
  error?: string;
  onChange: (opportunityId: string) => void;
}) {
  const empty = groups.length === 0;
  return (
    <Field
      label="Opportunity"
      hint={
        empty ? (
          <>
            None yet: map them in the{" "}
            <Link href={OPPORTUNITY_TREE_HREF} className="text-accent hover:underline">
              Opportunity Tree
            </Link>
            .
          </>
        ) : (
          "Optional: the Opportunity Tree need this job is part of."
        )
      }
      error={error}
    >
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          disabled={empty}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">None</option>
          {groups.map((g) => (
            <optgroup
              key={g.outcomeId ?? "none"}
              label={g.outcomeId ? `Outcome: ${short(g.outcome)}` : g.outcome}
            >
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {short(o.title)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </Field>
  );
}

/** The add form's state; the client owns it so "Add a job under this" can set the parent. */
export function useJobAddForm(
  onAdd: (values: JobValues) => void,
  jobs: readonly JobStory[],
  opportunities: readonly OpportunityGroup[] = []
): ItemFormState<JobDraft, JobField> {
  const ids = opportunityIds(opportunities);
  return useItemForm<JobDraft, JobValues, JobField>({
    initial: EMPTY_JOB_DRAFT,
    validate: (d) => validateJob(d, { jobs, opportunityIds: ids }),
    onSave: onAdd,
  });
}

/** "Add job story": nothing is saved until all three clauses are filled in. */
export function JobAddForm({
  form,
  jobs,
  opportunities = [],
  footer,
}: {
  form: ItemFormState<JobDraft, JobField>;
  jobs: readonly JobStory[];
  /** The opportunities the new job may serve; with none, the picker says so. */
  opportunities?: readonly OpportunityGroup[];
  footer?: ReactNode;
}) {
  return (
    <ItemForm
      form={form}
      submitLabel="Add job story"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      footer={footer}
    >
      <JobFields
        draft={form.draft}
        update={form.update}
        errors={form.errors}
        ctx={{ jobs }}
        opportunities={opportunities}
      />
    </ItemForm>
  );
}

/** Edit a job in place. Enter saves, Escape cancels. */
export function JobRowEditor({
  job,
  jobs,
  onSave,
  onCancel,
}: {
  job: JobStory;
  jobs: readonly JobStory[];
  onSave: (values: JobValues) => void;
  onCancel: () => void;
}) {
  const ctx = { jobs, editingId: job.id };
  const form = useItemForm<JobDraft, JobValues, JobField>({
    initial: () => jobDraftFrom(job),
    validate: (d) => validateJob(d, ctx),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  // Open on the first clause, so the keyboard user lands where they were heading.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <JobFields draft={form.draft} update={form.update} errors={form.errors} ctx={ctx} />
    </ItemForm>
  );
}
