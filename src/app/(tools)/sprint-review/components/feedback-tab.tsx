"use client";

/**
 * Tab 2 — Stakeholder Feedback. Capture feedback items (stakeholder, category,
 * note) under a meeting date, then render a category-grouped summary.
 */

import { useId, useMemo } from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import type { FeedbackCategory } from "../types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../constants";
import { useSprintReviewStore } from "../use-sprint-review-store";
import { SectionLabel } from "./form-fields";

export function FeedbackTab() {
  const {
    meetingDate,
    feedbackItems,
    setMeetingDate,
    addFeedback: addFeedbackRaw,
    removeFeedback,
    updateFeedback,
  } = useSprintReviewStore();
  const uid = useId();
  // BUG-T8-sprint-review-1: log FEEDBACK_ADDED on add. Cross-tool
  // consumers (the "Last 30 days: N feedback items captured" banner)
  // read this event via selectEvents; without the log call, the
  // signal was dead despite a literal constant existing for the
  // action verb.
  const { log } = useHistoryLogger("sprint-review");
  const addFeedback = () => {
    addFeedbackRaw();
    log(SPRINT_REVIEW_ACTIONS.FEEDBACK_ADDED, {});
  };

  const grouped = useMemo(() => {
    return {
      positive: feedbackItems.filter((f) => f.category === "positive"),
      concern: feedbackItems.filter((f) => f.category === "concern"),
      suggestion: feedbackItems.filter((f) => f.category === "suggestion"),
    };
  }, [feedbackItems]);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Feedback Items"
        icon={MessageSquare}
        actions={
          <Button size="sm" variant="toolkit" onClick={addFeedback} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Add Feedback
          </Button>
        }
        contentClassName="space-y-4"
      >
        {/* Meeting date */}
        <div className="flex items-center gap-3 pb-2 border-b border-border">
          <Label htmlFor={`${uid}-meeting-date`} className="text-sub text-xs whitespace-nowrap">
            Meeting Date
          </Label>
          <Input
            id={`${uid}-meeting-date`}
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="bg-surface-deep border-border text-text max-w-xs focus:border-accent/50"
          />
        </div>

        {feedbackItems.length === 0 && (
          <p className="text-sm text-sub text-center py-4">No feedback yet. Add items above.</p>
        )}

        {feedbackItems.map((item) => (
          <div
            key={item.id}
            className="border border-border rounded-lg p-4 space-y-3 bg-surface-deep/50"
          >
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <SectionLabel htmlFor={`${uid}-${item.id}-stakeholder`}>Stakeholder</SectionLabel>
                <BlurInput
                  id={`${uid}-${item.id}-stakeholder`}
                  value={item.stakeholder}
                  onCommit={(v) => updateFeedback(item.id, { stakeholder: v })}
                  placeholder="Name / Role"
                  className="input-toolkit"
                />
              </div>
              <div className="space-y-1.5">
                <SectionLabel htmlFor={`${uid}-${item.id}-category`}>Category</SectionLabel>
                <Select
                  value={item.category}
                  onValueChange={(v) =>
                    updateFeedback(item.id, {
                      category: v as FeedbackCategory,
                    })
                  }
                >
                  <SelectTrigger id={`${uid}-${item.id}-category`} className="input-toolkit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-surface border-border">
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="concern">Concern</SelectItem>
                    <SelectItem value="suggestion">Suggestion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="danger-ghost"
                size="icon"
                onClick={() => removeFeedback(item.id)}
                aria-label={`Delete feedback from ${item.stakeholder || "unnamed stakeholder"}`}
                className="h-9 w-9"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="space-y-1.5">
              <SectionLabel htmlFor={`${uid}-${item.id}-feedback`}>Feedback</SectionLabel>
              <BlurTextarea
                id={`${uid}-${item.id}-feedback`}
                value={item.feedback}
                onCommit={(v) => updateFeedback(item.id, { feedback: v })}
                placeholder="What did they say?"
                rows={2}
                className="bg-surface-deep border-border text-text resize-none focus:border-accent/50"
              />
            </div>
          </div>
        ))}
      </SectionCard>

      {/* Summary grouped by category */}
      {feedbackItems.length > 0 && (
        <SectionCard title="Feedback Summary" contentClassName="space-y-5">
          {(["positive", "concern", "suggestion"] as FeedbackCategory[]).map(
            (cat) =>
              grouped[cat].length > 0 && (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className={`${CATEGORY_COLORS[cat]} border text-xs capitalize`}>
                      {CATEGORY_LABELS[cat]}
                    </Badge>
                    <span className="text-xs text-sub">
                      {grouped[cat].length} item
                      {grouped[cat].length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-2 pl-1">
                    {grouped[cat].map((item) => (
                      <div
                        key={item.id}
                        className="border-l-2 pl-3 py-1 border-border"
                        style={{
                          borderColor:
                            cat === "positive"
                              ? "#00ff88"
                              : cat === "concern"
                                ? "#ef4444"
                                : "#ffaa00",
                        }}
                      >
                        <p className="text-xs text-sub mb-0.5">{item.stakeholder || "Unknown"}</p>
                        <p className="text-sm text-text">{item.feedback || "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
          )}
        </SectionCard>
      )}
    </div>
  );
}
