"use client";

import { useEffect, useState } from "react";
import Link from "@/components/motion/transition-link";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import type { DesignSprintOutput } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { liveSentTo } from "./doc";
import {
  ANSWER_LABEL,
  EMPTY_OUTPUT_DRAFT,
  INTERVIEWS,
  SIGNAL_LABEL,
  findingMeta,
  isAnswer,
  isSignal,
  isWebLink,
  outputDraftFrom,
  validateOutput,
  type OutputDraft,
  type OutputField,
  type OutputSlot,
  type OutputValues,
  type SignalChoice,
} from "./outputs";

/**
 * One place on a day for what it produced: the long-term goal, the
 * sketches, the decision, the findings. Each item is added through a form
 * that saves nothing without text, edited in place and deleted with Undo.
 * A slot that holds one item (the goal, the decision) offers its form only
 * while it's empty. Findings carry a signal and an interview count and can
 * be sent on as a hypothesis or a backlog story.
 */

const FINDING_ROUTES = ["hypothesis", "backlog-story"] as const;

const SIGNAL_OPTIONS: { value: SignalChoice; label: string }[] = [
  { value: "none", label: "Not judged" },
  { value: "positive", label: SIGNAL_LABEL.positive },
  { value: "negative", label: SIGNAL_LABEL.negative },
  { value: "mixed", label: SIGNAL_LABEL.mixed },
];

const SIGNAL_TONE: Record<string, string> = {
  positive: "border-success/40 bg-success/10 text-success",
  negative: "border-danger/40 bg-danger/10 text-danger",
  mixed: "border-warning/40 bg-warning/10 text-warning",
};

