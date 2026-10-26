"use client";

import { Compass, Lightbulb, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { CynefinAnswer, CynefinDomain } from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  ANSWER_LABEL,
  CYNEFIN_ANSWERS,
  DOMAINS,
  DOMAIN_IDS,
  QUESTIONS,
  RATIONALE_MAX,
  TITLE_MAX,
  senseDomain,
  type CynefinAnswers,
} from "@/lib/cynefin/model";

export interface SenseDraft {
  title: string;
  answers: CynefinAnswers;
  /** Unset until the team picks one: the questions only suggest. */
  domain: CynefinDomain | null;
  rationale: string;
}

export interface NewCynefinItem {
  title: string;
  domain: CynefinDomain;
  rationale?: string;
  answers?: CynefinAnswers;
}

const EMPTY: SenseDraft = { title: "", answers: {}, domain: null, rationale: "" };

/**
 * A problem needs a title and a domain the team picked (or confirmed from
 * the suggestion); nothing lands in a domain by default.
 */
export function validateSense(d: SenseDraft): Validation<NewCynefinItem, keyof SenseDraft> {
  const errors: FormErrors<keyof SenseDraft> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Describe the problem in a few words.";
  else if (title.length > TITLE_MAX) errors.title = `Keep it to ${TITLE_MAX} characters.`;
  if (!d.domain) errors.domain = "Pick a domain, or answer the questions for a suggestion.";
  const rationale = d.rationale.trim();
  if (rationale.length > RATIONALE_MAX) {
    errors.rationale = `Keep the reason to ${RATIONALE_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0 || !d.domain) return { ok: false, errors };
  const answered = Object.keys(d.answers).length > 0;
  return {
    ok: true,
    values: {
      title,
      domain: d.domain,
      ...(rationale ? { rationale } : {}),
      ...(answered ? { answers: d.answers } : {}),
    },
  };
}

/** Domain tones: theme tokens only (the old page painted them with hex). */
export const DOMAIN_TONE: Readonly<Record<CynefinDomain, string>> = {
  clear: "text-success",
  complicated: "text-info",
  complex: "text-accent",
  chaotic: "text-danger",
  confused: "text-sub",
};

/**
 * Place a problem: answer the guided questions (Yes, No, Not sure), see
 * the domain they suggest and why, then confirm it or pick another. The
 * suggestion's reason fills in the rationale when it is used.
 */
export function SenseForm({ onSave }: { onSave: (values: NewCynefinItem) => void }) {
  const form = useItemForm<SenseDraft, NewCynefinItem, keyof SenseDraft>({
    initial: EMPTY,
    validate: validateSense,
    onSave,
  });
  const { draft, update, errors } = form;
  const suggestion = senseDomain(draft.answers);
  const setAnswer = (q: string, a: CynefinAnswer) =>
    update({ answers: { ...draft.answers, [q]: a } });
  const takeSuggestion = () => {
    if (!suggestion.domain) return;
    update({
      domain: suggestion.domain,
      // The reason becomes the rationale unless one was written.
      rationale: draft.rationale.trim() ? draft.rationale : suggestion.reason,
    });
  };

  return (
    <ItemForm
      form={form}
      submitLabel="Place it"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <Field label="Problem" required error={errors.title}>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TITLE_MAX}
            placeholder="e.g. Customers churn after the new pricing page"
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm text-text">Make sense of it</legend>
        {QUESTIONS.map((q) => (
          <div key={q.id} className="flex flex-col gap-1.5">
            <span className="text-sm text-text" aria-hidden="true">
              {q.text}
            </span>
            <ToggleGroup
              label={q.text}
              size="sm"
              value={draft.answers[q.id] ?? null}
              onValueChange={(a) => setAnswer(q.id, a)}
              options={CYNEFIN_ANSWERS.map((a) => ({ value: a, label: ANSWER_LABEL[a] }))}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {Object.keys(draft.answers).length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => update({ answers: {} })}>
              Clear the answers
            </Button>
          )}
        </div>
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-start gap-2 rounded-md bg-surface-deep px-3 py-2 text-sm"
        >
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          {suggestion.domain ? (
            <span className="min-w-0 flex-1">
              Suggested:{" "}
              <span className={`font-semibold ${DOMAIN_TONE[suggestion.domain]}`}>
                {DOMAINS[suggestion.domain].label}
              </span>
              , because {suggestion.reason.charAt(0).toLowerCase()}
              {suggestion.reason.slice(1)}
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-sub">{suggestion.reason}</span>
          )}
          {suggestion.domain && draft.domain !== suggestion.domain && (
            <Button type="button" size="sm" variant="outline" onClick={takeSuggestion}>
              Use the suggestion
            </Button>
          )}
        </div>
      </fieldset>

      <div
        className="flex flex-col gap-1.5"
        data-scale-invalid={errors.domain ? "true" : undefined}
      >
        <span className="flex items-center gap-1 text-sm text-text" aria-hidden="true">
          <Compass className="h-4 w-4 text-sub" />
          Domain<span className="ml-0.5 text-danger">*</span>
        </span>
        <ToggleGroup
          label="Domain"
          value={draft.domain}
          onValueChange={(domain) => update({ domain })}
          options={DOMAIN_IDS.map((d) => ({
            value: d,
            label: DOMAINS[d].label,
            description: DOMAINS[d].meaning,
          }))}
        />
        {draft.domain ? (
          <p className="text-xs text-sub">{DOMAINS[draft.domain].recipe}</p>
        ) : (
          !errors.domain && (
            <p className="text-xs text-sub">
              Not placed yet: the team decides, the questions only suggest.
            </p>
          )
        )}
        {errors.domain && (
          <p className="text-xs text-danger" role="alert">
            {errors.domain}
          </p>
        )}
      </div>

      <Field label="Why this domain" error={errors.rationale}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={RATIONALE_MAX}
            value={draft.rationale}
            onChange={(e) => update({ rationale: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}
