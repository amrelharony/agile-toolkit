"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ListPlus, Pencil, RotateCcw, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceLink } from "@/components/handoff/source-link";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { localDay } from "@/lib/sprints/series";
import {
  BUG_CLOSE_REASONS,
  type BugCloseReason,
  type BugReport,
} from "@/lib/stores/workspace-types";
import {
  CELL_ADVICE,
  CLOSE_REASON_LABEL,
  PRIORITY_LABEL,
  ROUTE_PLACE,
  SEVERITY_LABEL,
  STATUS_LABEL,
  ageDays,
  bugLinks,
  duplicateProblem,
  fixByDay,
  isBugRoute,
  isOpen,
  keptLink,
  mismatched,
  needsTriage,
  oldestFirst,
  onGrid,
  overTarget,
  routeFor,
  workDone,
  type BugLinkSlices,
  type BugRoute,
  type LinkState,
} from "@/lib/bug-triage/model";
import type { BugValues } from "@/lib/bug-triage/model";
import { isExampleId } from "@/lib/utils/example-id";
import { SelectField } from "./fields";
import { LogForm, draftOf } from "./log-form";
import { TriageForm, type Placement } from "./triage-form";

/** What the page does to a bug; each write has its Undo or is a plain save. */
export interface BugActions {
  send: (bug: BugReport, route: BugRoute) => void;
  close: (bug: BugReport, reason: BugCloseReason, duplicateOf?: string) => void;
  reopen: (bug: BugReport) => void;
  remove: (bug: BugReport) => void;
  place: (bug: BugReport, placed: Placement) => void;
  edit: (bug: BugReport, values: BugValues) => void;
  open: (id: string) => void;
}

export const EXAMPLE_NOT_SENT = "Example bugs aren't sent: clear the example and log your own.";
export const NO_SPRINT = "No sprint is running, so it can't be logged as an interrupt.";

const STATE_TEXT: Readonly<Record<LinkState, string>> = {
  live: "there",
  done: "its work is done",
  gone: "gone from there",
};

