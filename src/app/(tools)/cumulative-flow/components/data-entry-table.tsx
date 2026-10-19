"use client";

/**
 * Per-snapshot data entry table: one row per dated snapshot with a per-column
 * count input, an optional note, and remove. Header carries the "Add Date"
 * action (dedupe + logging handled by the parent's onAddEntry).
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { BarChart2, Plus, Trash2 } from "lucide-react";
import type { CFDStore, DataEntry, StatusColumn } from "../types";

export function DataEntryTable({
  sortedEntries,
  columns,
  hasEntries,
  onUpdateEntry,
  onUpdateCount,
  onRemoveEntry,
  onAddEntry,
}: {
  sortedEntries: DataEntry[];
  columns: StatusColumn[];
  hasEntries: boolean;
  onUpdateEntry: CFDStore["updateEntry"];
  onUpdateCount: CFDStore["updateEntryCount"];
  onRemoveEntry: CFDStore["removeEntry"];
  onAddEntry: CFDStore["addEntry"];
}) {
  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-display text-text">
            <BarChart2 className="w-4 h-4 text-accent" />
            Data Entries
          </CardTitle>
          <Button size="sm" variant="toolkit" onClick={onAddEntry} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Add Date
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasEntries ? (
          <p className="text-sm text-sub text-center py-6">
            No entries yet. Click &ldquo;Add Date&rdquo; to start tracking.
          </p>
        ) : (
          <div className="table-wrap-responsive">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-xs text-sub font-medium uppercase tracking-wider">
                    Date
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.id}
                      className="text-center py-2 px-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap"
                      style={{ color: col.color }}
                    >
                      {col.name}
                    </th>
                  ))}
                  <th className="text-left py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider whitespace-nowrap">
                    Note
                  </th>
                  <th className="w-8">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-border hover:bg-card">
                    <td className="py-2 pr-4">
                      <Input
                        type="date"
                        value={entry.date}
                        onChange={(e) => {
                          const v = e.target.value;
                          // Reject blank — date is required for chart x-axis.
                          if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                            onUpdateEntry(entry.id, { date: v });
                          }
                        }}
                        className="h-8 w-36 bg-surface-deep border-border text-text text-sm focus:border-accent/50"
                        aria-label="Snapshot date"
                      />
                    </td>
                    {columns.map((col) => (
                      <td key={col.id} className="py-2 px-3 text-center">
                        <Input
                          type="number"
                          min={0}
                          value={entry.counts[col.id] ?? 0}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n)) {
                              onUpdateCount(entry.id, col.id, Math.max(0, n));
                            }
                          }}
                          className="h-8 w-20 mx-auto bg-surface-deep border-border text-text font-data text-center focus:border-accent/50"
                          aria-label={`${col.name} count on ${entry.date}`}
                        />
                      </td>
                    ))}
                    {/* Compact single-line note input — dense table row. */}
                    <td className="py-2 px-3">
                      <BlurInput
                        placeholder="Optional note..."
                        value={entry.description ?? ""}
                        onCommit={(v) =>
                          onUpdateEntry(entry.id, {
                            description: v.trim() ? v : undefined,
                          })
                        }
                        className="h-8 min-w-[140px] bg-surface-deep border-border text-text text-xs focus:border-accent/50"
                        aria-label={`Note for ${entry.date}`}
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onRemoveEntry(entry.id)}
                        aria-label={`Remove snapshot for ${entry.date}`}
                        className="text-sub hover:text-danger transition-colors p-1"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
