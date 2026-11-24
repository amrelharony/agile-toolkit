"use client";

/**
 * One kickoff: its name, format and status; Agree (and Back to draft);
 * Ask Amr to draft, or draft without AI; what's still open; its sections,
 * one column on a phone and a grid from `md`; the trade-off sliders; the
 * problem statement helpers; collecting answers from the room; the format's
 * credit line.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, CircleDot, Copy, MessagesSquare, Sparkles, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SectionCreditLine } from "@/components/sectioned/section-credit";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
import { PeoplePicker } from "@/components/team/person-picker";
import { Button } from "@/components/ui/button";
import type { KickoffDraftContext } from "@/lib/ai/tasks/kickoff.lite";
import { cheer } from "@/lib/celebrate/cheer";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import {
  changedSinceAgreed,
  dayLabel,
  formatOf,
  itemCount,
  kickoffGaps,
  oneLine,
  withStatus,
} from "@/lib/kickoff/model";
import { KICKOFF_BRIEF_MAX, TOOL_LIST_MAX, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import { DraftPanel } from "./draft-panel";
import type { KickoffHandle } from "./kickoff-handle";
import { ProblemPanel } from "./problem-panel";
import { KickoffSection } from "./section";
import { SlidersCard } from "./sliders";

/**
 * The room (an Audience Wall room) loads only when asked for, so the page
 * doesn't carry the room kit for everyone.
 */
const CollectRoomLazy = dynamic(() => import("./collect-room").then((m) => m.CollectRoom), {
  ssr: false,
  loading: () => (
    <p role="status" className="text-sm text-sub">
      Loading the room…
    </p>
  ),
});

function AgreeBar({ handle }: { handle: KickoffHandle }) {
  const { kickoff: k, write, log, example } = handle;
  const announce = useAnnounce();
  const agreed = k.status === "agreed";
  const changed = changedSinceAgreed(k);

  const agree = () => {
    const w = write((cur, now) => withStatus(cur, "agreed", now));
    if (!w.ok) return;
    if (!example) {
      log(KICKOFF_ACTIONS.KICKOFF_AGREED, {
        kickoffId: k.id,
        format: k.format,
        count: itemCount(w.kickoff),
      });
      cheer("kickoff", "agreed");
    }
    announce("The kickoff is agreed.");
  };
  const back = () => {
    const w = write((cur, now) => withStatus(cur, "draft", now));
    if (!w.ok) return;
    log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
    announce("Back to draft.");
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface/40 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-status={k.status}
    >
      <p className="flex items-start gap-1.5 text-sm text-text" role="status">
        {agreed ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
        )}
        <span>
          {agreed
            ? `Agreed${k.agreedAt ? ` on ${dayLabel(k.agreedAt)}` : ""}.`
            : "A draft. Agree it once everyone can say what it means in one line."}
          {changed && <span className="font-medium"> Changed since you agreed.</span>}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {(!agreed || changed) && (
          <Button type="button" variant="toolkit" size="sm" onClick={agree}>
            {agreed ? "Agree again" : "Agree it"}
          </Button>
        )}
        {agreed && (
          <Button type="button" variant="outline" size="sm" onClick={back}>
            Back to draft
          </Button>
        )}
      </div>
    </div>
  );
}

