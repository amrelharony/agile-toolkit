"use client";

/**
 * The trade-off sliders (Inception and Trade-offs): what holds firm at the
 * top, what gives first at the bottom. Each row moves with Move up and Move
 * down (named with its label, so there is never a drag-only path), and the
 * new order is read out. Any move, or "This order is right", marks the
 * order as set. The team can add trade-offs up to eight (with three
 * suggestions), note what each means, and remove one with Undo. The order
 * goes to the Decision Log as a decision record, its link kept on the
 * kickoff itself.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { BlurInput } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import { SUGGESTED_SLIDERS } from "@/lib/kickoff/formats";
import {
  moveSlider,
  oneLine,
  orderedSliders,
  sliderOrderText,
  sliderProblem,
  sliderSummary,
  slidersDecisionSource,
  withSlider,
  withoutSlider,
} from "@/lib/kickoff/model";
import { lineKey } from "@/lib/sectioned/model";
import {
  KICKOFF_SLIDER_LABEL_MAX,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type Kickoff,
  type KickoffSlider,
} from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import { undoable } from "@/lib/utils/undoable";
import type { KickoffHandle } from "./kickoff-handle";
import { KickoffSendMenu } from "./send-menu";

/** The kickoff with new sliders; `set` marks the order as set. */
function withSliders(k: Kickoff, sliders: KickoffSlider[], now: string, set: boolean): Kickoff {
  return { ...k, sliders, ...(set ? { slidersSetAt: now } : {}), updatedAt: now };
}

