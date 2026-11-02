"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Download, Filter, History as HistoryIcon, Sparkles, Calendar } from "lucide-react";
import { useHistory } from "@/lib/history/use-history";
import { useHistoryStore } from "@/lib/history/history-store";
import { useAuth } from "@/lib/auth/auth-provider";
import { tools as ALL_TOOLS } from "@/lib/constants/tools";
import { formatActionLabel } from "@/lib/history/event-actions";
import {
  exportEventsAsCSV,
  exportEventsAsJSON,
  exportEventsAsMarkdown,
} from "@/lib/history/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { HistoryEvent } from "@/lib/history/types";

const RANGE_PRESETS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "all", label: "All", days: null },
] as const;

type RangeId = (typeof RANGE_PRESETS)[number]["id"];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export default function HistoryPage() {
  const { status } = useAuth();
  const syncStatus = useHistoryStore((s) => s.syncStatus);
  const lastSyncAt = useHistoryStore((s) => s.lastSyncAt);

  const [rangeId, setRangeId] = useState<RangeId>("30d");
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const since = useMemo(() => {
    const preset = RANGE_PRESETS.find((p) => p.id === rangeId);
    if (!preset || preset.days === null) return undefined;
    const d = new Date();
    d.setDate(d.getDate() - preset.days);
    return d.toISOString();
  }, [rangeId]);

  const { events: rawEvents, total } = useHistory({
    toolId: toolFilter === "all" ? undefined : toolFilter,
    since,
    milestonesOnly,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rawEvents;
    const q = search.toLowerCase();
    return rawEvents.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.toolId.toLowerCase().includes(q) ||
        JSON.stringify(e.payload).toLowerCase().includes(q)
    );
  }, [rawEvents, search]);

  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Slice with the CLAMPED page, not the raw one. When `filtered` shrinks
  // without user input — the nightly `purge_old_history_events` cron trimming
  // >90-day rows while the user sits on page 3 — the footer clamped to "Page
  // 2 of 2" but the list still sliced at [100,150) and rendered empty.
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toolName = (toolId: string) => ALL_TOOLS.find((t) => t.id === toolId)?.name ?? toolId;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="container-meta"
    >
      {/* Header */}
      <div className="panel mb-4 sm:mb-6 flex items-start justify-between gap-3 flex-wrap px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
            <HistoryIcon className="w-5 h-5 text-accent" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-fluid-h2 font-display font-bold text-text leading-tight">
              History
            </h1>
            <p className="text-fluid-body text-sub mt-1">
              Every meaningful action, across every tool — searchable, filterable, exportable.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {status === "authenticated" ? (
            <Badge variant={syncStatus === "error" ? "destructive" : "secondary"} className="gap-1">
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {syncStatus === "syncing"
                ? "Syncing…"
                : syncStatus === "error"
                  ? "Sync error"
                  : `Synced${lastSyncAt ? ` • ${timeAgo(lastSyncAt)}` : ""}`}
            </Badge>
          ) : status !== "loading" ? (
            // Visitors (and an owner whose check hasn't completed): nothing
            // leaves the browser, so offer the backup right here.
            <>
              <Badge variant="outline">Saved in this browser only</Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => exportEventsAsJSON(useHistoryStore.getState().events)}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Export JSON
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Filters bar */}
      <div className="bg-[var(--card)] border border-border rounded-lg p-3 sm:p-4 mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] items-center">
        <div className="relative">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-sub pointer-events-none"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search action, payload, tool…"
            className="pl-9 bg-surface-deep"
            aria-label="Search history"
          />
        </div>

        <Select
          value={toolFilter}
          onValueChange={(v) => {
            setToolFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="Filter by tool" className="w-full sm:w-48 bg-surface-deep">
            <SelectValue placeholder="All tools" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tools</SelectItem>
            {/* Reading entries (the comic) never record history. */}
            {ALL_TOOLS.filter((t) => t.kind !== "reading").map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-sub cursor-pointer">
            <Switch
              checked={milestonesOnly}
              onCheckedChange={(v) => {
                setMilestonesOnly(v);
                setPage(0);
              }}
            />
            <span>Milestones</span>
          </label>
        </div>
      </div>

      {/* Range presets + count + export */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div role="group" aria-label="Date range" className="flex items-center gap-1 flex-wrap">
          <Calendar className="w-3.5 h-3.5 text-sub mr-1" aria-hidden="true" />
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setRangeId(p.id);
                setPage(0);
              }}
              aria-pressed={rangeId === p.id}
              className={cn(
                "min-touch-coarse px-2.5 py-1 text-xs rounded-md transition-colors",
                rangeId === p.id
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "text-sub border border-transparent hover:bg-accent/5"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-sub">
            {filtered.length} / {total} events
          </span>
          <Select
            onValueChange={(v) => {
              if (v === "json") exportEventsAsJSON(filtered);
              else if (v === "csv") exportEventsAsCSV(filtered);
              else if (v === "md") exportEventsAsMarkdown(filtered);
            }}
          >
            <SelectTrigger aria-label="Export events" className="w-32 h-8 text-xs">
              <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              <SelectValue placeholder="Export" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="md">Markdown</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results list */}
      <div className="bg-[var(--card)] border border-border rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState hasAnyEvents={total > 0} />
        ) : (
          <>
            <ScrollArea className="max-h-[60vh]">
              <ul className="divide-y divide-border">
                {visible.map((event) => (
                  <EventRow
                    key={event.clientEventId}
                    event={event}
                    expanded={expanded === event.clientEventId}
                    onToggle={() =>
                      setExpanded(expanded === event.clientEventId ? null : event.clientEventId)
                    }
                    toolName={toolName(event.toolId)}
                  />
                ))}
              </ul>
            </ScrollArea>
            {pageCount > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-sub">
                <span>
                  Page {safePage + 1} of {pageCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function EmptyState({ hasAnyEvents }: { hasAnyEvents: boolean }) {
  return (
    <div className="p-12 text-center text-sub">
      <Filter className="w-10 h-10 mx-auto mb-3 text-accent/30" aria-hidden="true" />
      {hasAnyEvents ? (
        <>
          <p className="text-sm font-medium text-text">No matches</p>
          <p className="text-xs mt-1">Try clearing filters or a wider date range.</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-text">Nothing here yet</p>
          <p className="text-xs mt-1">Open any tool — actions are recorded automatically.</p>
        </>
      )}
    </div>
  );
}

interface EventRowProps {
  event: HistoryEvent;
  toolName: string;
  expanded: boolean;
  onToggle: () => void;
}

function EventRow({ event, toolName, expanded, onToggle }: EventRowProps) {
  const payloadId = `history-payload-${event.clientEventId}`;
  return (
    // The payload sits beside the toggle, not inside it: inside the button
    // the whole JSON dump became part of the button's accessible name.
    <li className={cn(expanded && "bg-accent/5")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? payloadId : undefined}
        className={cn(
          "w-full text-left px-4 pt-3 transition-colors",
          expanded ? "pb-0" : "pb-3",
          // Inset ring: the list scrolls inside an overflow container that
          // would clip the global offset outline at its edges.
          "hover:bg-accent/5 focus-visible:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        )}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="text-xs shrink-0">
              {toolName}
            </Badge>
            <span className="text-sm font-medium text-text truncate">
              {formatActionLabel(event.action)}
            </span>
            {event.isMilestone && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                milestone
              </Badge>
            )}
            {event.syncedAt && (
              <Sparkles
                className="w-3 h-3 text-accent shrink-0"
                role="img"
                aria-label="Synced to cloud"
              />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline text-xs text-sub font-mono">
              {event.occurredAt.slice(11, 16)}
            </span>
            <span className="text-xs text-sub">{timeAgo(event.occurredAt)}</span>
          </div>
        </div>
      </button>
      {expanded && (
        <div id={payloadId} className="px-4 pb-3">
          <pre className="mt-2 text-xs bg-surface-deep border border-border rounded p-2 overflow-x-auto font-mono leading-tight whitespace-pre-wrap break-all">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}
