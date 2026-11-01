"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { Validation } from "@/lib/utils/form";
import {
  QUADRANTS,
  QUADRANT_CENTRE,
  QUADRANT_LABEL,
  SENTIMENTS,
  SENTIMENT_LABEL,
  type Quadrant,
  type Sentiment,
  type Stakeholder,
} from "./model";

export const NAME_MAX = 80;

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-danger";

interface StakeholderDraft {
  name: string;
  role: string;
  /** "" = not placed yet. */
  quadrant: "" | Quadrant;
  current: "" | Sentiment;
  desired: "" | Sentiment;
  strategy: string;
}
type StakeholderField = keyof StakeholderDraft;
export type NewStakeholder = Omit<Stakeholder, "id">;

const EMPTY: StakeholderDraft = {
  name: "",
  role: "",
  quadrant: "",
  current: "",
  desired: "",
  strategy: "",
};

/**
 * A new stakeholder needs a name; everything else starts unset. Interest
 * and authority used to start at 5/5, which put every new stakeholder in
 * Manage Closely, and the sentiment at Neutral.
 */
export function validateStakeholder(
  d: StakeholderDraft
): Validation<NewStakeholder, StakeholderField> {
  const name = d.name.replace(/\s+/g, " ").trim();
  const role = d.role.replace(/\s+/g, " ").trim();
  const strategy = d.strategy.trim();
  if (!name) return { ok: false, errors: { name: "Who is the stakeholder?" } };
  if (name.length > NAME_MAX)
    return { ok: false, errors: { name: `Keep the name to ${NAME_MAX} characters.` } };
  const at = d.quadrant ? QUADRANT_CENTRE[d.quadrant] : { interest: null, authority: null };
  return {
    ok: true,
    values: {
      name,
      ...(role ? { role } : {}),
      interest: at.interest,
      authority: at.authority,
      currentSentiment: d.current || null,
      desiredSentiment: d.desired || null,
      ...(strategy ? { strategy } : {}),
    },
  };
}

/** Add a stakeholder: a name, and anything known now (all optional). Enter saves. */
export function StakeholderForm({ onAdd }: { onAdd: (values: NewStakeholder) => void }) {
  const form = useItemForm<StakeholderDraft, NewStakeholder, StakeholderField>({
    initial: EMPTY,
    validate: validateStakeholder,
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add stakeholder"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Stakeholder name" required error={errors.name}>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              maxLength={NAME_MAX}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="Priya Shah"
            />
          )}
        </Field>
        <Field label="Role">
          {(props) => (
            <Input
              {...props}
              value={draft.role}
              maxLength={NAME_MAX}
              onChange={(e) => update({ role: e.target.value })}
              placeholder="VP of Marketing"
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Place in (optional)" hint="Or drag them onto the map later.">
          {(props) => (
            <select
              {...props}
              value={draft.quadrant}
              onChange={(e) => update({ quadrant: e.target.value as "" | Quadrant })}
              className={SELECT_CLASS}
            >
              <option value="">Not placed yet</option>
              {QUADRANTS.map((q) => (
                <option key={q} value={q}>
                  {QUADRANT_LABEL[q]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Sentiment now (optional)">
          {(props) => (
            <select
              {...props}
              value={draft.current}
              onChange={(e) => update({ current: e.target.value as "" | Sentiment })}
              className={SELECT_CLASS}
            >
              <option value="">Not set</option>
              {SENTIMENTS.map((s) => (
                <option key={s} value={s}>
                  {SENTIMENT_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Sentiment you need (optional)">
          {(props) => (
            <select
              {...props}
              value={draft.desired}
              onChange={(e) => update({ desired: e.target.value as "" | Sentiment })}
              className={SELECT_CLASS}
            >
              <option value="">Not set</option>
              {SENTIMENTS.map((s) => (
                <option key={s} value={s}>
                  {SENTIMENT_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Engagement strategy (optional)">
        {(props) => (
          <Textarea
            {...props}
            value={draft.strategy}
            onChange={(e) => update({ strategy: e.target.value })}
            placeholder="What's the plan? Who owns the relationship?"
            rows={2}
            className="resize-none text-sm"
          />
        )}
      </Field>
    </ItemForm>
  );
}
