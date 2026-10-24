"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Copy,
  Mail,
  Mic,
  RotateCcw,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { hasBlocker, standupDigest } from "@/lib/standup/entries";
import type { StandupEntry, StandupMode } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { AGE_BOX, BlockerAge, BlockerSendTo, EntryCard, type EntryCardActions } from "./entry-card";
import { weeklyMarkdown } from "./markdown";
import {
  ageTone,
  blockerAgeDays,
  openBlockers,
  personKey,
  resolvedBlockers,
  shortDay,
} from "./model";
import { ParticipationChart } from "./participation-chart";

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 text-center">
      <p className={cn("text-fluid-h3 font-data font-bold", tone)}>{value}</p>
      <p className="mt-0.5 text-xs text-sub">{label}</p>
    </div>
  );
}

function EntryGrid({
  entries,
  today,
  editingId,
  actions,
}: {
  entries: readonly StandupEntry[];
  today: string;
  editingId: string | null;
  actions: EntryCardActions;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          today={today}
          editing={editingId === e.id}
          actions={actions}
        />
      ))}
    </div>
  );
}

/**
 * Today's updates, in the order they were posted, with how many are still
 * to come. In async mode this is the digest, with Copy and a Markdown export
 * of the same text the agent's digest gives.
 */
export function TodayView({
  mode,
  entries,
  today,
  notYet,
  editingId,
  actions,
  onLoadExample,
  onCopyDigest,
}: {
  mode: StandupMode;
  /** Every entry (the first-run state needs to know there are none at all). */
  entries: readonly StandupEntry[];
  today: string;
  notYet: readonly string[];
  editingId: string | null;
  actions: EntryCardActions;
  onLoadExample: () => void;
  onCopyDigest: (digest: string) => void;
}) {
  const todays = useMemo(
    () => entries.filter((e) => e.date === today).sort((a, b) => a.timestamp - b.timestamp),
    [entries, today]
  );
  const openToday = todays.filter((e) => hasBlocker(e) && !e.blockerResolved).length;
  const digest = useMemo(() => standupDigest(entries, today), [entries, today]);
  const isAsync = mode === "async";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={todays.length} label="Posted" tone="text-accent" />
        <Stat value={notYet.length} label="Not yet" tone="text-warning" />
        <Stat value={openToday} label="Blockers" tone="text-danger" />
      </div>

      {isAsync && todays.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-wider text-sub">Today&apos;s digest</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => onCopyDigest(digest)}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy digest
            </Button>
            <ExportButton
              filename={`standup-digest-${today}`}
              clipboardText={digest}
              markdown={digest}
            />
          </div>
        </div>
      )}

      {todays.length === 0 ? (
        <EmptyState
          icon={isAsync ? Mail : Mic}
          action={entries.length === 0 ? <LoadExampleButton onLoad={onLoadExample} /> : undefined}
        >
          {entries.length === 0
            ? "No standup updates yet. Post the first one above, or load an example to see a filled-in standup."
            : `No updates for ${shortDay(today)} yet. Post the first one above.`}
        </EmptyState>
      ) : (
        <EntryGrid entries={todays} today={today} editingId={editingId} actions={actions} />
      )}

      {/* Async mode has its own "Who hasn't posted" panel. */}
      {!isAsync && notYet.length > 0 && todays.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-sub">Not posted yet</p>
          <ul className="flex flex-wrap gap-2">
            {notYet.map((m) => (
              <li
                key={m}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-sub"
              >
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Any day's updates, filtered by person, with the day's digest and the week's. */
export function HistoryView({
  entries,
  today,
  teamSize,
  editingId,
  actions,
}: {
  entries: readonly StandupEntry[];
  today: string;
  teamSize: number;
  editingId: string | null;
  actions: EntryCardActions;
}) {
  const dates = useMemo(
    () =>
      Array.from(new Set([today, ...entries.map((e) => e.date)])).sort((a, b) =>
        b.localeCompare(a)
      ),
    [entries, today]
  );
  const people = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const e of entries)
      if (!byKey.has(personKey(e.member))) byKey.set(personKey(e.member), e.member);
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [entries]);
  const [date, setDate] = useState(today);
  const [person, setPerson] = useState("all");
  const day = dates.includes(date) ? date : today;
  const shown = entries
    .filter(
      (e) => e.date === day && (person === "all" || personKey(e.member) === personKey(person))
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  const digest = useMemo(() => standupDigest(entries, day), [entries, day]);
  const weekly = useMemo(() => weeklyMarkdown(entries), [entries]);
  const select =
    "h-11 max-w-full rounded-md border border-border bg-surface-deep px-3 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:h-9";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
          <select
            value={day}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Day"
            className={select}
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {d === today ? `Today (${shortDay(d)})` : `${shortDay(d)} · ${d}`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <User className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            aria-label="Filter by person"
            className={select}
          >
            <option value="all">Everyone</option>
            {people.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <span className="text-xs text-sub">Day digest</span>
          <ExportButton filename={`standup-${day}`} clipboardText={digest} markdown={digest} />
          <span className="text-xs text-sub">Week</span>
          <ExportButton filename="standup-weekly" clipboardText={weekly} markdown={weekly} />
        </div>
      </div>

      {shown.length > 0 ? (
        <EntryGrid entries={shown} today={today} editingId={editingId} actions={actions} />
      ) : (
        <p className="py-8 text-center text-sm text-sub">
          No updates for {shortDay(day)}
          {person !== "all" ? ` from ${person}` : ""}.
        </p>
      )}

      <ParticipationChart entries={entries} today={today} teamSize={teamSize} />
    </div>
  );
}

/** Every open blocker, oldest first with its age, and the resolved ones (to reopen). */
export function BlockersView({
  entries,
  today,
  actions,
}: {
  entries: readonly StandupEntry[];
  today: string;
  actions: EntryCardActions;
}) {
  const open = useMemo(() => openBlockers(entries), [entries]);
  const resolved = useMemo(() => resolvedBlockers(entries), [entries]);

  return (
    <div className="space-y-6">
      <section aria-labelledby="standup-open-blockers">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" />
          <h3
            id="standup-open-blockers"
            className="text-sm font-medium uppercase tracking-wider text-text"
          >
            Open blockers
          </h3>
          {open.length > 0 && (
            <span className="rounded-full border border-danger/30 bg-danger/15 px-2 text-xs font-data text-danger">
              {open.length}
            </span>
          )}
        </div>
        {open.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface py-8 text-center text-sm text-sub">
            <CheckCircle2
              className="mx-auto mb-2 h-8 w-8 text-success opacity-60"
              aria-hidden="true"
            />
            No open blockers. All clear!
          </div>
        ) : (
          <ul className="space-y-3">
            {open.map((e) => (
              <li
                key={e.id}
                className={cn("rounded-lg border p-4", AGE_BOX[ageTone(blockerAgeDays(e, today))])}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <User className="h-3.5 w-3.5 shrink-0 text-sub" aria-hidden="true" />
                  <span className="text-sm font-medium text-text">{e.member}</span>
                  <span className="text-xs text-sub font-data">{shortDay(e.date)}</span>
                  <span className="ml-auto">
                    <BlockerAge entry={e} today={today} />
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">
                  {e.blockers}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  <BlockerSendTo entry={e} onLinksChange={actions.onLinksChange} />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => actions.onResolve(e)}
                    className="gap-1.5 text-xs text-success hover:bg-success/10 hover:text-success"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Resolve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 && (
        <section aria-labelledby="standup-resolved-blockers">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            <h3
              id="standup-resolved-blockers"
              className="text-sm font-medium uppercase tracking-wider text-sub"
            >
              Resolved
            </h3>
          </div>
          <ul className="space-y-2">
            {resolved.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3"
              >
                <span className="text-sm font-medium text-sub">{e.member}</span>
                <span className="min-w-0 flex-1 break-words text-sm text-sub line-through">
                  {e.blockers}
                </span>
                <span className="text-xs text-sub font-data">{shortDay(e.date)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-xs"
                  aria-label={`Reopen ${e.member}'s blocker`}
                  onClick={() => actions.onReopen(e)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reopen
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
