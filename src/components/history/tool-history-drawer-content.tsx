"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Sparkles, RotateCcw } from "lucide-react";
import { useHistory } from "@/lib/history/use-history";
import { formatActionLabel } from "@/lib/history/event-actions";
import { useTimeTravel } from "@/lib/stores/use-time-travel";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * Heavy body of the per-tool history drawer. Split into its own file so
 * `tool-history-drawer.tsx` can `next/dynamic`-import it — the drawer
 * opens infrequently and pulls in `useHistory`, `useTimeTravel`, the
 * grouped-by-day rendering path, and several lucide icons.
 */

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  // Guard against clock skew (multiplayer sync from a peer with a faster
  // clock, or system time adjustments) — without this the UI shows
  // nonsense like "-3s ago" for events that arrived from the future.
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function dayKey(iso: string): string {
  // `new Date(invalid).toISOString()` throws RangeError, which would
  // crash the entire history drawer if a single stored event has a
  // malformed `occurredAt` (corruption, manual storage edit, future
  // schema migration that drops a field). Guard with isFinite first
  // and bucket bad entries under "unknown" so they remain visible but
  // grouped together.
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  // Mirror dayKey's invalid-date defence so a malformed timestamp
  // surfaces as "Unknown date" rather than literal "Invalid Date".
  if (!Number.isFinite(d.getTime())) return "Unknown date";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function summarisePayload(payload: Record<string, unknown> | unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const entries = Object.entries(payload as Record<string, unknown>).slice(0, 2);
  return entries
    .map(([k, v]) => {
      const str =
        typeof v === "string"
          ? v
          : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v);
      const trimmed = str.length > 30 ? `${str.slice(0, 30)}…` : str;
      return `${k}: ${trimmed}`;
    })
    .join(" • ");
}

interface Props {
  toolId: string;
  onClose: () => void;
}

// R10-deferred: window the rendered list to avoid mounting 200 button
// elements + 200 nested JSON panels on open. The drawer is scrollable
// so users typically only see the top ~10 — render in chunks.
const INITIAL_RENDER_LIMIT = 50;
const RENDER_CHUNK = 50;

export default function ToolHistoryDrawerContent({ toolId, onClose }: Props) {
  const { events, total } = useHistory({ toolId, limit: 200 });
  const [selected, setSelected] = useState<HistoryEvent | null>(null);
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_LIMIT);
  const timeTravel = useTimeTravel(toolId);

  // R10-deferred: reset render limit when the events identity changes
  // (e.g., a new event lands while the drawer is open) so we always
  // start from the top with the chunk size.
  useEffect(() => {
    setRenderLimit(INITIAL_RENDER_LIMIT);
  }, [events]);

  const grouped = useMemo(() => {
    const groups = new Map<string, HistoryEvent[]>();
    // R10-deferred: cap at `renderLimit` — the rest is reachable via
    // "Load more" which expands the limit in chunks.
    for (const event of events.slice(0, renderLimit)) {
      const k = dayKey(event.occurredAt);
      const arr = groups.get(k) ?? [];
      arr.push(event);
      groups.set(k, arr);
    }
    return Array.from(groups.entries());
  }, [events, renderLimit]);

  const hasMore = events.length > renderLimit;

  const restoreToEvent = (event: HistoryEvent) => {
    if (!timeTravel.controls) {
      toast.error("This tool does not support time-travel restore yet.");
      return;
    }
    const currentPast = timeTravel.controls.pastLength();
    let stepsBack: number;
    if (typeof event.undoIndex === "number") {
      stepsBack = currentPast - event.undoIndex;
    } else {
      const idx = events.findIndex(
        (e) => e.clientEventId === event.clientEventId
      );
      if (idx < 0) return;
      stepsBack = idx;
    }
    if (stepsBack <= 0) {
      toast.error("That moment is already current state.");
      return;
    }
    let undone = 0;
    for (let i = 0; i < stepsBack; i++) {
      if (!timeTravel.controls.undo()) break;
      undone += 1;
    }
    if (undone > 0) {
      toast.success(
        `Restored — stepped back ${undone} action${undone === 1 ? "" : "s"}.`
      );
      onClose();
    } else {
      toast.error("Nothing to restore (undo stack empty).");
    }
  };

  return (
    <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
      <SheetHeader className="p-4 sm:p-5 border-b border-border">
        <SheetTitle className="flex items-center gap-2">
          <History className="w-4 h-4 text-accent" aria-hidden="true" />
          Tool history
        </SheetTitle>
        <SheetDescription>
          {total === 0
            ? "No events yet. Use the tool — actions will appear here."
            : `${total} event${total === 1 ? "" : "s"} in this tool.`}
        </SheetDescription>
      </SheetHeader>

      <ScrollArea className="flex-1">
        {events.length === 0 ? (
          <div className="p-8 text-center text-sub text-sm">
            <Sparkles
              className="w-8 h-8 mx-auto mb-3 text-accent/40"
              aria-hidden="true"
            />
            <p>Your actions will be tracked here.</p>
            <p className="text-xs mt-1">
              Sign in for cross-device history and AI insights.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {grouped.map(([day, dayEvents]) => (
              <div key={day}>
                <div className="sticky top-0 bg-[var(--card)]/90 backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-sub uppercase tracking-wide border-b border-border">
                  {dayLabel(dayEvents[0].occurredAt)}
                </div>
                {dayEvents.map((event) => {
                  const isSelected =
                    selected?.clientEventId === event.clientEventId;
                  return (
                    <button
                      key={event.clientEventId}
                      type="button"
                      onClick={() =>
                        setSelected(isSelected ? null : event)
                      }
                      className={cn(
                        "w-full text-left px-4 py-2.5 hover:bg-accent/5 transition",
                        isSelected && "bg-accent/5"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-text truncate">
                            {formatActionLabel(event.action)}
                          </span>
                          {event.isMilestone && (
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 h-4"
                            >
                              milestone
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] text-sub shrink-0">
                          {timeAgo(event.occurredAt)}
                        </span>
                      </div>
                      {summarisePayload(event.payload) && (
                        <div className="text-xs text-sub mt-0.5 truncate">
                          {summarisePayload(event.payload)}
                        </div>
                      )}
                      {isSelected && (
                        <div className="mt-2 space-y-2">
                          <pre className="text-[10px] bg-[var(--card)] border border-border rounded p-2 overflow-x-auto font-mono leading-tight">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                          {timeTravel.available && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                restoreToEvent(event);
                              }}
                              disabled={!timeTravel.canUndo}
                              className="w-full gap-1.5 text-xs"
                            >
                              <RotateCcw
                                className="w-3 h-3"
                                aria-hidden="true"
                              />
                              Restore to here
                            </Button>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {hasMore && (
              <div className="p-3 text-center border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRenderLimit((n) => n + RENDER_CHUNK)}
                  className="text-xs"
                >
                  Load {Math.min(RENDER_CHUNK, events.length - renderLimit)} more
                </Button>
                <div className="text-[10px] text-sub mt-1">
                  Showing {renderLimit} of {events.length}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </SheetContent>
  );
}
