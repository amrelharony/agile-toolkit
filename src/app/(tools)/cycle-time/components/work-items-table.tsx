"use client";

/**
 * Editable work-items table: name + optional description, start/end dates, the
 * derived cycle time, and per-row remove. Header carries the "N / M with cycle
 * time" badge plus Reset / Add controls.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { Badge } from "@/components/ui/badge";
import { Clock, Plus, Trash2 } from "lucide-react";
import type { CycleTimeStore, WorkItemWithCycleTime } from "../types";

export function WorkItemsTable({
  items,
  totalCount,
  validCount,
  onUpdate,
  onRemove,
  onAdd,
  onReset,
}: {
  items: WorkItemWithCycleTime[];
  totalCount: number;
  validCount: number;
  onUpdate: CycleTimeStore["updateItem"];
  onRemove: CycleTimeStore["removeItem"];
  onAdd: CycleTimeStore["addItem"];
  onReset: CycleTimeStore["reset"];
}) {
  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-display text-text">
            <Clock className="w-4 h-4 text-accent" />
            Work Items
            <Badge variant="outline" className="border-border text-sub text-xs ml-1">
              {validCount} / {totalCount} with cycle time
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="danger-ghost" size="sm" onClick={onReset}>
              Reset
            </Button>
            <Button size="sm" variant="toolkit" onClick={onAdd} className="gap-1.5">
              <Plus className="w-4 h-4" />
              Add Item
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="table-wrap-responsive">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 text-xs text-sub font-medium uppercase tracking-wider">
                  Item Name
                </th>
                <th className="text-left py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider">
                  Start Date
                </th>
                <th className="text-left py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider">
                  End Date
                </th>
                <th className="text-center py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider">
                  Cycle Time
                </th>
                <th className="w-8">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-card-hover">
                  <td className="py-2 pr-4">
                    {/* Compact single-line Input below the name keeps the
                        tabular row tidy. Description is optional; empty
                        string is normalized to undefined on commit. */}
                    <div className="space-y-1">
                      <BlurInput
                        placeholder="Feature or story name"
                        aria-label="Item name"
                        value={item.name}
                        onCommit={(v) => onUpdate(item.id, { name: v })}
                        className="h-8 input-toolkit"
                      />
                      <BlurInput
                        placeholder="Description (optional)..."
                        value={item.description ?? ""}
                        onCommit={(v) =>
                          onUpdate(item.id, { description: v.trim() ? v : undefined })
                        }
                        className="h-7 input-toolkit text-xs"
                        aria-label="Item description"
                      />
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <Input
                      type="date"
                      value={item.startDate}
                      onChange={(e) => onUpdate(item.id, { startDate: e.target.value })}
                      className="h-8 w-36 input-toolkit"
                      aria-label={`Start date for ${item.name || "item"}`}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <Input
                      type="date"
                      value={item.endDate}
                      onChange={(e) => onUpdate(item.id, { endDate: e.target.value })}
                      className="h-8 w-36 input-toolkit"
                      aria-label={`End date for ${item.name || "item"}`}
                    />
                  </td>
                  <td className="py-2 px-3 text-center">
                    {item.cycleTime !== null ? (
                      <span className="font-data font-semibold text-accent">{item.cycleTime}d</span>
                    ) : (
                      <span className="text-sub text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      disabled={totalCount === 1}
                      aria-label={`Remove ${item.name || "item"}`}
                      className="text-sub hover:text-danger transition-colors p-1 disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