export function SlidersCard({ handle }: { handle: KickoffHandle }) {
  const { kickoff: k, write, log, example } = handle;
  const announce = useAnnounce();
  const list = orderedSliders(k);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const addId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  // After a move, focus stays on the row's other button when this one turns off.
  const refocus = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-slider="${want.id}"]`);
    const same = row?.querySelector<HTMLButtonElement>(`button[data-move="${want.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-move="${want.dir === "up" ? "down" : "up"}"]`
    );
    (same && !same.disabled ? same : other)?.focus();
  });

  const logSet = (count: number) => log(KICKOFF_ACTIONS.SLIDERS_SET, { kickoffId: k.id, count });

  const move = (s: KickoffSlider, delta: -1 | 1) => {
    const w = write((cur, now) => {
      const next = moveSlider(orderedSliders(cur), s.id, delta);
      return next ? withSliders(cur, next, now, true) : null;
    });
    if (!w.ok) return;
    logSet(w.kickoff.sliders?.length ?? 0);
    refocus.current = { id: s.id, dir: delta < 0 ? "up" : "down" };
    announce(
      `${s.label} moved ${delta < 0 ? "up" : "down"}. The order is now ${sliderOrderText(w.kickoff)}.`
    );
  };

  const confirm = () => {
    const w = write((cur, now) => ({ ...cur, slidersSetAt: now, updatedAt: now }));
    if (!w.ok) return;
    logSet(list.length);
    announce(`Order set: ${sliderOrderText(w.kickoff)}.`);
  };

  const add = (label: string) => {
    const text = cutText(oneLine(label), KICKOFF_SLIDER_LABEL_MAX);
    const why = sliderProblem(list, text);
    if (why) {
      setProblem(why);
      return false;
    }
    const w = write((cur, now) => {
      const next = withSlider(orderedSliders(cur), text);
      return next ? withSliders(cur, next, now, false) : null;
    });
    if (!w.ok) {
      setProblem(w.message ?? "That trade-off couldn't be added.");
      return false;
    }
    log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
    setProblem(null);
    announce(`Added ${text} at the bottom, where it gives first.`);
    return true;
  };

  const remove = (s: KickoffSlider) => {
    const at = list.findIndex((x) => x.id === s.id);
    undoable({
      label: `Removed “${s.label}”`,
      apply: () => {
        write((cur, now) => withSliders(cur, withoutSlider(orderedSliders(cur), s.id), now, false));
        log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
      },
      revert: () => {
        // Back where it was, whatever moved since; never past the list's cap or twice.
        write((cur, now) => {
          const next = orderedSliders(cur);
          if (next.some((x) => x.id === s.id) || next.length >= TOOL_LIST_MAX.kickoffSliders) {
            return null;
          }
          next.splice(Math.min(at, next.length), 0, s);
          return withSliders(
            cur,
            next.map((x, i) => ({ ...x, position: i + 1 })),
            now,
            false
          );
        });
      },
    });
  };

  const setNote = (s: KickoffSlider, raw: string) => {
    const note = cutText(raw.trim(), TOOL_TEXT_MAX.short).trim();
    const w = write((cur, now) => {
      const next = orderedSliders(cur).map((x) => {
        if (x.id !== s.id) return x;
        const { note: _n, ...rest } = x;
        void _n;
        return note ? { ...rest, note } : rest;
      });
      return withSliders(cur, next, now, false);
    });
    if (w.ok) log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
  };

  const setLinks = (change: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
    const had = k.sentTo?.find((l) => l.route === "decision");
    const w = write((cur) => {
      const sentTo = change(cur.sentTo);
      const { sentTo: _old, ...rest } = cur;
      void _old;
      // Where the order went isn't a change to the kickoff's words.
      return sentTo.length > 0 ? { ...rest, sentTo } : rest;
    });
    if (!w.ok) return;
    const now = w.kickoff.sentTo?.find((l) => l.route === "decision");
    if (now && now.targetId !== had?.targetId) {
      log(KICKOFF_ACTIONS.ITEM_SENT, { kickoffId: k.id, section: "sliders", route: "decision" });
    }
  };

  const onList = new Set(list.map((s) => lineKey(s.label)));
  const suggestions = SUGGESTED_SLIDERS.filter((s) => !onList.has(lineKey(s)));
  const full = list.length >= TOOL_LIST_MAX.kickoffSliders;
  const summary = sliderSummary(k);

  return (
    <SectionCard
      title="Trade-offs"
      titleSuffix={`${list.length} of ${TOOL_LIST_MAX.kickoffSliders}`}
      actions={
        <KickoffSendMenu
          entries={[{ route: "decision", item: slidersDecisionSource(k) }]}
          sentTo={k.sentTo}
          getLinks={() => handle.read()?.sentTo}
          onLinksChange={setLinks}
          disabled={example || list.length < 2}
        />
      }
      contentClassName="space-y-3"
    >
      <p className="text-sm text-sub">
        When something has to give, which goes first? Put what holds firm at the top and what gives
        first at the bottom.
      </p>
      {list.length > 0 ? (
        <ol ref={listRef} aria-label="Trade-offs, holds firm first" className="space-y-2">
          {list.map((s, i) => (
            <li
              key={s.id}
              data-slider={s.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2.5 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="break-words text-sm font-medium text-text">
                  <span className="font-mono text-sub">{i + 1}.</span> {s.label}
                  {i === 0 && list.length > 1 && (
                    <span className="ml-2 text-xs font-normal text-sub">Holds firm</span>
                  )}
                  {i === list.length - 1 && list.length > 1 && (
                    <span className="ml-2 text-xs font-normal text-sub">Gives first</span>
                  )}
                </p>
                <BlurInput
                  value={s.note ?? ""}
                  maxLength={TOOL_TEXT_MAX.short}
                  placeholder="What it means for us (optional)"
                  aria-label={`Note for ${s.label}`}
                  onCommit={(v) => setNote(s, v)}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  label={`Move ${s.label} up`}
                  icon={<ArrowUp className="h-4 w-4" />}
                  variant="ghost"
                  data-move="up"
                  disabled={i === 0}
                  onClick={() => move(s, -1)}
                />
                <IconButton
                  label={`Move ${s.label} down`}
                  icon={<ArrowDown className="h-4 w-4" />}
                  variant="ghost"
                  data-move="down"
                  disabled={i === list.length - 1}
                  onClick={() => move(s, 1)}
                />
                <IconButton
                  label={`Remove ${s.label}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  variant="danger-ghost"
                  onClick={() => remove(s)}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-sub">No trade-offs yet. Add the first one below.</p>
      )}
      {summary && <p className="text-sm text-text">{summary}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={list.length < 2}
          onClick={confirm}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          This order is right
        </Button>
        <span className="text-xs text-sub" role="status">
          {k.slidersSetAt ? "The order is set." : "Nobody has set the order yet."}
        </span>
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <label htmlFor={addId} className="text-sm font-medium text-text">
          Add a trade-off
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={addId}
            value={draft}
            maxLength={KICKOFF_SLIDER_LABEL_MAX}
            readOnly={full}
            placeholder={full ? "The list is full" : "Team stays the same"}
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (add(draft)) setDraft("");
            }}
            className="min-w-0 sm:flex-1"
          />
          <Button
            type="button"
            variant="toolkit"
            aria-disabled={full || undefined}
            className="shrink-0 aria-disabled:opacity-40"
            onClick={() => {
              if (add(draft)) setDraft("");
            }}
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
        {!full && suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-sub">Often added:</span>
            {suggestions.map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Add “${s}”`}
                onClick={() => add(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        )}
        {problem && (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