/** "today", "1 day ago", "4 days ago". */
export function ageText(days: number): string {
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/** "12 Nov": a day as the page reads it. */
export function dayText(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : day;
}

/**
 * Where a placed bug goes next, by its priority: now logs an interrupt in
 * the running sprint (or says no sprint is running and offers the backlog),
 * next or later adds it to the backlog, some day says close it. A route it
 * already went by shows "Sent · Open" while that item is there, as does the
 * backlog for a fix-now bug sent there because no sprint was running.
 */
export function SendButtons({
  bug,
  slices,
  sprintRunning,
  onSend,
}: {
  bug: BugReport;
  slices: BugLinkSlices;
  sprintRunning: boolean;
  onSend: (route: BugRoute) => void;
}) {
  const route = routeFor(bug.priority);
  const example = isExampleId(bug.id);
  if (!route) {
    return (
      <p className="text-sm text-sub">
        {bug.severity && bug.priority ? `${CELL_ADVICE[bug.severity][bug.priority]}.` : ""}
      </p>
    );
  }
  const noSprint = route === "interrupt" && !sprintRunning;
  // With no sprint running, a fix-now bug may have gone to the backlog instead.
  const sentBy: BugRoute | null = keptLink(bug, route, slices)
    ? route
    : noSprint && keptLink(bug, "backlog-story", slices)
      ? "backlog-story"
      : null;
  const kept = sentBy ? keptLink(bug, sentBy, slices) : undefined;
  if (sentBy && kept) {
    const target = getHandoffRoute(sentBy);
    return (
      <p className="text-sm text-sub">
        {sentBy === "interrupt" ? "Logged as an interrupt" : "On the backlog"}.{" "}
        <Link href={target.targetHref(kept.targetId)} className="text-accent hover:underline">
          Open {sentBy === "interrupt" ? "the Interrupt Buffer" : "Sprint Planning"}
        </Link>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={example || noSprint}
          onClick={() => onSend(route)}
        >
          {route === "interrupt" ? <Zap aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
          {route === "interrupt" ? "Log as an interrupt" : "Add to the backlog"}
        </Button>
        {noSprint && !example && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => onSend("backlog-story")}
          >
            <ListPlus aria-hidden="true" />
            Add to the backlog instead
          </Button>
        )}
      </div>
      {example ? (
        <p className="text-xs text-sub">{EXAMPLE_NOT_SENT}</p>
      ) : noSprint ? (
        <p className="text-xs text-sub" role="status">
          {NO_SPRINT}
        </p>
      ) : null}
    </div>
  );
}

/** Close with a reason; a duplicate picks the bug it repeats. */
function ClosePanel({
  bug,
  bugs,
  initialReason,
  onClose,
}: {
  bug: BugReport;
  bugs: readonly BugReport[];
  initialReason: BugCloseReason;
  onClose: (reason: BugCloseReason, duplicateOf?: string) => void;
}) {
  const [reason, setReason] = useState<BugCloseReason>(initialReason);
  const [dup, setDup] = useState(bug.duplicateOf ?? "");
  const [error, setError] = useState<string | null>(null);
  const others = oldestFirst(bugs.filter((b) => b.id !== bug.id));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField
        label="Close as"
        value={reason}
        className="min-w-0 flex-1 basis-40"
        options={BUG_CLOSE_REASONS.map((r) => ({ value: r, label: CLOSE_REASON_LABEL[r] }))}
        onChange={(v) => {
          setReason(v as BugCloseReason);
          setError(null);
        }}
      />
      {reason === "duplicate" && (
        <SelectField
          label="Of the bug"
          value={dup}
          className="min-w-0 flex-1 basis-48"
          error={error ?? undefined}
          options={[
            { value: "", label: "Pick the bug it repeats" },
            ...others.map((b) => ({ value: b.id, label: b.title })),
          ]}
          onChange={(v) => {
            setDup(v);
            setError(null);
          }}
        />
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => {
          if (reason === "duplicate") {
            const problem = duplicateProblem(bug, dup || undefined, bugs);
            if (problem) {
              setError(problem);
              return;
            }
          }
          onClose(reason, reason === "duplicate" ? dup : undefined);
        }}
      >
        <CheckCircle2 aria-hidden="true" />
        Close bug
      </Button>
    </div>
  );
}

/** One bug, open: its details, where it went, and everything that can be done with it. */
export function BugDetail({
  bug,
  bugs,
  slices,
  today,
  sprintRunning,
  actions,
  onDismiss,
  headingRef,
}: {
  bug: BugReport;
  bugs: readonly BugReport[];
  slices: BugLinkSlices;
  today: string;
  sprintRunning: boolean;
  actions: BugActions;
  onDismiss: () => void;
  headingRef?: (el: HTMLHeadingElement | null) => void;
}) {
  const [editing, setEditing] = useState<"details" | "place" | null>(null);
  const age = ageDays(bug, today);
  const fixBy = fixByDay(bug);
  const late = overTarget(bug, today);
  const links = bugLinks(bug, slices).filter(({ link }) => isBugRoute(link.route));
  const done = workDone(bug, slices);
  const dupOf = bug.duplicateOf ? bugs.find((b) => b.id === bug.duplicateOf) : undefined;

  return (
    <section
      aria-labelledby="bug-detail-title"
      className="space-y-3 rounded-lg border border-accent/40 bg-card p-4"
      data-bug-detail={bug.id}
    >
      <div className="flex items-start gap-2">
        <h2
          id="bug-detail-title"
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 break-words text-base font-semibold text-text focus:outline-none"
        >
          {bug.title}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Close this bug's panel"
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className="text-sm text-sub">
        {STATUS_LABEL[bug.status]}
        {bug.severity && bug.priority && (
          <>
            {" · "}
            {SEVERITY_LABEL[bug.severity]} × {PRIORITY_LABEL[bug.priority]}
            {mismatched(bug.severity, bug.priority) && isOpen(bug) && (
              <span className="font-semibold text-warning"> · Check</span>
            )}
          </>
        )}
        {" · logged "}
        {ageText(age)}
        {fixBy && isOpen(bug) && ` · fix by ${dayText(fixBy)}`}
        {late && <span className="font-semibold text-danger"> · over target</span>}
        {bug.status === "closed" && bug.closeReason && (
          <> · closed as {CLOSE_REASON_LABEL[bug.closeReason].toLowerCase()}</>
        )}
        {dupOf && (
          <>
            {" of "}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => actions.open(dupOf.id)}
            >
              “{dupOf.title}”
            </button>
          </>
        )}
      </p>
      <SourceLink sourceRef={bug.sourceRef} />

      {(bug.steps ||
        bug.expected ||
        bug.actual ||
        bug.environment ||
        bug.area ||
        bug.reportedBy) && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {(
            [
              ["Steps", bug.steps],
              ["Expected", bug.expected],
              ["What happened", bug.actual],
              ["Where", bug.environment],
              ["Area", bug.area],
              ["Found by", bug.reportedBy],
            ] as const
          ).map(([label, value]) =>
            value ? (
              <div key={label} className="contents">
                <dt className="font-medium text-sub">{label}</dt>
                <dd className="mb-1 whitespace-pre-line break-words text-text">{value}</dd>
              </div>
            ) : null
          )}
        </dl>
      )}

      {links.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Where it went">
          {links.map(({ link, state }) => (
            <li key={`${link.route}:${link.targetId}`} className="text-sub">
              Sent to {ROUTE_PLACE[link.route as BugRoute]}{" "}
              {dayText(localDay(link.at) ?? link.at.slice(0, 10))}:{" "}
              {state === "gone" ? (
                STATE_TEXT[state]
              ) : (
                <Link
                  href={getHandoffRoute(link.route).targetHref(link.targetId)}
                  className="text-accent hover:underline"
                >
                  {STATE_TEXT[state]}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {done && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-success/40 px-3 py-2">
          <p className="min-w-0 flex-1 text-sm text-text">Fixed? Its work is done.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => actions.close(bug, "fixed")}
          >
            <CheckCircle2 aria-hidden="true" />
            Close as fixed
          </Button>
        </div>
      )}

      {isOpen(bug) && needsTriage(bug) && (
        <TriageForm bug={bug} onSave={(placed) => actions.place(bug, placed)} />
      )}

      {onGrid(bug) && (
        <>
          <SendButtons
            bug={bug}
            slices={slices}
            sprintRunning={sprintRunning}
            onSend={(route) => actions.send(bug, route)}
          />
          {editing === "place" ? (
            <TriageForm
              bug={bug}
              saveLabel="Move it"
              onSave={(placed) => {
                actions.place(bug, placed);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </>
      )}

      {editing === "details" && (
        <LogForm
          initial={draftOf(bug)}
          offerAddToRoster={!isExampleId(bug.id)}
          onSave={(values) => {
            actions.edit(bug, values);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {isOpen(bug) && (
        <ClosePanel
          key={bug.id}
          bug={bug}
          bugs={bugs}
          initialReason={done ? "fixed" : "wont-fix"}
          onClose={(reason, duplicateOf) => actions.close(bug, reason, duplicateOf)}
        />
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {onGrid(bug) && editing !== "place" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => setEditing("place")}
          >
            <Pencil aria-hidden="true" />
            Change severity or priority
          </Button>
        )}
        {editing !== "details" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => setEditing("details")}
          >
            <Pencil aria-hidden="true" />
            Edit details
          </Button>
        )}
        {!isOpen(bug) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => actions.reopen(bug)}
          >
            <RotateCcw aria-hidden="true" />
            Reopen
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1"
          onClick={() => actions.remove(bug)}
        >
          <Trash2 aria-hidden="true" />
          Delete bug
        </Button>
      </div>
    </section>
  );
}
