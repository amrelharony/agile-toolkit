"use client";

import type { RefObject } from "react";
import { History, Tag } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { ExportButton } from "@/components/shared/export-button";
import type { SixHatsHat, SixHatsThought } from "@/lib/stores/workspace-types";
import { plural } from "@/lib/charts/chart-text";
import type { Validation } from "@/lib/utils/form";
import { toMarkdown } from "./markdown";
import { TOPIC_MAX } from "./session";
import { ThoughtColumns } from "./thought-columns";

function validateTopic(d: { topic: string }): Validation<string, "topic"> {
  const topic = d.topic.replace(/\s+/g, " ").trim();
  if (!topic) return { ok: false, errors: { topic: "Enter the topic these thoughts were about." } };
  if (topic.length > TOPIC_MAX)
    return { ok: false, errors: { topic: `Keep the topic under ${TOPIC_MAX} characters.` } };
  return { ok: true, values: topic };
}

/**
 * Thoughts that belong to no session: logged before sessions existed, or
 * left when an agent deleted their session. They stay where they were, and
 * "Give these a topic" turns them into a session of their own (with Undo).
 */
export function EarlierThoughts({
  thoughts,
  exportRef,
  onAdopt,
  onEdit,
  onMove,
  onRemove,
}: {
  thoughts: readonly SixHatsThought[];
  exportRef: RefObject<HTMLDivElement>;
  onAdopt: (topic: string) => void;
  onEdit: (t: SixHatsThought, text: string) => void;
  onMove: (t: SixHatsThought, hat: SixHatsHat) => void;
  onRemove: (t: SixHatsThought) => void;
}) {
  const form = useItemForm<{ topic: string }, string, "topic">({
    initial: { topic: "" },
    validate: validateTopic,
    onSave: onAdopt,
  });

  return (
    <SectionCard
      title={`Earlier thoughts (${thoughts.length})`}
      icon={History}
      actions={
        <ExportButton
          filename="six-hats-earlier-thoughts"
          csvData={{
            headers: ["Hat", "Thought", "Logged"],
            rows: thoughts.map((t) => [t.hat, t.text, t.loggedAt]),
          }}
          jsonData={thoughts}
          markdown={toMarkdown(null, thoughts)}
          targetRef={exportRef}
        />
      }
    >
      <p className="mb-3 text-sm text-sub">
        {plural(thoughts.length, "thought")} from before sessions, with no topic. Give them one to
        keep them together as a session.
      </p>
      <ItemForm
        form={form}
        submitLabel="Give these a topic"
        submitIcon={<Tag className="h-4 w-4" aria-hidden="true" />}
        className="mb-4"
      >
        <Field label="Topic of these thoughts" error={form.errors.topic} required>
          {(props) => (
            <Input
              {...props}
              value={form.draft.topic}
              maxLength={TOPIC_MAX}
              onChange={(e) => form.update({ topic: e.target.value })}
              placeholder="e.g. Rewrite the billing service?"
            />
          )}
        </Field>
      </ItemForm>
      <ThoughtColumns
        order={null}
        thoughts={thoughts}
        regionPrefix="Earlier thoughts: "
        onEdit={onEdit}
        onMove={onMove}
        onRemove={onRemove}
      />
    </SectionCard>
  );
}
