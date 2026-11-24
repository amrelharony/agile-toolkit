"use client";

/**
 * The estimator's page (/planning-poker/estimate#estimate=…): a round's
 * stories from the link, a card for each, up to five notes, and a reply
 * code to send back to the facilitator.
 *
 * It never mounts the Poker page (PlanningPokerClient), so there's no store
 * rehydrate, no session restore, no auto-seat and no history logger. It
 * writes nothing to any store, history or this browser's storage, and sends
 * no gamification signal: the picks live in this component's memory until
 * the person copies their reply, as the notice at the top says.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Send, Share2, StickyNote, X } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ASYNC_ESTIMATE_NOTICE } from "@/lib/site/disclosures";
import { POKER_ASYNC_MAX } from "@/lib/stores/workspace-types";
import {
  readPack,
  validateReply,
  type AsyncPack,
  type ReplyDraft,
  type ReplyField,
} from "@/lib/estimation/async-pack";
import { dueDayLabel } from "./day-label";

/** The notice with the facilitator's name in it. */
export function estimatorNotice(host: string | undefined): string {
  const name = host?.trim() || "the facilitator";
  return ASYNC_ESTIMATE_NOTICE.split("{name}").join(name);
}

/** The host's page address for a reply code. */
export function replyLink(code: string, origin: string): string {
  return `${origin}/planning-poker#reply=${code}`;
}

export function EstimateView() {
  // Null until this browser has read its own address (the server has no hash).
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const pack = useMemo(() => (hash === null ? null : readPack(hash)), [hash]);

  return (
    <ToolPageWrapper
      title="Estimate without a meeting"
      description="Pick a card for each story, then send your reply to the facilitator."
    >
      {hash === null ? (
        <WorkspaceLoading>Reading the link…</WorkspaceLoading>
      ) : pack ? (
        // A new link starts a new draft.
        <EstimateForm key={hash} pack={pack} />
      ) : (
        <EmptyState>
          <p className="text-sm text-text">This link doesn&apos;t hold a complete round.</p>
          <p className="mt-1 text-sm text-sub">
            Ask the facilitator to send it again, and open the whole link.
          </p>
        </EmptyState>
      )}
    </ToolPageWrapper>
  );
}

