"use client";

/**
 * Adding a node under another (or an outcome at the top) and editing one
 * in place. Nothing is saved without its text; Enter saves, Escape
 * cancels, and focus goes back to what opened the form.
 */

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NODE_TEXT_MAX, nodeTitle } from "@/lib/opportunity-tree/model";
import type { TreeNode, TreeNodeKind } from "@/lib/stores/workspace-types";
import {
  HAS_EVIDENCE,
  TEXT_PROMPT,
  emptyNodeDraft,
  nodeDraftFrom,
  validateNode,
  type NodeDraft,
  type NodeField,
  type NodeValues,
} from "./form";
import { KIND_LABEL } from "./view";

const capFor = (stored: string | undefined) => Math.max(NODE_TEXT_MAX, (stored ?? "").length);

function NodeFields({
  form,
  kind,
  stored,
}: {
  form: ItemFormState<NodeDraft, NodeField>;
  kind: TreeNodeKind;
  stored?: TreeNode;
}) {
  const { draft, update, errors } = form;
  const prompt = TEXT_PROMPT[kind] ?? TEXT_PROMPT.outcome;
  const evidence = HAS_EVIDENCE.has(kind) || Boolean(stored?.evidence);
  return (
    <>
      <Field label={prompt.label} error={errors.text} required>
        {(props) => (
          <Input
            {...props}
            maxLength={capFor(stored?.text)}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder={prompt.placeholder}
          />
        )}
      </Field>
      <div className={evidence ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : undefined}>
        <Field label="Description" hint="Optional." error={errors.description}>
          {(props) => (
            <Input
              {...props}
              maxLength={capFor(stored?.description)}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          )}
        </Field>
        {evidence && (
          <Field
            label="Evidence"
            hint={
              kind === "experiment"
                ? "Optional. What the test showed."
                : "Optional. Who said it, the data."
            }
            error={errors.evidence}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={capFor(stored?.evidence)}
                value={draft.evidence}
                onChange={(e) => update({ evidence: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>
    </>
  );
}

/** Add a `kind` node under `parent` (null: the top of the tree). */
export function AddNodeForm({
  kind,
  parent,
  onAdd,
  onCancel,
}: {
  kind: TreeNodeKind;
  parent: TreeNode | null;
  onAdd: (values: NodeValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<NodeDraft, NodeValues, NodeField>({
    initial: emptyNodeDraft,
    validate: (d) => validateNode(d, kind, { parent }),
    onSave: onAdd,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  const where = parent ? ` under “${nodeTitle(parent)}”` : "";
  return (
    <div
      role="group"
      aria-label={`New ${KIND_LABEL[kind].toLowerCase()}${where}`}
      className="rounded-lg border border-accent/40 bg-card p-3"
    >
      <ItemForm
        form={form}
        submitLabel={`Add ${KIND_LABEL[kind].toLowerCase()}`}
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={onCancel}
      >
        <NodeFields form={form} kind={kind} />
      </ItemForm>
    </div>
  );
}

export function NodeEditor({
  node,
  kind,
  onSave,
  onCancel,
}: {
  node: TreeNode;
  kind: TreeNodeKind;
  onSave: (values: NodeValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<NodeDraft, NodeValues, NodeField>({
    initial: () => nodeDraftFrom(node),
    validate: (d) => validateNode(d, kind, { stored: node }),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <div
      role="group"
      aria-label={`Edit ${KIND_LABEL[kind].toLowerCase()} “${nodeTitle(node)}”`}
      className="rounded-lg border border-accent/40 bg-card p-3"
    >
      <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
        <NodeFields form={form} kind={kind} stored={node} />
      </ItemForm>
    </div>
  );
}
