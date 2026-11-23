"use client";

/**
 * The goal ladder: the strategic goal (typed here, with why it matters),
 * the intermediate goal (the active Product Goal) and the immediate
 * tactical goal (the sprint's). The framework's own names, our wording.
 */

import { useState } from "react";
import Link from "next/link";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  STRATEGIC_GOAL_MAX,
  STRATEGIC_WHY_MAX,
  validateStrategicGoal,
  type GoalLadder,
  type StrategicDraft,
} from "@/lib/ebm/model";

export function LadderCard({
  ladder,
  onSave,
}: {
  ladder: GoalLadder;
  onSave: (values: { goal?: string; why?: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-label="Goals" className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-sub">Strategic goal</h3>
        {editing ? (
          <StrategicForm
            initial={{ goal: ladder.strategic?.goal ?? "", why: ladder.strategic?.why ?? "" }}
            onSave={(v) => {
              onSave(v);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm text-text">
                {ladder.strategic?.goal ??
                  "Not written yet: the change in the world the product is for."}
              </p>
              {ladder.strategic?.why && (
                <p className="break-words text-xs text-sub">Why: {ladder.strategic.why}</p>
              )}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              {ladder.strategic ? "Edit" : "Write it"}
              <span className="sr-only"> the strategic goal</span>
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-sub">Intermediate goal: the Product Goal</h3>
        {ladder.intermediate ? (
          <p className="break-words text-sm text-text">{ladder.intermediate.statement}</p>
        ) : (
          <p className="text-sm text-sub">
            No Product Goal is active.{" "}
            <Link href="/product-goal" className="text-accent hover:underline">
              Write one
            </Link>
          </p>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-sub">Immediate tactical goal: the sprint&apos;s</h3>
        <p className="break-words text-sm text-text">
          {ladder.tactical
            ? `${ladder.tactical.goal} (${ladder.tactical.sprintName})`
            : "No sprint goal yet."}
        </p>
      </div>
    </section>
  );
}

function StrategicForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: StrategicDraft;
  onSave: (values: { goal?: string; why?: string }) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<StrategicDraft, { goal?: string; why?: string }, keyof StrategicDraft>({
    initial,
    validate: validateStrategicGoal,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Save the goal" onCancel={onCancel}>
      <Field label="Strategic goal" hint="Leave it blank to clear it." error={errors.goal}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={STRATEGIC_GOAL_MAX}
            value={draft.goal}
            onChange={(e) => update({ goal: e.target.value })}
          />
        )}
      </Field>
      <Field label="Why it matters" error={errors.why}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={STRATEGIC_WHY_MAX}
            value={draft.why}
            onChange={(e) => update({ why: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}
