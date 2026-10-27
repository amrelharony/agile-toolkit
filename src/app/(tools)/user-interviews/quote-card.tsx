"use client";

/**
 * One quote in an interview: what was said and its tags, edited in place
 * (Edit), deleted with Undo, and raised as an opportunity on the
 * Opportunity Tree under an outcome or opportunity the user picks (the
 * top of the tree when there is none). The opportunity gets the quote's
 * redacted text and never the participant's name (lib/interviews'
 * quoteOpportunitySource); once it is on the tree the quote links to it.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { GitBranchPlus, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { QUOTE_TEXT_MAX } from "@/lib/interviews/model";
import type { InterviewQuote, TreeNode } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  emptyQuoteDraft,
  quoteDraftFrom,
  validateQuote,
  type QuoteDraft,
  type QuoteField,
  type QuoteValues,
} from "./form";
import { parentGroups } from "./view";

/** Matches <Input>: 44 px on phones, 36 px from md. */
const SELECT_CLASS =
  "flex h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const short = (text: string, max = 60) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The text and tags of a quote, for the add form and the editor. Enter saves; Shift+Enter is a new line. */
function QuoteFields({
  form,
  textLabel,
}: {
  form: ItemFormState<QuoteDraft, QuoteField>;
  textLabel: string;
}) {
  const { draft, update, errors, submit } = form;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
      <Field label={textLabel} error={errors.text} required hint="Shift+Enter for a new line.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={Math.max(QUOTE_TEXT_MAX, draft.text.length)}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            onKeyDown={onKey}
            placeholder="“I export it to a spreadsheet every Friday…”"
            className="resize-none"
          />
        )}
      </Field>
      <Field label="Tags" hint="Optional, comma-separated: the themes it shows.">
        {(props) => (
          <Input
            {...props}
            value={draft.tags}
            onChange={(e) => update({ tags: e.target.value })}
            placeholder="reporting, pricing"
          />
        )}
      </Field>
    </div>
  );
}

export function AddQuoteForm({
  participant,
  onAdd,
}: {
  participant: string;
  onAdd: (values: QuoteValues) => void;
}) {
  const form = useItemForm<QuoteDraft, QuoteValues, QuoteField>({
    initial: emptyQuoteDraft,
    validate: (d) => validateQuote(d),
    onSave: (values) => onAdd(values),
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add quote"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      className="rounded-md border border-dashed border-border p-3"
    >
      <QuoteFields form={form} textLabel={`New quote from ${participant || "this interview"}`} />
    </ItemForm>
  );
}

export interface QuoteCardProps {
  quote: InterviewQuote;
  /** 1-based, for names: "Quote 2". */
  index: number;
  /** The tree's nodes, read live: where it can go and whether its opportunity is still there. */
  nodes: readonly TreeNode[];
  /** An example interview's quotes stay out of the tree. */
  example: boolean;
  onSave: (q: InterviewQuote, values: QuoteValues) => void;
  onRemove: (q: InterviewQuote) => void;
  onSend: (q: InterviewQuote, parentId: string | undefined) => void;
}

export function QuoteCard({
  quote: q,
  index,
  nodes,
  example,
  onSave,
  onRemove,
  onSend,
}: QuoteCardProps) {
  const [mode, setMode] = useState<"view" | "edit" | "send">("view");
  const name = `quote ${index}`;
  const editRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<"edit" | "send" | null>(null);
  const live = liveLink(q.sentTo, "opportunity");
  const blocked = example || isExampleId(q.id);

  useEffect(() => {
    if (mode !== "view" || !returnTo.current) return;
    (returnTo.current === "edit" ? editRef : sendRef).current?.focus();
    returnTo.current = null;
  }, [mode]);

  const back = (to: "edit" | "send") => {
    returnTo.current = to;
    setMode("view");
  };

  if (mode === "edit") {
    return (
      <QuoteEditor
        quote={q}
        label={`Quote ${index}`}
        onSave={(values) => {
          onSave(q, values);
          back("edit");
        }}
        onCancel={() => back("edit")}
      />
    );
  }

  return (
    <li className="space-y-2 rounded-md border border-border bg-surface-deep p-3">
      <div className="flex items-start gap-2">
        <blockquote className="min-w-0 flex-1 whitespace-pre-line break-words text-sm text-text">
          {q.text?.trim() ? `“${q.text.trim()}”` : <span className="text-sub">(no text)</span>}
        </blockquote>
        <div className="flex shrink-0 items-center">
          <IconButton
            ref={editRef}
            label={`Edit ${name}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={() => setMode("edit")}
          />
          <IconButton
            label={`Delete ${name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            data-quote-delete={q.id}
            onClick={() => onRemove(q)}
          />
        </div>
      </div>
      {(q.tags ?? []).length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={`Tags of ${name}`}>
          {(q.tags ?? []).map((t) => (
            <li
              key={t}
              className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent"
            >
              {t}
            </li>
          ))}
        </ul>
      )}

      {live ? (
        <Link
          href={getHandoffRoute("opportunity").targetHref(live.targetId)}
          className="inline-flex items-center gap-1 text-xs text-success underline-offset-2 hover:underline"
        >
          <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
          On the Opportunity Tree · Open
        </Link>
      ) : mode === "send" ? (
        <SendForm
          nodes={nodes}
          name={name}
          onSend={(parentId) => {
            onSend(q, parentId);
            setMode("view");
          }}
          onCancel={() => back("send")}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={sendRef}
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={blocked || !q.text?.trim()}
            aria-label={`Raise ${name} as an opportunity`}
            onClick={() => setMode("send")}
          >
            <GitBranchPlus className="h-4 w-4" aria-hidden="true" />
            Raise as an opportunity
          </Button>
          {blocked && (
            <span className="text-xs text-sub">Example quotes stay off the Opportunity Tree.</span>
          )}
        </div>
      )}
    </li>
  );
}

/** "Put it under": an outcome or opportunity on the tree, or its top. */
function SendForm({
  nodes,
  name,
  onSend,
  onCancel,
}: {
  nodes: readonly TreeNode[];
  name: string;
  onSend: (parentId: string | undefined) => void;
  onCancel: () => void;
}) {
  const [parentId, setParentId] = useState("");
  const groups = parentGroups(nodes);
  const selectId = useId();
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    // Escape is a convenience on top of the visible Cancel button, as in ItemForm.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
      aria-label={`Raise ${name} as an opportunity`}
      onSubmit={(e) => {
        e.preventDefault();
        onSend(parentId || undefined);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
        <label htmlFor={selectId} className="text-sm text-text">
          Put it under
        </label>
        <select
          id={selectId}
          ref={ref}
          className={SELECT_CLASS}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">The top of the tree (no outcome yet)</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {short(o.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" className="gap-1">
        <GitBranchPlus className="h-4 w-4" aria-hidden="true" />
        Add to the tree
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <p className="w-full text-xs text-sub">
        The opportunity gets the quote&rsquo;s words with emails, phone numbers and the
        participant&rsquo;s name taken out.
      </p>
    </form>
  );
}

function QuoteEditor({
  quote,
  label,
  onSave,
  onCancel,
}: {
  quote: InterviewQuote;
  label: string;
  onSave: (values: QuoteValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<QuoteDraft, QuoteValues, QuoteField>({
    initial: () => quoteDraftFrom(quote),
    validate: (d) => validateQuote(d, quote),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [formRef]);
  return (
    <li className="rounded-md border border-accent/40 bg-card p-3">
      <ItemForm form={form} submitLabel="Save quote" onCancel={onCancel}>
        <QuoteFields form={form} textLabel={label} />
      </ItemForm>
    </li>
  );
}
