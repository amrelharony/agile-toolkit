"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type {
  DependencyEdge,
  DependencyNode,
  DependencyStatus,
} from "@/lib/stores/workspace-types";
import {
  DEPENDENCY_STATUSES,
  DEPENDENCY_STATUS_LABEL,
  edgeStatus,
  findNodeByLabel,
} from "@/lib/dependencies/edges";
import type { Validation } from "@/lib/utils/form";
import { ChoiceField, SelectField } from "./fields";
import { EDGE_KINDS, KIND_MEANING, type EdgeKind } from "./graph";

/** The map's own caps: a pasted essay shouldn't blow the storage quota. */
export const LABEL_MAX = 240;
export const TEAM_MAX = 120;
export const TEXT_MAX = 2000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Nodes ──────────────────────────────────────────────────────────── */

export interface NodeDraft {
  label: string;
  team: string;
  description: string;
}
export type NodeValues = { label: string; team?: string; description?: string };
type NodeField = keyof NodeDraft;

export const EMPTY_NODE: NodeDraft = { label: "", team: "", description: "" };

export function nodeDraftFrom(n: DependencyNode): NodeDraft {
  return { label: n.label, team: n.team ?? "", description: n.description ?? "" };
}

/**
 * A node needs a name, and one the map doesn't have yet: PI Planning and
 * Scrum of Scrums find a side by its name, so two "Payments" nodes would
 * split one team's dependencies in two.
 */
export function validateNode(
  d: NodeDraft,
  nodes: readonly DependencyNode[],
  selfId?: string
): Validation<NodeValues, NodeField> {
  const label = d.label.trim();
  if (!label) return { ok: false, errors: { label: "Name the team, service or deliverable." } };
  const clash = findNodeByLabel(nodes, label);
  if (clash && clash.id !== selfId) {
    return { ok: false, errors: { label: `“${clash.label}” is already on the map.` } };
  }
  const team = d.team.trim();
  const description = d.description.trim();
  return {
    ok: true,
    values: {
      label: label.slice(0, LABEL_MAX),
      ...(team ? { team: team.slice(0, TEAM_MAX) } : {}),
      ...(description ? { description: description.slice(0, TEXT_MAX) } : {}),
    },
  };
}

function NodeFields({ form }: { form: ItemFormState<NodeDraft, NodeField> }) {
  const { draft, update, errors } = form;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_14rem]">
        <Field label="Name" error={errors.label} required>
          {(props) => (
            <Input
              {...props}
              maxLength={LABEL_MAX}
              value={draft.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="Team, service, epic or story"
            />
          )}
        </Field>
        <Field label="Owning team" hint="Optional">
          {(props) => (
            <Input
              {...props}
              maxLength={TEAM_MAX}
              value={draft.team}
              onChange={(e) => update({ team: e.target.value })}
              placeholder="e.g. Payments"
            />
          )}
        </Field>
      </div>
      <Field label="Description" hint="Optional">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={TEXT_MAX}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            className="resize-none"
          />
        )}
      </Field>
    </>
  );
}

