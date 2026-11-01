"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import type { CharterRule, CharterRuleCategory } from "@/lib/stores/workspace-types";
import { RULE_DESCRIPTION_MAX, RULE_TEXT_MAX } from "@/lib/working-agreement/model";
import { CATEGORIES } from "./catalog";
import { EMPTY_RULE, validateRule, type RuleDraft, type RuleField, type RuleValues } from "./form";

/**
 * "Add a rule": nothing is saved until the rule has words and isn't one
 * the charter already holds. Enter in the text adds it.
 */
export function AddRuleForm({
  rules,
  onAdd,
}: {
  rules: readonly CharterRule[];
  onAdd: (values: RuleValues) => void;
}) {
  const form = useItemForm<RuleDraft, RuleValues, RuleField>({
    initial: EMPTY_RULE,
    validate: (d) => validateRule(d, rules),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add rule"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Category">
          {(props) => (
            <Select
              value={draft.category}
              onValueChange={(v) => update({ category: v as CharterRuleCategory })}
            >
              <SelectTrigger {...props}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Rule" error={errors.text} required>
          {(props) => (
            <Input
              {...props}
              value={draft.text}
              maxLength={RULE_TEXT_MAX}
              onChange={(e) => update({ text: e.target.value })}
              placeholder="e.g. PRs are reviewed within one working day"
            />
          )}
        </Field>
      </div>
      <Field label="Description (optional)" error={errors.description}>
        {(props) => (
          <Textarea
            {...props}
            value={draft.description}
            maxLength={RULE_DESCRIPTION_MAX}
            rows={2}
            className="resize-none text-xs"
            onChange={(e) => update({ description: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                form.submit();
              }
            }}
          />
        )}
      </Field>
    </ItemForm>
  );
}
