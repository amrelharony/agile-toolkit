"use client";

/**
 * The editable backlog table — one row per item with name/description, MoSCoW
 * select, the shared Value/Effort inputs, and all WSJF + RICE numeric inputs.
 * Commits flow up through the store's update/remove/add callbacks.
 */

import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Plus, Trash2 } from "lucide-react";
import {
  type BacklogItem,
  type ImpactValue,
  type MoSCoWCategory,
  type PrioritizerStore,
  IMPACT_VALUES,
} from "../types";
import { MOSCOW_CONFIG } from "../constants";
import { NumCell } from "./cells";

const inputCls =
  "bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20 h-8 text-sm";

export function ItemsTable({
  items,
  updateItem,
  removeItem,
  addItem,
}: {
  items: BacklogItem[];
  updateItem: PrioritizerStore["updateItem"];
  removeItem: PrioritizerStore["removeItem"];
  addItem: PrioritizerStore["addItem"];
}) {
  return (
    <SectionCard
      title="Backlog Items"
      icon={ArrowUpDown}
      actions={
        <Button size="sm" variant="toolkit" onClick={addItem} className="gap-1.5 h-8 text-xs">
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3 min-w-[160px]">
                Item Name
              </th>
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[110px]">
                MoSCoW
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Value
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Effort
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Time Crit
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Risk Red
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Job Size
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[70px]">
                Reach
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[80px]">
                Impact
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[70px]">
                Conf %
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[70px]">
                RICE Eff
              </th>
              <th className="w-9">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border group">
                <td className="py-2 pr-3 align-top">
                  <div className="flex flex-col gap-1.5 min-w-[140px]">
                    <BlurInput
                      value={item.name}
                      onCommit={(v) => updateItem(item.id, { name: v })}
                      className={inputCls}
                      aria-label="Item name"
                    />
                    <BlurTextarea
                      value={item.description ?? ""}
                      onCommit={(v) =>
                        updateItem(item.id, { description: v.trim() ? v : undefined })
                      }
                      placeholder="Description (optional)..."
                      rows={2}
                      className="bg-surface-deep border-border resize-none text-xs"
                      aria-label={`Description for ${item.name || "unnamed item"}`}
                    />
                  </div>
                </td>
                <td className="py-2 px-2">
                  <Select
                    value={item.moscow}
                    onValueChange={(v) => updateItem(item.id, { moscow: v as MoSCoWCategory })}
                  >
                    <SelectTrigger
                      className={inputCls + " min-w-[110px]"}
                      aria-label={`MoSCoW for ${item.name || "unnamed item"}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-surface border-border">
                      {(Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[]).map((k) => (
                        <SelectItem key={k} value={k} className="text-text">
                          {MOSCOW_CONFIG[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                {/* Value (shared for WSJF business value + matrix value) */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.businessValue}
                    min={1}
                    max={10}
                    aria-label={`Value (1–10) for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { businessValue: n, value: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Matrix Effort */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.matrixEffort}
                    min={1}
                    max={10}
                    aria-label={`Effort (1–10) for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { matrixEffort: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Time Criticality */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.timeCriticality}
                    min={1}
                    max={10}
                    aria-label={`Time criticality for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { timeCriticality: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Risk Reduction */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.riskReduction}
                    min={1}
                    max={10}
                    aria-label={`Risk reduction for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { riskReduction: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Job Size */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.jobSize}
                    min={1}
                    max={10}
                    aria-label={`Job size for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { jobSize: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Reach */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.reach}
                    min={1}
                    aria-label={`Reach for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { reach: n })}
                    className={inputCls + " w-20 text-center"}
                  />
                </td>
                {/* Impact */}
                <td className="py-2 px-2">
                  <Select
                    value={String(item.impact)}
                    onValueChange={(v) => updateItem(item.id, { impact: Number(v) as ImpactValue })}
                  >
                    <SelectTrigger
                      className={inputCls + " w-20"}
                      aria-label={`Impact for ${item.name || "unnamed item"}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-surface border-border">
                      {IMPACT_VALUES.map((v) => (
                        <SelectItem key={v} value={String(v)} className="text-text">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                {/* Confidence */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.confidence}
                    min={1}
                    max={100}
                    aria-label={`Confidence % for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { confidence: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* RICE Effort */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.effort}
                    min={0.1}
                    step={0.1}
                    aria-label={`RICE effort (person-months) for ${item.name || "unnamed item"}`}
                    onCommit={(n) => updateItem(item.id, { effort: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                <td className="py-2">
                  <Button
                    variant="danger-ghost"
                    size="icon"
                    onClick={() => removeItem(item.id)}
                    disabled={items.length <= 1}
                    className="min-touch-coarse h-8 w-8 disabled:opacity-30"
                    aria-label={`Remove ${item.name || "unnamed item"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-sub">
        Value (1-10) is used for WSJF Business Value and the matrix Y-axis. Effort (1-10) is the
        matrix X-axis. RICE Effort is in person-months.
      </p>
    </SectionCard>
  );
}