export interface OutputSlotProps {
  slot: OutputSlot;
  outputs: readonly DesignSprintOutput[];
  /** False for the example: its findings never reach the user's tools. */
  canSend: boolean;
  /** The plan the outputs belong to, for a finding's back-link. */
  planId: string;
  /** Returns the new output (null when it couldn't be saved). */
  onAdd: (values: OutputValues) => DesignSprintOutput | null;
  onSave: (output: DesignSprintOutput, values: OutputValues) => void;
  onRemove: (output: DesignSprintOutput) => void;
  onLinksChange: (
    output: DesignSprintOutput,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  getLinks: (output: DesignSprintOutput) => readonly HandoffLink[] | undefined;
}

export function OutputSlotSection({
  slot,
  outputs,
  canSend,
  planId,
  onAdd,
  onSave,
  onRemove,
  onLinksChange,
  getLinks,
}: OutputSlotProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { refFor, returnTo } = useReturnFocus();
  const addKey = `add:${slot.kind}`;
  const canAdd = !slot.single || outputs.length === 0;

  const closeEditor = (o: DesignSprintOutput) => {
    setEditingId(null);
    returnTo(`edit:${o.id}`);
  };
  const closeAdd = () => {
    setAdding(false);
    returnTo(addKey);
  };
  const remove = (o: DesignSprintOutput, index: number) => {
    const neighbour = outputs[index + 1] ?? outputs[index - 1];
    // A single slot shows its add button again once its item is gone.
    returnTo(neighbour ? `edit:${neighbour.id}` : addKey);
    onRemove(o);
  };

  return (
    <section aria-label={slot.heading} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-sub">
        {slot.heading}
        {!slot.single && outputs.length > 0 && (
          <span className="ml-1 font-data font-normal">({outputs.length})</span>
        )}
      </h3>
      {outputs.length === 0 && !adding && <p className="text-sm text-sub">{slot.emptyText}</p>}
      {outputs.length > 0 && (
        <ul className="space-y-2">
          {outputs.map((o, i) => (
            <li key={o.id} className="rounded border border-border bg-bg p-2">
              {editingId === o.id ? (
                <OutputEditor
                  slot={slot}
                  output={o}
                  onSave={(values) => {
                    closeEditor(o);
                    onSave(o, values);
                  }}
                  onCancel={() => closeEditor(o)}
                />
              ) : (
                <OutputRow
                  slot={slot}
                  output={o}
                  canSend={canSend}
                  planId={planId}
                  editRef={refFor(`edit:${o.id}`)}
                  onEdit={() => setEditingId(o.id)}
                  onRemove={() => remove(o, i)}
                  onLinksChange={(update) => onLinksChange(o, update)}
                  getLinks={() => getLinks(o)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd &&
        (adding ? (
          <div className="rounded border border-border bg-bg p-3">
            <OutputAddForm
              slot={slot}
              onAdd={(values) => {
                const added = onAdd(values);
                // One goal, one decision: the form closes and focus goes to the
                // new item. A list's form stays open for the next one.
                if (!slot.single) return;
                setAdding(false);
                returnTo(added ? `edit:${added.id}` : addKey);
              }}
              onCancel={closeAdd}
            />
          </div>
        ) : (
          <Button
            ref={refFor(addKey)}
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {slot.addLabel}
          </Button>
        ))}
    </section>
  );
}

/** One output: its text and link; a finding's signal, count and where it went; actions. */
function OutputRow({
  slot,
  output: o,
  canSend,
  planId,
  editRef,
  onEdit,
  onRemove,
  onLinksChange,
  getLinks,
}: {
  slot: OutputSlot;
  output: DesignSprintOutput;
  canSend: boolean;
  planId: string;
  editRef: (el: HTMLElement | null) => void;
  onEdit: () => void;
  onRemove: () => void;
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  getLinks: () => readonly HandoffLink[] | undefined;
}) {
  const finding = o.kind === "finding";
  const url = o.url && isWebLink(o.url) ? o.url : null;
  const meta = finding ? findingMeta(o) : "";
  // Live links only, so the row, the menu's "Sent" and its trigger agree once
  // a target is deleted in its own tool. A send reads the stored links (getLinks).
  const sent = finding ? liveSentTo(o) : [];
  const handoff: HandoffSource = {
    title: o.text,
    ...(meta ? { description: meta } : {}),
    sourceRef: { tool: "design-sprint", id: o.id, doc: planId },
  };
  const name = shortText(o.text);
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        {url !== o.text && <p className="break-words text-sm text-text">{o.text}</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 break-all text-xs text-accent underline-offset-2 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {url}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {finding && (
          // A div, not a p: a Badge is a div.
          <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
            {isSignal(o.signal) ? (
              <Badge variant="outline" className={cn("text-xs", SIGNAL_TONE[o.signal])}>
                {SIGNAL_LABEL[o.signal]}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Not judged
              </Badge>
            )}
            {typeof o.seenIn === "number" && (
              <span>
                Seen in {o.seenIn} of {INTERVIEWS} interviews
              </span>
            )}
          </div>
        )}
        {finding && <SentLinks live={sent} />}
        {o.kind === "sprint-question" && isAnswer(o.answer) && (
          // Answered on Test day: editing the question keeps the answer, deleting it takes it too.
          <div className="flex">
            <Badge variant="outline" className="text-xs">
              Test day: {ANSWER_LABEL[o.answer]}
            </Badge>
          </div>
        )}
      </div>
      <span className="flex shrink-0 flex-wrap items-center">
        {finding && canSend && (
          <SendToMenu
            routes={FINDING_ROUTES}
            item={handoff}
            sentTo={sent}
            onLinksChange={onLinksChange}
            getLinks={getLinks}
            itemLabels={{ hypothesis: "Hypothesis to test", "backlog-story": "Backlog story" }}
          />
        )}
        <IconButton
          ref={editRef}
          label={`Edit ${slot.noun}: ${name}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${slot.noun}: ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

/** "Sent to the Hypothesis Tracker · Open", one per hand-off whose target still exists. */
function SentLinks({ live }: { live: readonly HandoffLink[] }) {
  if (live.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {live.map((l) => {
        const route = getHandoffRoute(l.route);
        return (
          <Link
            key={`${l.route}:${l.targetId}`}
            href={route.targetHref(l.targetId)}
            className="text-success underline-offset-2 hover:underline"
          >
            {l.route === "hypothesis" ? "Sent to the Hypothesis Tracker" : "On the backlog"} · Open
          </Link>
        );
      })}
    </p>
  );
}

function shortText(text: string, max = 60): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The fields the slot asks for: the text, a link, and for a finding its signal and count. */
function OutputFields({
  slot,
  form,
}: {
  slot: OutputSlot;
  form: ItemFormState<OutputDraft, OutputField>;
}) {
  const { draft, update, errors } = form;
  return (
    <>
      <Field label={slot.textLabel} hint={slot.hint} error={errors.text} required>
        {(props) => (
          <Input
            {...props}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder={slot.placeholder}
          />
        )}
      </Field>
      {slot.link && (
        <Field label="Link" hint="Optional: a file, a photo or the prototype." error={errors.url}>
          {(props) => (
            <Input
              {...props}
              type="url"
              inputMode="url"
              value={draft.url}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://"
            />
          )}
        </Field>
      )}
      {slot.kind === "finding" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,12rem)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            {/* The radio group carries the same name; this is the visible label. */}
            <span className="text-sm text-text" aria-hidden="true">
              Signal
            </span>
            <ToggleGroup<SignalChoice>
              label="Signal"
              size="sm"
              options={SIGNAL_OPTIONS}
              value={draft.signal}
              onValueChange={(signal) => update({ signal })}
            />
          </div>
          <Field
            label="Seen in"
            hint={`How many of the ${INTERVIEWS} interviews, 0 to ${INTERVIEWS}.`}
            error={errors.seenIn}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={0}
                max={INTERVIEWS}
                step={1}
                className="font-data"
                value={draft.seenIn}
                onChange={(e) => update({ seenIn: e.target.value })}
              />
            )}
          </Field>
        </div>
      )}
    </>
  );
}

function OutputAddForm({
  slot,
  onAdd,
  onCancel,
}: {
  slot: OutputSlot;
  onAdd: (values: OutputValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<OutputDraft, OutputValues, OutputField>({
    initial: EMPTY_OUTPUT_DRAFT,
    validate: (d) => validateOutput(slot, d),
    onSave: onAdd,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm
      form={form}
      submitLabel={slot.single ? "Save" : `Add ${slot.noun}`}
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      cancelLabel={slot.single ? "Cancel" : "Done"}
    >
      <OutputFields slot={slot} form={form} />
    </ItemForm>
  );
}

function OutputEditor({
  slot,
  output,
  onSave,
  onCancel,
}: {
  slot: OutputSlot;
  output: DesignSprintOutput;
  onSave: (values: OutputValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<OutputDraft, OutputValues, OutputField>({
    initial: () => outputDraftFrom(output),
    validate: (d) => validateOutput(slot, d),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <OutputFields slot={slot} form={form} />
    </ItemForm>
  );
}
