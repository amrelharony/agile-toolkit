"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FlaskConical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import type { CynefinDomain, CynefinItem } from "@/lib/stores/workspace-types";
import {
  ANSWER_LABEL,
  DOMAINS,
  DOMAIN_IDS,
  QUESTIONS,
  RATIONALE_MAX,
  TITLE_MAX,
  hypothesisLinkOf,
  normalizeAnswers,
  normalizeDomain,
  planOf,
  type HypothesisState,
} from "@/lib/cynefin/model";
import { isExampleId } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { DOMAIN_TONE } from "./sense-form";

/**
 * Why the item sits where it does: shown as text, edited in place (click,
 * then Save, Ctrl+Enter or clicking away; Escape keeps it). An emptied
 * reason is removed.
 */
function RationaleInPlace({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  if (editing) {
    return (
      <Textarea
        ref={ref}
        aria-label={label}
        rows={2}
        maxLength={RATIONALE_MAX}
        defaultValue={value}
        className="text-xs"
        onBlur={(e) => {
          setEditing(false);
          if (e.target.value.trim() !== value.trim()) onSave(e.target.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.value = value;
            setEditing(false);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit"
      aria-label={value ? `${label}: ${value}. Edit` : `${label}: add a reason`}
      className={cn(
        "block w-full cursor-text whitespace-pre-wrap break-words rounded-sm text-left text-xs transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        value ? "text-text" : "text-sub"
      )}
    >
      {value || "Add why it's here"}
    </button>
  );
}

/** "Yes to: will you only learn by trying …" — the answers an item was placed with. */
function answersText(item: CynefinItem): string | null {
  const a = normalizeAnswers(item.answers);
  const parts = QUESTIONS.filter((q) => a[q.id]).map((q) => `${q.text} ${ANSWER_LABEL[a[q.id]!]}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * One problem on the board: its title and why it sits where it does,
 * edited in place; its domain, changed with the picker (a plan written for
 * it survives a change of domain); the plan; and for a complex item,
 * "Turn into a hypothesis" (once; Undo takes it back), then where that
 * test stands.
 */
export function ItemCard({
  item,
  hypothesis,
  onTitle,
  onRationale,
  onDomain,
  onHypothesis,
  onDelete,
}: {
  item: CynefinItem;
  hypothesis: HypothesisState;
  onTitle: (title: string) => void;
  onRationale: (rationale: string) => void;
  onDomain: (domain: CynefinDomain) => void;
  onHypothesis: () => void;
  onDelete: () => void;
}) {
  const edit = useInlineEdit();
  const domain = normalizeDomain(item.domain);
  const plan = planOf(item);
  const answers = answersText(item);
  const example = isExampleId(item.id);
  const link = hypothesisLinkOf(item);
  const href = link
    ? getHandoffRoute("hypothesis").targetHref(link.targetId)
    : "/hypothesis-tracker";

  return (
    <li className="space-y-2 rounded-md border border-border bg-surface-deep p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-48">
          {edit.editing ? (
            <InlineItemEditor
              label="Edit problem"
              title={item.title}
              titleLabel="Problem title"
              titleMaxLength={TITLE_MAX}
              onDone={(next, { refocus }) => {
                edit.stop({ refocus });
                if (next) onTitle(next.title);
              }}
            />
          ) : (
            <button
              ref={edit.triggerRef}
              type="button"
              onClick={edit.start}
              title="Click to edit"
              className="block w-full cursor-text break-words rounded-sm text-left font-medium text-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {item.title} <span className="sr-only">(edit)</span>
            </button>
          )}
        </div>
        <label className="sr-only" htmlFor={`domain-${item.id}`}>
          Domain of {item.title}
        </label>
        <select
          id={`domain-${item.id}`}
          className={cn(
            "flex h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            DOMAIN_TONE[domain]
          )}
          value={domain}
          onChange={(e) => onDomain(e.target.value as CynefinDomain)}
        >
          {DOMAIN_IDS.map((d) => (
            <option key={d} value={d}>
              {DOMAINS[d].label}
            </option>
          ))}
        </select>
        <IconButton
          label={`Delete ${item.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="h-8 w-8 text-sub hover:text-danger"
          onClick={onDelete}
        />
      </div>

      <RationaleInPlace
        label={`Why ${item.title} is ${DOMAINS[domain].label}`}
        value={item.rationale ?? ""}
        onSave={onRationale}
      />

      <p className="text-xs text-sub">
        <span className="font-medium text-text">Plan: </span>
        {plan.text}
        {plan.custom && (
          <span className="ml-1 rounded border border-border px-1 text-xs text-sub">
            custom plan
          </span>
        )}
      </p>
      {answers && <p className="text-xs text-sub">Answers: {answers}</p>}

      {domain === "complex" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          {hypothesis === "none" ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={example}
                onClick={onHypothesis}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                Turn into a hypothesis
              </Button>
              <span className="text-xs text-sub">
                {example
                  ? "Example items stay out of the Hypothesis Tracker."
                  : "Complex: probe it with a safe-to-fail experiment."}
              </span>
            </>
          ) : (
            <Link
              href={href}
              className={cn(
                "inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline",
                hypothesis === "tested" ? "text-success" : "text-accent"
              )}
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              {hypothesis === "tested"
                ? "Tested in the Hypothesis Tracker · Open"
                : "Testing in the Hypothesis Tracker · Open"}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
