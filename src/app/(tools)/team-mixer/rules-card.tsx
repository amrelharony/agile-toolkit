"use client";

import { useId } from "react";
import { Link2, Link2Off, Scale, Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { MIXER_LIMITS, nameKey, type RuleKind } from "@/lib/team-mixer/model";
import { EMPTY_RULE, validateRule, type RuleDraft } from "@/lib/team-mixer/ops";
import type { MixerPersonRow, MixerRule } from "@/lib/team-mixer/state";
import { ruleText } from "@/lib/team-mixer/weights";

const KINDS: ToggleOption<RuleKind>[] = [
  { value: "apart", label: "Keep apart" },
  { value: "together", label: "Keep together" },
];

export interface RulesCardProps {
  rules: readonly MixerRule[];
  people: readonly MixerPersonRow[];
  onAdd: (rule: RuleDraft) => void;
  onRemove: (rule: MixerRule) => void;
}

/**
 * Keep-apart and keep-together rules, two people each, checked before they
 * save. A rule naming someone who isn't in the mix today waits, and says so.
 */
export function RulesCard({ rules, people, onAdd, onRemove }: RulesCardProps) {
  const listId = useId();
  const here = new Set(people.map((p) => nameKey(p.name)));
  const form = useItemForm<RuleDraft, RuleDraft, "a" | "b">({
    initial: EMPTY_RULE,
    validate: (d) => validateRule(d, rules),
    onSave: (values) => onAdd(values),
  });

  return (
    <SectionCard title="Rules" icon={Scale}>
      <div className="space-y-4">
        <p className="text-sm text-sub">
          Keep apart people who shouldn&apos;t share a group, such as a manager and their report.
          Keep the rules few: each one makes the mix less random.
        </p>
        {rules.length > 0 && (
          <ul className="space-y-2" aria-label="Rules">
            {rules.map((r) => {
              const missing = [r.a, r.b].filter((n) => !here.has(nameKey(n)));
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5"
                >
                  {r.kind === "apart" ? (
                    <Link2Off className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
                  ) : (
                    <Link2 className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-text">{ruleText(r)}</p>
                    {missing.length > 0 && (
                      <p className="text-xs text-sub">
                        {missing.join(" and ")} {missing.length === 1 ? "isn't" : "aren't"} in the
                        mix, so this rule waits.
                      </p>
                    )}
                  </div>
                  <IconButton
                    label={`Remove the rule: ${ruleText(r)}`}
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => onRemove(r)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {rules.length < MIXER_LIMITS.rules ? (
          <ItemForm form={form} submitLabel="Add rule" className="space-y-3">
            <ToggleGroup
              label="Rule"
              options={KINDS}
              value={form.draft.kind}
              onValueChange={(kind) => form.update({ kind })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First person" error={form.errors.a}>
                {(props) => (
                  <Input
                    {...props}
                    name="a"
                    list={listId}
                    autoComplete="off"
                    maxLength={MIXER_LIMITS.name}
                    value={form.draft.a}
                    onChange={(e) => form.update({ a: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Second person" error={form.errors.b}>
                {(props) => (
                  <Input
                    {...props}
                    name="b"
                    list={listId}
                    autoComplete="off"
                    maxLength={MIXER_LIMITS.name}
                    value={form.draft.b}
                    onChange={(e) => form.update({ b: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <datalist id={listId}>
              {people.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </ItemForm>
        ) : (
          <p className="text-sm text-sub">
            That&apos;s {MIXER_LIMITS.rules} rules, the most Team Mixer keeps. Remove one to add
            another.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
