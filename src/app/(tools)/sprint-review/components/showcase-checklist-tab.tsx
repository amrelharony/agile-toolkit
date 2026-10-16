"use client";

/**
 * Tab 3 — Showcase Checklist. Pre-demo readiness checklist with a progress bar
 * and inline add/edit/remove of items.
 */

import { useState } from "react";
import { Plus, Trash2, CheckSquare, CheckCircle2 } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BlurInput } from "@/components/shared/blur-fields";
import { useSprintReviewStore } from "../use-sprint-review-store";

export function ShowcaseChecklistTab() {
  const {
    checklistItems,
    toggleChecklist,
    addChecklistItem,
    removeChecklistItem,
    updateChecklistLabel,
  } = useSprintReviewStore();

  const [newItem, setNewItem] = useState("");

  const checkedCount = checklistItems.filter((c) => c.checked).length;
  const progress =
    checklistItems.length > 0 ? Math.round((checkedCount / checklistItems.length) * 100) : 0;

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (trimmed) {
      addChecklistItem(trimmed);
      setNewItem("");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Showcase Checklist"
        icon={CheckSquare}
        actions={
          <>
            <span className="text-sm text-sub font-data">
              {checkedCount}/{checklistItems.length}
            </span>
            {progress === 100 && <CheckCircle2 className="w-4 h-4 text-accent-green" />}
          </>
        }
        contentClassName="space-y-4"
      >
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-sub">
            <span>Progress</span>
            <span className="font-data">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-card" />
        </div>

        {/* Checklist items */}
        <div className="space-y-2">
          {checklistItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-deep/40 group hover:bg-surface-deep/70 transition-colors"
            >
              <button
                onClick={() => toggleChecklist(item.id)}
                className={`flex-shrink-0 w-5 h-5 rounded border transition-all ${
                  item.checked ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                }`}
              >
                {item.checked && (
                  <svg viewBox="0 0 20 20" fill="none" className="w-full h-full">
                    <path
                      d="M5 10l4 4 6-6"
                      stroke="#0a0e1a"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <BlurInput
                value={item.label}
                onCommit={(v) => updateChecklistLabel(item.id, v)}
                className={`flex-1 border-none bg-transparent p-0 h-auto text-sm focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${
                  item.checked ? "line-through text-sub" : "text-text"
                }`}
              />
              <Button
                variant="danger-ghost"
                size="icon"
                onClick={() => removeChecklistItem(item.id)}
                className="min-touch-coarse h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {/* Add new item */}
        <div className="flex gap-2 pt-2 border-t border-border">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="Add checklist item..."
            className="input-toolkit"
          />
          <Button
            size="sm"
            variant="toolkit"
            onClick={handleAdd}
            disabled={!newItem.trim()}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