export function NodeAddForm({
  nodes,
  onAdd,
}: {
  nodes: readonly DependencyNode[];
  onAdd: (values: NodeValues) => void;
}) {
  const form = useItemForm<NodeDraft, NodeValues, NodeField>({
    initial: EMPTY_NODE,
    validate: (d) => validateNode(d, nodes),
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add node"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <NodeFields form={form} />
    </ItemForm>
  );
}

export function NodeEditor({
  node,
  nodes,
  onSave,
  onCancel,
}: {
  node: DependencyNode;
  nodes: readonly DependencyNode[];
  onSave: (values: NodeValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<NodeDraft, NodeValues, NodeField>({
    initial: () => nodeDraftFrom(node),
    validate: (d) => validateNode(d, nodes, node.id),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <NodeFields form={form} />
    </ItemForm>
  );
}

/* ── Edges ──────────────────────────────────────────────────────────── */

export interface EdgeDraft {
  from: string;
  to: string;
  kind: EdgeKind | null;
  status: DependencyStatus;
  owner: string;
  due: string;
  note: string;
}
export interface EdgeValues {
  from: string;
  to: string;
  kind: EdgeKind;
  status: DependencyStatus;
  owner?: string;
  due?: string;
  note?: string;
}
type EdgeField = keyof EdgeDraft;

/** A new dependency is open: that's what "new" means, not a hidden default. */
export const EMPTY_EDGE: EdgeDraft = {
  from: "",
  to: "",
  kind: null,
  status: "open",
  owner: "",
  due: "",
  note: "",
};

export function edgeDraftFrom(e: DependencyEdge): EdgeDraft {
  return {
    from: e.from,
    to: e.to,
    kind: e.kind,
    status: edgeStatus(e),
    owner: e.owner ?? "",
    due: e.due ?? "",
    note: e.note ?? "",
  };
}

/**
 * Both sides, two different ones, and a type; never a second copy of an
 * edge already drawn (it would count twice in the critical path). A due
 * date in the past is fine: that's how an overdue dependency is recorded.
 */
export function validateEdge(
  d: EdgeDraft,
  edges: readonly DependencyEdge[],
  selfId?: string
): Validation<EdgeValues, EdgeField> {
  const errors: Partial<Record<EdgeField, string>> = {};
  if (!d.from) errors.from = "Choose the first side.";
  if (!d.to) errors.to = "Choose the second side.";
  else if (d.to === d.from) errors.to = "Choose a different side: a node can't depend on itself.";
  if (!d.kind) errors.kind = "Pick a type.";
  if (d.due && !DAY.test(d.due)) errors.due = "Use a date like 2026-11-02.";
  if (!errors.from && !errors.to && d.kind) {
    const twin = edges.find(
      (e) => e.id !== selfId && e.from === d.from && e.to === d.to && e.kind === d.kind
    );
    if (twin) {
      errors.kind =
        edgeStatus(twin) === "resolved"
          ? "This dependency is already on the map, resolved. Reopen it instead."
          : "This dependency is already on the map.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const owner = d.owner.trim();
  const note = d.note.trim();
  return {
    ok: true,
    values: {
      from: d.from,
      to: d.to,
      kind: d.kind as EdgeKind,
      status: d.status,
      ...(owner ? { owner: owner.slice(0, TEAM_MAX) } : {}),
      ...(d.due ? { due: d.due } : {}),
      ...(note ? { note: note.slice(0, TEXT_MAX) } : {}),
    },
  };
}

const KIND_OPTIONS = EDGE_KINDS.map((k) => ({ value: k, label: k, description: KIND_MEANING[k] }));
const STATUS_OPTIONS = DEPENDENCY_STATUSES.map((s) => ({
  value: s,
  label: DEPENDENCY_STATUS_LABEL[s],
}));

/** Owner, due date and note: the same in the add form and the editor. */
function EdgeDetails({ form }: { form: ItemFormState<EdgeDraft, EdgeField> }) {
  const { draft, update, errors } = form;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PersonPicker
          label="Owner"
          hint="Who chases it. Optional."
          value={draft.owner}
          onChange={(owner) => update({ owner })}
        />
        <Field label="Due" hint="When it must be resolved by. Optional." error={errors.due}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.due}
              onChange={(e) => update({ due: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Note" hint="Optional">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={TEXT_MAX}
            value={draft.note}
            onChange={(e) => update({ note: e.target.value })}
            className="resize-none"
          />
        )}
      </Field>
    </>
  );
}

export function EdgeAddForm({
  nodes,
  edges,
  onAdd,
}: {
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
  onAdd: (values: EdgeValues) => void;
}) {
  const form = useItemForm<EdgeDraft, EdgeValues, EdgeField>({
    initial: EMPTY_EDGE,
    validate: (d) => validateEdge(d, edges),
    onSave: onAdd,
  });
  const { draft, update, errors } = form;
  const options = nodes.map((n) => ({ value: n.id, label: n.label }));
  const label = (id: string) => nodes.find((n) => n.id === id)?.label;
  const reads =
    draft.from && draft.to && draft.kind && draft.from !== draft.to
      ? `${label(draft.from)} ${draft.kind} ${label(draft.to)}.`
      : null;
  return (
    <ItemForm
      form={form}
      submitLabel="Add dependency"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[1fr_auto_1fr]">
        <SelectField
          label="From"
          required
          placeholder="Choose a node"
          options={options}
          value={draft.from}
          onChange={(from) => update({ from })}
          error={errors.from}
        />
        <ChoiceField
          label="Type"
          required
          options={KIND_OPTIONS}
          value={draft.kind}
          onChange={(kind) => update({ kind })}
          error={errors.kind}
        />
        <SelectField
          label="To"
          required
          placeholder="Choose a node"
          options={options}
          value={draft.to}
          onChange={(to) => update({ to })}
          error={errors.to}
        />
      </div>
      {/* Read back as a sentence: "needs" and "blocks" point opposite ways. */}
      <p className="min-h-5 text-xs text-sub" aria-live="polite">
        {reads && `Reads: ${reads}`}
      </p>
      <EdgeDetails form={form} />
    </ItemForm>
  );
}

export function EdgeEditor({
  edge,
  edges,
  sides,
  onSave,
  onCancel,
}: {
  edge: DependencyEdge;
  edges: readonly DependencyEdge[];
  /** The two nodes' names, so the editor reads "Checkout needs Payments API". */
  sides: { from: string; to: string };
  onSave: (values: EdgeValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<EdgeDraft, EdgeValues, EdgeField>({
    initial: () => edgeDraftFrom(edge),
    validate: (d) => validateEdge(d, edges, edge.id),
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <p className="text-sm font-medium text-text">
        {sides.from} {draft.kind} {sides.to}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <ChoiceField
          label="Type"
          options={KIND_OPTIONS}
          value={draft.kind}
          onChange={(kind) => update({ kind })}
          error={errors.kind}
        />
        <ChoiceField
          label="Status"
          options={STATUS_OPTIONS}
          value={draft.status}
          onChange={(status) => update({ status })}
        />
      </div>
      <EdgeDetails form={form} />
    </ItemForm>
  );
}
