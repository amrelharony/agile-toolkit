"use client";

/**
 * Reviews: "Suggest a focus" (no AI: an unmeasured area first, else the
 * weakest, with a summary from the numbers and our next steps) fills the
 * form, and nothing is saved until "Record the review". The list shows
 * the newest first, each with its areas' scores then.
 */

import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EBM_VALUE_AREAS, type EbmReview, type EbmValueArea } from "@/lib/stores/workspace-types";
import {
  AREA_LABEL,
  REVIEW_NOTE_MAX,
  REVIEWS_MAX,
  scoreText,
  validateReview,
  type ReviewDraft,
  type ReviewField,
  type ReviewValues,
  type RuleReview,
} from "@/lib/ebm/model";
import { SELECT_CLASS } from "@/app/(tools)/product-metrics/metric-form";

export function ReviewPanel({
  reviews,
  today,
  suggest,
  onRecord,
}: {
  /** Newest first. */
  reviews: readonly EbmReview[];
  today: string;
  suggest: () => RuleReview;
  onRecord: (values: ReviewValues) => void;
}) {
  const form = useItemForm<ReviewDraft, ReviewValues, ReviewField>({
    initial: { date: today, focus: "", note: "" },
    validate: (d) => validateReview(d, today),
    onSave: onRecord,
  });
  const { draft, update, errors } = form;
  const fill = () => {
    const r = suggest();
    update({
      focus: r.focus,
      note: [r.summary, ...r.steps].join("\n").slice(0, REVIEW_NOTE_MAX),
    });
  };
  return (
    <section aria-label="Reviews" className="space-y-3">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-text">Record a review</h3>
          <Button type="button" size="sm" variant="outline" onClick={fill}>
            Suggest a focus
          </Button>
        </div>
        <ItemForm form={form} submitLabel="Record the review">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Day" error={errors.date} required>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  max={today}
                  value={draft.date}
                  onChange={(e) => update({ date: e.target.value })}
                />
              )}
            </Field>
            <Field label="Area to focus on next" error={errors.focus} required>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={draft.focus}
                  onChange={(e) => update({ focus: e.target.value as EbmValueArea | "" })}
                >
                  <option value="">Pick an area</option>
                  {EBM_VALUE_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {AREA_LABEL[a]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Note" hint="What you saw and what you'll try." error={errors.note}>
            {(props) => (
              <Textarea
                {...props}
                rows={4}
                maxLength={REVIEW_NOTE_MAX}
                value={draft.note}
                onChange={(e) => update({ note: e.target.value })}
              />
            )}
          </Field>
        </ItemForm>
      </div>
      {reviews.length > 0 ? (
        <ul className="space-y-2" aria-label="Past reviews">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium text-text">
                {r.date}: focus on {AREA_LABEL[r.focus]}
              </p>
              <p className="text-xs text-sub">
                {EBM_VALUE_AREAS.map((a) => `${AREA_LABEL[a]} ${scoreText(r.areas[a])}`).join(
                  " · "
                )}
              </p>
              {r.note && <p className="mt-1 whitespace-pre-line break-words text-text">{r.note}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-sub">No review yet. The newest {REVIEWS_MAX} are kept.</p>
      )}
    </section>
  );
}