function EstimateForm({ pack }: { pack: AsyncPack }) {
  const [code, setCode] = useState<string | null>(null);
  const [openNotes, setOpenNotes] = useState<number[]>([]);
  const [canShare, setCanShare] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  const host = pack.h?.trim() || "the facilitator";

  const form = useItemForm<ReplyDraft, { code: string }, ReplyField>({
    initial: () => ({ name: "", picks: pack.s.map(() => null), notes: [] }),
    validate: (d) => validateReply(pack, d),
    resetOnSave: false,
    onSave: (values) => setCode(values.code),
  });
  const { draft, update, errors } = form;
  const headingId = useId();

  const pick = (index: number, card: string | null) => {
    setCode(null);
    update({ picks: draft.picks.map((p, i) => (i === index ? card : p)) });
  };
  const noteText = (index: number) => draft.notes.find((n) => n.story === index)?.text ?? "";
  const setNote = (index: number, text: string) => {
    setCode(null);
    update({
      notes: [...draft.notes.filter((n) => n.story !== index), { story: index, text }],
    });
  };
  // Opening a note swaps "Add a note" for its box, and Remove swaps it back:
  // focus goes to what took the pressed control's place, not to the page.
  const focusNext = useRef<{ index: number; to: "note" | "add" } | null>(null);
  const focusWhen = (index: number, to: "note" | "add") => (el: HTMLElement | null) => {
    const want = focusNext.current;
    if (!el || !want || want.index !== index || want.to !== to) return;
    focusNext.current = null;
    el.focus();
  };
  const openNote = (index: number) => {
    focusNext.current = { index, to: "note" };
    setOpenNotes((open) => [...open, index]);
  };
  const closeNote = (index: number) => {
    setCode(null);
    focusNext.current = { index, to: "add" };
    setOpenNotes((open) => open.filter((i) => i !== index));
    update({ notes: draft.notes.filter((n) => n.story !== index) });
  };
  const notesFull = openNotes.length >= POKER_ASYNC_MAX.notesPerReply;
  const picked = draft.picks.filter((p) => p !== null).length;

  const share = () => {
    if (!code) return;
    void navigator
      .share({
        title: `My cards for “${pack.t}”`,
        text: `My cards for “${pack.t}”. Paste the link or the code into Planning Poker.`,
        url: replyLink(code, origin),
      })
      .catch(() => {
        /* closed, or not allowed: the copy buttons still work */
      });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <p
        role="note"
        className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm text-text"
      >
        {estimatorNotice(pack.h)}
      </p>

      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface px-4 py-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="font-display text-lg text-text break-words">
            {pack.t}
          </h2>
          <p className="text-sm text-sub">
            {pack.s.length} {pack.s.length === 1 ? "story" : "stories"}
            {pack.due ? `, reply by ${dueDayLabel(pack.due)}` : ""}.
          </p>
        </div>

        <form
          ref={form.formRef}
          onSubmit={(e) => form.submit(e)}
          noValidate
          className="flex flex-col gap-5"
        >
          <Field label="Your name" error={errors.name} required>
            {(props) => (
              <Input
                {...props}
                value={draft.name}
                maxLength={POKER_ASYNC_MAX.name}
                autoComplete="name"
                onChange={(e) => {
                  setCode(null);
                  update({ name: e.target.value });
                }}
                placeholder="e.g. Lee"
              />
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <ol className="flex flex-col gap-4" aria-label="Stories">
              {pack.s.map((title, index) => {
                const card = draft.picks[index];
                const at = card === null ? -1 : pack.d.indexOf(card);
                const meaning = at === -1 ? "" : (pack.m?.[at] ?? "");
                const noteOpen = openNotes.includes(index);
                return (
                  <li
                    key={index}
                    className="flex min-w-0 flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
                  >
                    <p className="text-sm font-medium text-text break-words">
                      {index + 1}. {title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <ToggleGroup
                        label={`Card for “${title}”`}
                        size="sm"
                        className="pointer-coarse:[&>button]:min-h-11 pointer-coarse:[&>button]:min-w-11 pointer-coarse:[&>button]:px-3 pointer-coarse:[&>button]:text-sm"
                        options={pack.d.map((c) => ({ value: c, label: c }))}
                        value={card}
                        onValueChange={(v) => pick(index, v)}
                      />
                      {card !== null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="pointer-coarse:min-h-11"
                          onClick={() => pick(index, null)}
                          aria-label={`Clear the card for “${title}”`}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    {meaning && (
                      <p className="text-xs text-sub">
                        <span className="font-data text-text">{card}</span>: {meaning}
                      </p>
                    )}
                    {noteOpen ? (
                      <div className="flex items-start gap-2">
                        <Field
                          label={`Note on “${title}”`}
                          hideLabel
                          className="min-w-0 flex-1"
                          hint={`${noteText(index).length}/${POKER_ASYNC_MAX.note}`}
                        >
                          {(props) => (
                            <Textarea
                              {...props}
                              ref={focusWhen(index, "note")}
                              rows={2}
                              value={noteText(index)}
                              maxLength={POKER_ASYNC_MAX.note}
                              onChange={(e) => setNote(index, e.target.value)}
                              placeholder="What the facilitator should know"
                            />
                          )}
                        </Field>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => closeNote(index)}
                          aria-label={`Remove the note on “${title}”`}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        ref={focusWhen(index, "add")}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="self-start gap-1.5 pointer-coarse:min-h-11"
                        disabled={notesFull}
                        onClick={() => openNote(index)}
                        aria-label={`Add a note on “${title}”`}
                      >
                        <StickyNote aria-hidden="true" />
                        Add a note
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
            {notesFull && (
              <p className="text-xs text-sub">
                {POKER_ASYNC_MAX.notesPerReply} notes is the most a reply takes.
              </p>
            )}
            {errors.cards && (
              <p className="text-xs text-danger" role="alert">
                {errors.cards}
              </p>
            )}
            {errors.notes && (
              <p className="text-xs text-danger" role="alert">
                {errors.notes}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="submit" className="gap-2 h-11">
              <Send aria-hidden="true" />
              Make my reply
            </Button>
            <span className="text-xs text-sub">
              {picked} of {pack.s.length} picked
            </span>
          </div>
        </form>
      </section>

      {code && (
        <section
          aria-label="Your reply"
          className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-4"
        >
          <p className="text-sm text-text" role="status">
            Your reply is ready. Send it to {host} only: anyone who sees it can read your name,
            cards and notes.
          </p>
          <p className="max-h-32 overflow-y-auto break-all rounded-md border border-border bg-card px-2 py-1.5 font-data text-xs text-text">
            {code}
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={code} label="Copy reply" announcement="Reply copied" />
            <CopyButton
              text={() => replyLink(code, origin || window.location.origin)}
              label="Copy link"
              announcement="Link copied"
            />
            {canShare && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={share}>
                <Share2 aria-hidden="true" />
                Share
              </Button>
            )}
          </div>
          <p className="text-xs text-sub">
            Changed your mind? Pick again and make a new reply: {host} can replace the earlier one.
          </p>
        </section>
      )}
    </div>
  );
}