/** The name, brief, date and people, edited in place. */
function Details({ handle }: { handle: KickoffHandle }) {
  const { kickoff: k, write, log } = handle;
  const [problem, setProblem] = useState<string | null>(null);
  const save = (fn: Parameters<KickoffHandle["write"]>[0]) => {
    const w = write(fn);
    if (w.ok) {
      log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
      setProblem(null);
    } else if (w.message) setProblem(w.message);
  };
  return (
    <details className="rounded-lg border border-border bg-card p-3">
      {/* The summary takes the card's padding as its own (-m-3 p-3): a 44 px
          tap with the words centred in it, and no empty band under them. */}
      <summary className="-m-3 cursor-pointer rounded-lg p-3 text-sm font-medium text-text">
        Name, brief, date and people
      </summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${k.id}-title`} className="text-sm text-text">
            Name
          </label>
          <BlurInput
            id={`${k.id}-title`}
            value={k.title}
            maxLength={TOOL_TEXT_MAX.short}
            onCommit={(v) => {
              const title = cutText(oneLine(v), TOOL_TEXT_MAX.short);
              if (!title) {
                setProblem("A kickoff needs a name.");
                return;
              }
              save((cur, now) => ({ ...cur, title, updatedAt: now }));
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${k.id}-date`} className="text-sm text-text">
            Date
          </label>
          <BlurInput
            id={`${k.id}-date`}
            type="date"
            value={k.date ?? ""}
            onCommit={(v) =>
              save((cur, now) => {
                const { date: _d, ...rest } = cur;
                void _d;
                return /^\d{4}-\d{2}-\d{2}$/.test(v)
                  ? { ...rest, date: v, updatedAt: now }
                  : { ...rest, updatedAt: now };
              })
            }
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label htmlFor={`${k.id}-brief`} className="text-sm text-text">
            Brief
          </label>
          <BlurTextarea
            id={`${k.id}-brief`}
            rows={3}
            value={k.brief ?? ""}
            maxLength={KICKOFF_BRIEF_MAX}
            onCommit={(v) =>
              save((cur, now) => {
                const { brief: _b, ...rest } = cur;
                void _b;
                const brief = cutText(v.trim(), KICKOFF_BRIEF_MAX);
                return brief ? { ...rest, brief, updatedAt: now } : { ...rest, updatedAt: now };
              })
            }
          />
        </div>
        <PeoplePicker
          label="Who takes part"
          values={k.participants ?? []}
          className="md:col-span-2"
          onChange={(names) =>
            save((cur, now) => {
              const { participants: _p, ...rest } = cur;
              void _p;
              const participants = names.slice(0, TOOL_LIST_MAX.kickoffParticipants);
              return participants.length > 0
                ? { ...rest, participants, updatedAt: now }
                : { ...rest, updatedAt: now };
            })
          }
          offerEveryone
        />
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </details>
  );
}

export function KickoffView({
  handle,
  context,
  onStartAnother,
  onRemove,
  onRoomChange,
}: {
  handle: KickoffHandle;
  context: KickoffDraftContext;
  /** "Start another format from this brief". */
  onStartAnother: () => void;
  onRemove: () => void;
  /** The collect room opened live, its round's unsaved answers changed, or it ended (null). */
  onRoomChange?: (room: { unsaved: boolean } | null) => void;
}) {
  const { kickoff: k, example } = handle;
  const format = formatOf(k);
  const gaps = kickoffGaps(k);
  const [roomOpen, setRoomOpen] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-sub">
        {[format.name, dayLabel(k.date)].filter(Boolean).join(" · ")}
        {k.participants && k.participants.length > 0 && <> · With {k.participants.join(", ")}</>}
      </p>
      {k.brief?.trim() && <p className="whitespace-pre-wrap text-sm text-text">{k.brief}</p>}
      <AgreeBar handle={handle} />
      <Details handle={handle} />

      <SectionCard title="Draft with Amr" icon={Sparkles} contentClassName="space-y-3">
        <DraftPanel key={k.id} handle={handle} context={context} />
      </SectionCard>

      <SectionCard
        title="What's still open"
        titleSuffix={gaps.length > 0 ? String(gaps.length) : undefined}
        contentClassName="space-y-2"
      >
        {gaps.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-text" aria-label="What's still open">
            {gaps.map((g) => (
              <li key={g.id} data-gap={g.id}>
                {g.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text" role="status">
            Nothing open: every required section is filled in, and nothing waits on a [bracket].
          </p>
        )}
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        {format.sections.map((def) => (
          <KickoffSection key={`${k.id}:${def.id}`} handle={handle} def={def} />
        ))}
      </div>

      {format.hasSliders && <SlidersCard key={`${k.id}:sliders`} handle={handle} />}
      {k.format === "problem-framing" && <ProblemPanel handle={handle} />}

      <SectionCard title="Collect from the room" icon={MessagesSquare} contentClassName="space-y-3">
        {example ? (
          <p className="text-sm text-sub">
            Start your own kickoff to collect answers from phones: the example keeps nothing.
          </p>
        ) : roomOpen ? (
          // Stays once opened. While it is live the page asks before anything
          // ends it (another kickoff shown, this one deleted): see kickoff-client.
          <CollectRoomLazy key={k.id} handle={handle} onLiveChange={onRoomChange} />
        ) : (
          <>
            <p className="text-sm text-sub">
              Ask the room a section&apos;s question; people answer from their phones without names.
            </p>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => setRoomOpen(true)}
            >
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
              Collect answers from phones
            </Button>
          </>
        )}
      </SectionCard>

      <SectionCreditLine credit={format.credit} />

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onStartAnother}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Start another format from this brief
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-danger hover:text-danger"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete this kickoff
        </Button>
      </div>
    </div>
  );
}
