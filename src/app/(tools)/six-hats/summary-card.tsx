"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { BookCheck, CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import type { SixHatsSession } from "@/lib/stores/workspace-types";
import { SUMMARY_MAX, hasSummary, isLastRound, validateSummary } from "./session";

const ROUTES = ["decision"] as const;

/** The summary's text field, so "Write the summary" in the rounds can jump to it. */
export interface SummaryCardHandle {
  focus: () => void;
}

/**
 * The Blue hat's summary: what the team concluded and what happens next.
 * It is written in the closing Blue round but can be edited any time, and
 * closing the session needs one. Once saved it can go to a decision record
 * (the Decision Log), which links back to this session.
 */
export const SummaryCard = forwardRef<
  SummaryCardHandle,
  {
    session: SixHatsSession;
    /** Example sessions stay out of the Decision Log. */
    example: boolean;
    onSave: (summary: string) => void;
    onClose: () => void;
    onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
    getLinks: () => readonly HandoffLink[] | undefined;
  }
>(function SummaryCard({ session, example, onSave, onClose, onLinksChange, getLinks }, ref) {
  const saved = session.summary ?? "";
  const form = useItemForm<{ summary: string }, string, "summary">({
    initial: () => ({ summary: saved }),
    validate: validateSummary,
    onSave: (summary) => {
      if (summary !== saved.trim()) onSave(summary);
    },
    resetOnSave: false,
  });
  const { draft, update, errors, reset, formRef } = form;

  // An agent (or another tab) wrote the summary: show it, unless someone is
  // in the middle of changing it here. Trimmed, since the store keeps the
  // trimmed text: a draft saved with a trailing newline isn't an edit, and
  // treating it as one hid the next summary and let Close overwrite it.
  const synced = useRef(saved);
  useEffect(() => {
    if (saved === synced.current) return;
    if (draft.summary.trim() === synced.current.trim()) reset({ summary: saved });
    synced.current = saved;
  }, [saved, draft.summary, reset]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = formRef.current?.querySelector<HTMLTextAreaElement>("textarea");
      el?.focus();
      el?.scrollIntoView?.({ block: "center" });
    },
  }));

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.submit();
    }
  };

  const open = !session.closedAt;
  const written = hasSummary(session);
  const link = liveLink(session.sentTo, "decision");
  const decided = link ? getHandoffRoute("decision").isDone?.(link.targetId) === true : false;
  const item: HandoffSource = {
    title: session.topic,
    description: saved.trim(),
    sourceRef: { tool: "six-hats", id: session.id },
  };

  return (
    <SectionCard title="Blue-hat summary" icon={ClipboardList}>
      <p className="mb-3 text-sm text-sub">
        {isLastRound(session)
          ? "This is the closing Blue round: what did the team conclude, and what happens next?"
          : "Written in the closing Blue round, and editable any time. Closing the session needs one."}
      </p>
      <ItemForm
        form={form}
        submitLabel="Save summary"
        footer={
          open ? (
            <Button
              type="button"
              variant="outline"
              className="gap-1"
              onClick={() => {
                if (form.submit()) onClose();
              }}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Close session
            </Button>
          ) : undefined
        }
      >
        <Field
          label="Summary"
          error={errors.summary}
          hint="Conclusions, the decision if there is one, and next steps. Ctrl+Enter saves."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              maxLength={SUMMARY_MAX}
              value={draft.summary}
              onChange={(e) => update({ summary: e.target.value })}
              onKeyDown={onKeyDown}
              placeholder="e.g. Trial weekly releases for two sprints, then review the hotfix rate."
            />
          )}
        </Field>
      </ItemForm>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <SendToMenu
          routes={ROUTES}
          item={item}
          sentTo={session.sentTo}
          onLinksChange={onLinksChange}
          getLinks={getLinks}
          disabled={!written || example}
        />
        {!written ? (
          <span className="text-xs text-sub">Write the summary first.</span>
        ) : example ? (
          <span className="text-xs text-sub">Example sessions stay out of the Decision Log.</span>
        ) : link ? (
          <Link
            href={getHandoffRoute("decision").targetHref(link.targetId)}
            className="min-touch-coarse inline-flex items-center gap-1 py-1 text-xs text-success underline-offset-2 hover:underline"
          >
            <BookCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {decided ? "Decided in the Decision Log · Open" : "Proposed in the Decision Log · Open"}
          </Link>
        ) : (
          <span className="text-xs text-sub">
            Send it to a decision record, so the decision is written down.
          </span>
        )}
      </div>
    </SectionCard>
  );
});
