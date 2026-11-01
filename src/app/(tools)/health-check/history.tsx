"use client";

import Link from "next/link";
import { Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { liveLink } from "@/lib/handoffs/registry";
import type { HealthCheck, HealthCheckEntry } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  allDimensions,
  checkLabel,
  entryShare,
  redDimensions,
  scoreOf,
  sharePct,
  storedLight,
  type HealthDimensionInfo,
} from "@/lib/health-check/score";
import { cn } from "@/lib/utils";
import { TrafficDot } from "./dimension-row";

function healthTone(pct: number | null): string {
  if (pct === null) return "text-sub";
  return pct >= 75 ? "text-success" : pct >= 50 ? "text-warning" : "text-danger";
}

/** "AB" for "Easy to Release" style column headers; the full name is the title and sr text. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

/** Which of a check's reds are still to send (no live retro link). */
export function unsentReds(e: HealthCheckEntry, doc: HealthCheck): HealthDimensionInfo[] {
  return redDimensions(e, doc).filter((d) => !liveLink(scoreOf(e, d.key)?.sentTo, "retro-topic"));
}

export interface HistoryProps {
  doc: HealthCheck;
  /** Saved checks, newest first. */
  checks: HealthCheckEntry[];
  readOnly: boolean;
  onSendReds: (e: HealthCheckEntry) => void;
  onDelete: (e: HealthCheckEntry) => void;
}

function SendReds({
  entry,
  doc,
  readOnly,
  onSendReds,
}: {
  entry: HealthCheckEntry;
  doc: HealthCheck;
  readOnly: boolean;
  onSendReds: (e: HealthCheckEntry) => void;
}) {
  const reds = redDimensions(entry, doc);
  if (reds.length === 0) return <span className="text-xs text-sub">No reds</span>;
  // An example row an older build wrote into the history: its reds aren't the team's.
  if (isExampleId(entry.id)) {
    return <span className="text-xs text-sub">Example check: clear the example first</span>;
  }
  const unsent = unsentReds(entry, doc);
  if (unsent.length === 0) {
    return (
      <Link href="/retro" className="text-xs font-medium text-success hover:underline">
        Sent · Open retro
      </Link>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs"
      disabled={readOnly}
      onClick={() => onSendReds(entry)}
      aria-label={`Send ${unsent.length} red ${unsent.length === 1 ? "dimension" : "dimensions"} of ${checkLabel(entry)} to the retro`}
    >
      <Send className="h-3.5 w-3.5" aria-hidden="true" />
      {unsent.length === reds.length ? "Send reds to retro" : `Send ${unsent.length} more`}
    </Button>
  );
}

/**
 * The saved checks, newest first: each dimension's light, health (yellow
 * counts half), and per check "Send reds to retro" and Delete (with Undo).
 * A table from md up; cards below, so nothing scrolls sideways on a phone.
 * The controls are marked `data-focus-key` ("reds:<id>", "delete:<id>") so
 * the page can put focus back after a send or a delete.
 */
export function HealthHistory({ doc, checks, readOnly, onSendReds, onDelete }: HistoryProps) {
  const dims = allDimensions(doc).filter((d) => checks.some((e) => storedLight(e, d.key) !== null));
  const columns: DataTableColumn<HealthCheckEntry>[] = [
    {
      key: "check",
      header: "Check",
      primary: true,
      cell: (e) => (
        <span className="whitespace-nowrap">
          <span className="font-medium text-text">{checkLabel(e)}</span>
          <span className="ml-2 text-xs text-sub">{e.date}</span>
        </span>
      ),
    },
    ...dims.map(
      (d): DataTableColumn<HealthCheckEntry> => ({
        key: `dim:${d.key}`,
        header: (
          <span title={d.name}>
            <span aria-hidden="true">{initials(d.name)}</span>
            <span className="sr-only">{d.name}</span>
          </span>
        ),
        align: "center",
        cell: (e) => (
          <span className="flex justify-center">
            <TrafficDot light={storedLight(e, d.key)} />
          </span>
        ),
      })
    ),
    {
      key: "health",
      header: "Health",
      align: "right",
      cell: (e) => {
        const pct = sharePct(entryShare(e));
        return (
          <span className={cn("font-data font-semibold", healthTone(pct))}>
            {pct === null ? "—" : `${pct}%`}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (e) => (
        <span className="flex items-center justify-end gap-1">
          <span data-focus-key={`reds:${e.id}`}>
            <SendReds entry={e} doc={doc} readOnly={readOnly} onSendReds={onSendReds} />
          </span>
          <span data-focus-key={`delete:${e.id}`}>
            <IconButton
              label={`Delete the check ${checkLabel(e)}`}
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              disabled={readOnly}
              onClick={() => onDelete(e)}
            />
          </span>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={checks}
      rowKey={(e) => e.id}
      renderCard={(e) => {
        const pct = sharePct(entryShare(e));
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium text-text">{checkLabel(e)}</span>
                <span className="ml-2 text-xs text-sub">{e.date}</span>
              </span>
              <span className={cn("font-data font-semibold", healthTone(pct))}>
                {pct === null ? "—" : `${pct}%`}
              </span>
            </div>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-sub">
              {dims.map((d) => (
                <li key={d.key} className="flex min-w-0 items-center gap-1.5">
                  <TrafficDot light={storedLight(e, d.key)} />
                  <span className="truncate">{d.name}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-1">
              <span data-focus-key={`reds:${e.id}`}>
                <SendReds entry={e} doc={doc} readOnly={readOnly} onSendReds={onSendReds} />
              </span>
              <span data-focus-key={`delete:${e.id}`}>
                <IconButton
                  label={`Delete the check ${checkLabel(e)}`}
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  disabled={readOnly}
                  onClick={() => onDelete(e)}
                />
              </span>
            </div>
          </div>
        );
      }}
    />
  );
}
