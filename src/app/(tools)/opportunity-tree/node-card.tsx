"use client";

/**
 * One node on the tree: its kind, text, notes and evidence (edited in
 * place), where it came from (an interview quote), the target flag on an
 * opportunity, an "Add …" per kind it can hold (an opportunity holds
 * sub-opportunities and solutions), and on an experiment "Test as a
 * hypothesis" or where that test stands. Delete asks first when the node
 * has anything under it; the page offers Undo either way.
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { FlaskConical, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { SourceLink } from "@/components/handoff/source-link";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import type { LinkedTest } from "@/lib/hypotheses/model";
import { CHILD_KINDS, nodeTitle } from "@/lib/opportunity-tree/model";
import type { TreeNode, TreeNodeKind } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import type { NodeValues } from "./form";
import { AddNodeForm, NodeEditor } from "./node-form";
import { KIND_LABEL, KIND_TONE, addLabel, kindOf, testLabel } from "./view";

export interface NodeCardProps {
  node: TreeNode;
  /** An experiment's hypothesis, read from the tracker. */
  test: LinkedTest;
  example: boolean;
  onSave: (node: TreeNode, values: NodeValues) => void;
  onAdd: (parent: TreeNode, kind: TreeNodeKind, values: NodeValues) => void;
  onToggleTarget: (node: TreeNode) => void;
  onTest: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}

type Mode = { name: "view" } | { name: "edit" } | { name: "add"; kind: TreeNodeKind };

export function NodeCard({
  node,
  test,
  example,
  onSave,
  onAdd,
  onToggleTarget,
  onTest,
  onDelete,
}: NodeCardProps) {
  const [mode, setMode] = useState<Mode>({ name: "view" });
  const titleId = useId();
  const kind = kindOf(node);
  const title = nodeTitle(node);
  const tone = KIND_TONE[kind];
  const editRef = useRef<HTMLButtonElement>(null);
  const addRefs = useRef<Partial<Record<TreeNodeKind, HTMLButtonElement | null>>>({});
  const returnTo = useRef<"edit" | TreeNodeKind | null>(null);

  // Back to the control that opened the editor or the add form.
  useEffect(() => {
    if (mode.name !== "view" || !returnTo.current) return;
    const to = returnTo.current;
    returnTo.current = null;
    (to === "edit" ? editRef.current : addRefs.current[to])?.focus();
  }, [mode]);

  const close = (to: "edit" | TreeNodeKind) => {
    returnTo.current = to;
    setMode({ name: "view" });
  };

  if (mode.name === "edit") {
    return (
      <NodeEditor
        node={node}
        kind={kind}
        onSave={(values) => {
          onSave(node, values);
          close("edit");
        }}
        onCancel={() => close("edit")}
      />
    );
  }

  const sent = test.state !== "none";
  const hypothesisHref = sent ? getHandoffRoute("hypothesis").targetHref(test.hypothesisId) : "";

  return (
    <>
      <article
        aria-labelledby={titleId}
        className={cn(
          "space-y-2 rounded-lg border border-l-4 border-border bg-card p-3",
          tone.edge
        )}
      >
        <div className="flex items-start gap-2">
          <span
            className={cn("shrink-0 rounded px-1.5 py-0.5 font-data text-xs uppercase", tone.chip)}
          >
            {KIND_LABEL[kind]}
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="break-words text-sm font-medium text-text">
              {title}
              {node.target && kind === "opportunity" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 align-middle text-xs font-normal text-accent">
                  <Target className="h-3 w-3" aria-hidden="true" />
                  Target opportunity
                </span>
              )}
            </h3>
            {node.description && (
              <p className="mt-0.5 whitespace-pre-line break-words text-xs text-sub">
                {node.description}
              </p>
            )}
            {node.evidence && (
              <p className="mt-0.5 break-words text-xs text-sub">
                <span className="text-text">Evidence: </span>
                {node.evidence}
              </p>
            )}
            {/* Raised from another tool: an interview quote. */}
            <SourceLink sourceRef={node.sourceRef} className="mt-1" />
          </div>
          <div className="flex shrink-0 items-center">
            <IconButton
              ref={editRef}
              label={`Edit ${title}`}
              icon={<Pencil className="h-4 w-4" />}
              className="text-sub hover:text-text"
              data-node-edit={node.id}
              onClick={() => setMode({ name: "edit" })}
            />
            <IconButton
              label={`Delete ${title}`}
              icon={<Trash2 className="h-4 w-4" />}
              className="text-sub hover:text-danger"
              onClick={() => onDelete(node)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {kind === "opportunity" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={Boolean(node.target)}
              aria-label={`Target: ${title}`}
              className={cn(
                "min-touch-coarse gap-1 text-xs",
                node.target ? "text-accent hover:bg-accent/10" : "text-sub hover:bg-accent/10"
              )}
              onClick={() => onToggleTarget(node)}
            >
              <Target className="h-4 w-4" aria-hidden="true" />
              Target
            </Button>
          )}
          {(CHILD_KINDS[kind] ?? []).map((child) => (
            <Button
              key={child}
              ref={(el) => {
                addRefs.current[child] = el;
              }}
              type="button"
              size="sm"
              variant="ghost"
              className="min-touch-coarse gap-1 text-xs text-sub hover:bg-accent/10 hover:text-text"
              aria-label={`${addLabel(kind, child)} under ${title}`}
              onClick={() => setMode({ name: "add", kind: child })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {addLabel(kind, child)}
            </Button>
          ))}
          {kind === "experiment" &&
            (sent ? (
              <Link
                href={hypothesisHref}
                className={cn(
                  "inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline",
                  test.state === "tested" ? "text-success" : "text-accent"
                )}
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                {testLabel(test)} · Open
              </Link>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 text-xs"
                  disabled={example}
                  aria-label={`Test ${title} as a hypothesis`}
                  onClick={() => onTest(node)}
                >
                  <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  Test as a hypothesis
                </Button>
                {example && (
                  <span className="text-xs text-sub">
                    Example experiments stay out of the Hypothesis Tracker.
                  </span>
                )}
              </>
            ))}
        </div>
      </article>
      {mode.name === "add" && (
        <AddNodeForm
          kind={mode.kind}
          parent={node}
          onAdd={(values) => {
            onAdd(node, mode.kind, values);
            close(mode.kind);
          }}
          onCancel={() => close(mode.kind)}
        />
      )}
    </>
  );
}
