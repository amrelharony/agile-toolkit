"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  Pencil,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { hasBlocker } from "@/lib/standup/entries";
import { cn } from "@/lib/utils";
import { EntryEditor } from "./entry-form";
import {
  ageLabel,
  ageTone,
  blockerAgeDays,
  shortDay,
  type AgeTone,
  type EntryValues,
} from "./model";

/** An open blocker can be raised as an impediment (workspace.impediments). */
export const BLOCKER_ROUTES = ["impediment"] as const;

export const AGE_TEXT: Record<AgeTone, string> = {
  fresh: "text-success",
  ageing: "text-warning",
  stale: "text-danger",
};

export const AGE_BOX: Record<AgeTone, string> = {
  fresh: "border-success/30 bg-success/5",
  ageing: "border-warning/30 bg-warning/5",
  stale: "border-danger/30 bg-danger/5",
};

export type LinksUpdate = (links: readonly HandoffLink[] | undefined) => HandoffLink[];

/** The blocker's age as a small clock line: "Raised today", "3 days old". */
export function BlockerAge({ entry, today }: { entry: StandupEntry; today: string }) {
  const days = blockerAgeDays(entry, today);
  const tone = ageTone(days);
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-data", AGE_TEXT[tone])}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      {days === 0 ? "Raised today" : `${ageLabel(days)} old`}
    </span>
  );
}

/** "Send to… Impediment" for an open blocker. */
export function BlockerSendTo({
  entry,
  onLinksChange,
}: {
  entry: StandupEntry;
  onLinksChange: (id: string, update: LinksUpdate) => void;
}) {
  return (
    <SendToMenu
      routes={BLOCKER_ROUTES}
      item={{
        title: entry.blockers,
        raisedBy: entry.member,
        description: `Raised at the standup on ${shortDay(entry.date)}${
          entry.today.trim() ? `. Working on: ${entry.today.trim()}` : ""
        }`,
        // One tool, both modes: the impediment links back to the standup.
        sourceRef: { tool: "standup", id: entry.id },
      }}
      sentTo={entry.sentTo}
      onLinksChange={(update) => onLinksChange(entry.id, update)}
    />
  );
}

export interface EntryCardActions {
  onEdit: (entry: StandupEntry) => void;
  onCancelEdit: () => void;
  onSave: (entry: StandupEntry, values: EntryValues) => void;
  onDelete: (entry: StandupEntry) => void;
  onResolve: (entry: StandupEntry) => void;
  onReopen: (entry: StandupEntry) => void;
  onLinksChange: (id: string, update: LinksUpdate) => void;
}

/** One person's update: what they did, what's next, the blocker and its state. */
export function EntryCard({
  entry,
  today,
  editing,
  actions,
}: {
  entry: StandupEntry;
  today: string;
  editing: boolean;
  actions: EntryCardActions;
}) {
  const blocked = hasBlocker(entry);
  const resolved = blocked && Boolean(entry.blockerResolved);
  const who = entry.member;
  return (
    <article
      aria-label={`${who}'s update`}
      className="min-w-0 space-y-3 rounded-lg border border-border bg-surface-deep p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15"
          aria-hidden="true"
        >
          <User className="h-3.5 w-3.5 text-accent" />
        </span>
        <span className="min-w-0 break-words font-medium text-text">{who}</span>
        {entry.date !== today && (
          <span className="text-xs text-sub font-data">{shortDay(entry.date)}</span>
        )}
        {entry.mode === "async" && (
          <Badge variant="outline" className="gap-1 text-xs">
            <Mail className="h-3 w-3" aria-hidden="true" />
            Async
          </Badge>
        )}
        {blocked && !resolved && (
          <Badge className="gap-1 border-danger/30 bg-danger/15 text-danger">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Blocker
          </Badge>
        )}
        {resolved && (
          <Badge className="gap-1 border-success/30 bg-success/15 text-success">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Resolved
          </Badge>
        )}
        {!editing && (
          <span className="ml-auto flex shrink-0 items-center">
            <IconButton
              label={`Edit ${who}'s update`}
              icon={<Pencil className="h-4 w-4" />}
              className="text-sub hover:text-text"
              onClick={() => actions.onEdit(entry)}
            />
            <IconButton
              label={`Delete ${who}'s update`}
              icon={<Trash2 className="h-4 w-4" />}
              className="text-sub hover:text-danger"
              onClick={() => actions.onDelete(entry)}
            />
          </span>
        )}
      </header>

      {editing ? (
        <EntryEditor
          entry={entry}
          today={today}
          onSave={(values) => actions.onSave(entry, values)}
          onCancel={actions.onCancelEdit}
        />
      ) : (
        <>
          {entry.yesterday.trim() && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-sub">Yesterday</p>
              <p className="whitespace-pre-wrap break-words text-sm text-text">{entry.yesterday}</p>
            </div>
          )}
          {entry.today.trim() && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-sub">Today</p>
              <p className="whitespace-pre-wrap break-words text-sm text-text">{entry.today}</p>
            </div>
          )}
          {(entry.description ?? "").trim() && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-sub">Notes</p>
              <p className="whitespace-pre-wrap break-words text-sm text-sub">
                {entry.description}
              </p>
            </div>
          )}
          {blocked && (
            <div
              className={cn(
                "space-y-2 rounded-md border p-3",
                resolved ? "border-border bg-card" : "border-danger/30 bg-danger/5"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wider text-sub">Blocker</p>
                {!resolved && <BlockerAge entry={entry} today={today} />}
              </div>
              <p
                className={cn(
                  "whitespace-pre-wrap break-words text-sm",
                  resolved ? "text-sub line-through" : "text-danger"
                )}
              >
                {entry.blockers}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {resolved ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-xs"
                    onClick={() => actions.onReopen(entry)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Reopen
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-xs text-success hover:bg-success/10 hover:text-success"
                      onClick={() => actions.onResolve(entry)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Mark resolved
                    </Button>
                    <BlockerSendTo entry={entry} onLinksChange={actions.onLinksChange} />
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}
