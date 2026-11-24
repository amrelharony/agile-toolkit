"use client";

/**
 * One part of a strategy map: its level, text, detail, measure, owner and
 * (on a strategy tree) status and note, edited in place; an "Add <next
 * level>" button while the map has room; Edit and Delete. The page passes
 * what is its own: the actions row (send, focus, test), chips (a persona,
 * a test's state) and extra form fields. Delete calls `onDelete`, which
 * asks first for a part with anything under it and offers Undo. Its
 * controls (Edit and Delete, the actions row, the add form) are marked
 * EXPORT_SKIP, so the page's PNG shows the parts and not the buttons.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { StrategyMapFormat, StrategyMapNode } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { STATUS_LABEL, hasStatus, levelOf } from "@/lib/strategy-map/formats";
import {
  childLevel,
  emptyNodeDraft,
  nodeDraftFrom,
  nodeTitle,
  type NodeDraft,
  type NodeField,
  type NodeValues,
} from "@/lib/strategy-map/model";
import { cn } from "@/lib/utils";
import { EXPORT_SKIP } from "@/lib/utils/export-skip";
import { NodeForm, type NodeFormState } from "./node-form";

/** Theme tones per level: the card's edge and its chip. The chip's text names the level too. */
export const LEVEL_TONE = [
  { edge: "border-l-accent", chip: "bg-accent/10 text-accent" },
  { edge: "border-l-info", chip: "bg-info/10 text-info" },
  { edge: "border-l-success", chip: "bg-success/10 text-success" },
  { edge: "border-l-warning", chip: "bg-warning/10 text-warning" },
] as const;

const STATUS_TONE = {
  proposed: "text-sub",
  agreed: "text-success",
  questioned: "text-warning",
  dropped: "text-sub line-through",
} as const;

export interface NodeCardProps {
  format: StrategyMapFormat;
  node: StrategyMapNode;
  /** Whether a part can go under it now (not the last level, the map not full). */
  canAdd: boolean;
  /** An example part takes nothing new: "Clear example" would leave it orphaned. */
  example: boolean;
  validate: (draft: NodeDraft, level: number) => Validation<NodeValues, NodeField>;
  onSave: (node: StrategyMapNode, values: NodeValues) => void;
  onAdd: (parent: StrategyMapNode, values: NodeValues) => void;
  onDelete: (node: StrategyMapNode) => void;
  /** The page's own buttons for this part. */
  actions?: ReactNode;
  /** Chips beside the title (a focus mark, a persona). */
  badges?: ReactNode;
  /** Lines under the text (where it went, a test's state). */
  footer?: ReactNode;
  /** A tool's own fields in the add and edit forms, by the form's level. */
  extraFields?: (form: NodeFormState, level: number) => ReactNode;
  /** Marks the card as the map's focus path. */
  highlight?: boolean;
  /** The label of the "Add …" button when it should differ from "Add <next level>". */
  addLabel?: string;
  /**
   * Opens the add form with this text in it (Impact Map's "Use" on a
   * suggested deliverable); `n` changes on each use. Nothing is saved until Add.
   */
  addDraft?: { text: string; n: number } | null;
  /**
   * The add form closed (added or cancelled). A page that passes `addDraft`
   * drops it here: the card opens its form from a draft on mount too, so a
   * draft kept after Cancel would open the form again when the card is
   * drawn again (another view, another map and back).
   */
  onAddClose?: () => void;
}

type Mode = "view" | "edit" | "add";

export function NodeCard({
  format,
  node,
  canAdd,
  example,
  validate,
  onSave,
  onAdd,
  onDelete,
  actions,
  badges,
  footer,
  extraFields,
  highlight,
  addLabel,
  addDraft,
  onAddClose,
}: NodeCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [prefill, setPrefill] = useState<{ text: string; n: number } | null>(null);
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<"edit" | "add" | null>(null);
  const lvl = levelOf(format, node.level);
  const next = childLevel(node);
  const nextLabel = next !== null ? levelOf(format, next).label : "";
  const title = nodeTitle(node, format);
  const tone = LEVEL_TONE[Math.min(Math.max(node.level, 0), 3)];

  // Back to the control that opened the editor or the add form.
  useEffect(() => {
    if (mode !== "view" || !returnTo.current) return;
    const to = returnTo.current;
    returnTo.current = null;
    (to === "edit" ? editRef.current : addRef.current)?.focus();
  }, [mode]);

  // A suggestion's "Use": the add form opens (again) with its text.
  const draftN = addDraft?.n;
  useEffect(() => {
    if (!addDraft) return;
    setPrefill(addDraft);
    setMode("add");
    // Only a new use (its n) opens the form again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftN]);

  const close = (to: "edit" | "add") => {
    returnTo.current = to;
    setPrefill(null);
    setMode("view");
    if (to === "add") onAddClose?.();
  };

  if (mode === "edit") {
    return (
      <NodeForm
        format={format}
        level={node.level}
        initial={() => nodeDraftFrom(node)}
        validate={(d) => validate(d, node.level)}
        onSave={(values) => {
          onSave(node, values);
          close("edit");
        }}
        onCancel={() => close("edit")}
        submitLabel="Save"
        label={`Edit ${lvl.label.toLowerCase()} “${title}”`}
        extraFields={extraFields ? (f) => extraFields(f, node.level) : undefined}
      />
    );
  }

  const add = addLabel ?? `Add ${nextLabel.toLowerCase()}`;
  return (
    <>
      <article
        aria-labelledby={titleId}
        data-node={node.id}
        className={cn(
          "min-w-0 space-y-2 rounded-lg border border-l-4 border-border bg-card p-3",
          tone.edge,
          highlight && "ring-1 ring-accent/40"
        )}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* The level's chip sits on its own line above the title: beside it, a long
                level ("Improvement priority") left the title a few characters wide on a phone. */}
            <span
              className={cn(
                "inline-block max-w-full break-words rounded px-1.5 py-0.5 font-data text-xs uppercase",
                tone.chip
              )}
            >
              {lvl.label}
            </span>
            <h3 id={titleId} className="mt-1 break-words text-sm font-medium text-text">
              {title}
              {badges}
            </h3>
            {node.measure && (
              <p className="mt-0.5 break-words text-xs text-sub">
                <span className="text-text">Measure: </span>
                {node.measure}
              </p>
            )}
            {node.owner && (
              <p className="mt-0.5 break-words text-xs text-sub">
                <span className="text-text">Owner: </span>
                {node.owner}
              </p>
            )}
            {node.detail && (
              <p className="mt-0.5 whitespace-pre-line break-words text-xs text-sub">
                {node.detail}
              </p>
            )}
            {hasStatus(format) && (
              <p className={cn("mt-0.5 text-xs", STATUS_TONE[node.status ?? "proposed"])}>
                {STATUS_LABEL[node.status ?? "proposed"]}
                {node.note && <span className="text-sub no-underline">: {node.note}</span>}
              </p>
            )}
            {footer}
          </div>
          <div {...EXPORT_SKIP} className="flex shrink-0 items-center">
            <IconButton
              ref={editRef}
              label={`Edit ${title}`}
              icon={<Pencil className="h-4 w-4" />}
              className="text-sub hover:text-text"
              data-node-edit={node.id}
              onClick={() => setMode("edit")}
            />
            <IconButton
              label={`Delete ${title}`}
              icon={<Trash2 className="h-4 w-4" />}
              className="text-sub hover:text-danger"
              onClick={() => onDelete(node)}
            />
          </div>
        </div>
        {(next !== null || actions) && (
          <div {...EXPORT_SKIP} className="flex flex-wrap items-center gap-1.5">
            {next !== null && (
              <Button
                ref={addRef}
                type="button"
                size="sm"
                variant="ghost"
                className="min-touch-coarse gap-1 text-xs text-sub hover:bg-accent/10 hover:text-text"
                disabled={!canAdd || example}
                aria-label={`${add} under ${title}`}
                onClick={() => setMode("add")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {add}
              </Button>
            )}
            {actions}
          </div>
        )}
      </article>
      {mode === "add" && next !== null && (
        <div {...EXPORT_SKIP}>
          <NodeForm
            key={prefill?.n ?? "add"}
            format={format}
            level={next}
            initial={() => ({ ...emptyNodeDraft(format), text: prefill?.text ?? "" })}
            validate={(d) => validate(d, next)}
            onSave={(values) => {
              onAdd(node, values);
              close("add");
            }}
            onCancel={() => close("add")}
            submitLabel={`Add ${nextLabel.toLowerCase()}`}
            label={`New ${nextLabel.toLowerCase()} under “${title}”`}
            extraFields={extraFields ? (f) => extraFields(f, next) : undefined}
          />
        </div>
      )}
    </>
  );
}
