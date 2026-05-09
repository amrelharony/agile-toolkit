"use client";

import { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSprintReviewPrompts } from "@/lib/ai-prompts/sprint-review";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Presentation,
  MessageSquare,
  CheckSquare,
  BarChart3,
  Clock,
  CheckCircle2,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface DemoFeature {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string;
  timeMinutes: number;
}

type FeedbackCategory = "positive" | "concern" | "suggestion";

interface FeedbackItem {
  id: string;
  stakeholder: string;
  feedback: string;
  category: FeedbackCategory;
}

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

interface SprintReviewStore {
  // Tab 1 - Demo Script
  sprintName: string;
  sprintNumber: string;
  features: DemoFeature[];

  // Tab 2 - Stakeholder Feedback
  meetingDate: string;
  feedbackItems: FeedbackItem[];

  // Tab 3 - Showcase Checklist
  checklistItems: ChecklistItem[];

  // Tab 4 - Velocity Summary
  committed: number;
  completed: number;
  totalBacklog: number;
  backlogDone: number;

  setSprintName: (v: string) => void;
  setSprintNumber: (v: string) => void;
  addFeature: () => void;
  removeFeature: (id: string) => void;
  updateFeature: (id: string, updates: Partial<DemoFeature>) => void;

  setMeetingDate: (v: string) => void;
  addFeedback: () => void;
  removeFeedback: (id: string) => void;
  updateFeedback: (id: string, updates: Partial<FeedbackItem>) => void;

  toggleChecklist: (id: string) => void;
  addChecklistItem: (label: string) => void;
  removeChecklistItem: (id: string) => void;
  updateChecklistLabel: (id: string, label: string) => void;

  setCommitted: (v: number) => void;
  setCompleted: (v: number) => void;
  setTotalBacklog: (v: number) => void;
  setBacklogDone: (v: number) => void;

  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Defaults                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_FEATURES: DemoFeature[] = [
  {
    id: "f1",
    name: "User Login Flow",
    description: "Enhanced authentication with SSO support",
    acceptanceCriteria: "User can log in via email/password and Google SSO",
    timeMinutes: 5,
  },
];

const DEFAULT_FEEDBACK: FeedbackItem[] = [];

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "c1", label: "Environment is working", checked: false },
  { id: "c2", label: "Demo data prepared", checked: false },
  { id: "c3", label: "Acceptance criteria reviewed", checked: false },
  { id: "c4", label: "Stakeholders invited", checked: false },
  { id: "c5", label: "Meeting link shared", checked: false },
  { id: "c6", label: "Screen sharing tested", checked: false },
  { id: "c7", label: "Backup plan ready", checked: false },
  { id: "c8", label: "Release notes prepared", checked: false },
];

const DEFAULT_STATE = {
  sprintName: "Sprint Alpha",
  sprintNumber: "1",
  features: DEFAULT_FEATURES,
  meetingDate: todayLocalISO(),
  feedbackItems: DEFAULT_FEEDBACK,
  checklistItems: DEFAULT_CHECKLIST,
  committed: 40,
  completed: 36,
  totalBacklog: 200,
  backlogDone: 36,
};

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useSprintReviewStore = create<SprintReviewStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setSprintName: (v) => set({ sprintName: v }),
      setSprintNumber: (v) => set({ sprintNumber: v }),
      addFeature: () =>
        set((s) => ({
          features: [
            ...s.features,
            {
              id: crypto.randomUUID(),
              name: "",
              description: "",
              acceptanceCriteria: "",
              timeMinutes: 5,
            },
          ],
        })),
      removeFeature: (id) =>
        set((s) => ({ features: s.features.filter((f) => f.id !== id) })),
      updateFeature: (id, updates) =>
        set((s) => ({
          features: s.features.map((f) =>
            f.id === id ? { ...f, ...updates } : f
          ),
        })),

      setMeetingDate: (v) => set({ meetingDate: v }),
      addFeedback: () =>
        set((s) => ({
          feedbackItems: [
            ...s.feedbackItems,
            {
              id: crypto.randomUUID(),
              stakeholder: "",
              feedback: "",
              category: "positive" as FeedbackCategory,
            },
          ],
        })),
      removeFeedback: (id) =>
        set((s) => ({
          feedbackItems: s.feedbackItems.filter((f) => f.id !== id),
        })),
      updateFeedback: (id, updates) =>
        set((s) => ({
          feedbackItems: s.feedbackItems.map((f) =>
            f.id === id ? { ...f, ...updates } : f
          ),
        })),

      toggleChecklist: (id) =>
        set((s) => ({
          checklistItems: s.checklistItems.map((c) =>
            c.id === id ? { ...c, checked: !c.checked } : c
          ),
        })),
      addChecklistItem: (label) =>
        set((s) => ({
          checklistItems: [
            ...s.checklistItems,
            { id: crypto.randomUUID(), label, checked: false },
          ],
        })),
      removeChecklistItem: (id) =>
        set((s) => ({
          checklistItems: s.checklistItems.filter((c) => c.id !== id),
        })),
      updateChecklistLabel: (id, label) =>
        set((s) => ({
          checklistItems: s.checklistItems.map((c) =>
            c.id === id ? { ...c, label } : c
          ),
        })),

      setCommitted: (v) => set({ committed: v }),
      setCompleted: (v) => set({ completed: v }),
      setTotalBacklog: (v) => set({ totalBacklog: v }),
      setBacklogDone: (v) => set({ backlogDone: v }),

      reset: () => set({ ...DEFAULT_STATE }),
    }),
    { name: "agile-toolkit:sprint-review" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  positive: "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20",
  concern: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20",
  suggestion: "bg-[#ffaa00]/10 text-[#ffaa00] border-[#ffaa00]/20",
};

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  positive: "Positive",
  concern: "Concern",
  suggestion: "Suggestion",
};

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-sub font-medium uppercase tracking-wider mb-1">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 1 — Demo Script                                                       */
/* -------------------------------------------------------------------------- */

function DemoScriptTab() {
  const {
    sprintName,
    sprintNumber,
    features,
    setSprintName,
    setSprintNumber,
    addFeature: addFeatureRaw,
    removeFeature: removeFeatureRaw,
    updateFeature,
  } = useSprintReviewStore();
  const { log } = useHistoryLogger("sprint-review");

  const addFeature: typeof addFeatureRaw = (...args) => {
    addFeatureRaw(...args);
    log(SPRINT_REVIEW_ACTIONS.ITEM_ADDED, {});
  };
  const removeFeature: typeof removeFeatureRaw = (id) => {
    const feature = features.find((f) => f.id === id);
    removeFeatureRaw(id);
    log(SPRINT_REVIEW_ACTIONS.ITEM_REMOVED, {
      featureId: id,
      name: feature?.name,
    });
  };

  const totalMinutes = features.reduce((s, f) => s + (f.timeMinutes || 0), 0);

  const script = useMemo(() => {
    const lines: string[] = [];
    lines.push(`# Sprint ${sprintNumber} Review — ${sprintName}`);
    lines.push(`**Estimated Duration:** ${totalMinutes} minutes`);
    lines.push("");
    features.forEach((f, i) => {
      lines.push(`## ${i + 1}. ${f.name || "Untitled Feature"} (${f.timeMinutes} min)`);
      if (f.description) lines.push(`**Description:** ${f.description}`);
      if (f.acceptanceCriteria)
        lines.push(`**Acceptance Criteria:** ${f.acceptanceCriteria}`);
      lines.push("");
    });
    return lines.join("\n");
  }, [sprintName, sprintNumber, features, totalMinutes]);

  return (
    <div className="space-y-6">
      {/* Sprint info */}
      <SectionCard
        title="Sprint Info"
        icon={Presentation}
        contentClassName="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div className="space-y-1.5">
          <Label className="text-sub text-xs">Sprint Name</Label>
          <Input
            value={sprintName}
            onChange={(e) => setSprintName(e.target.value)}
            placeholder="e.g. Sprint Alpha"
            className="input-toolkit"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sub text-xs">Sprint Number</Label>
          <Input
            value={sprintNumber}
            onChange={(e) => setSprintNumber(e.target.value)}
            placeholder="e.g. 12"
            className="input-toolkit"
          />
        </div>
      </SectionCard>

      {/* Features list */}
      <SectionCard
        title="Features to Demo"
        icon={Clock}
        titleSuffix={`— Total: ${totalMinutes} min`}
        actions={
          <Button
            size="sm"
            variant="toolkit"
            onClick={addFeature}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Feature
          </Button>
        }
        contentClassName="space-y-4"
      >
          {features.length === 0 && (
            <p className="text-sm text-sub text-center py-4">
              No features yet. Add one above.
            </p>
          )}
          {features.map((f, i) => (
            <div
              key={f.id}
              className="border border-border rounded-lg p-4 space-y-3 bg-surface-deep/50"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-accent font-medium">
                  Feature {i + 1}
                </span>
                <Button
                  variant="danger-ghost"
                  size="icon"
                  onClick={() => removeFeature(f.id)}
                  className="min-touch-coarse h-7 w-7"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1.5">
                  <SectionLabel>Feature Name</SectionLabel>
                  <Input
                    value={f.name}
                    onChange={(e) =>
                      updateFeature(f.id, { name: e.target.value })
                    }
                    placeholder="e.g. User Login Flow"
                    className="input-toolkit"
                  />
                </div>
                <div className="space-y-1.5 w-28">
                  <SectionLabel>Time (min)</SectionLabel>
                  <Input
                    type="number"
                    min={1}
                    value={f.timeMinutes}
                    onChange={(e) =>
                      updateFeature(f.id, {
                        timeMinutes: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <SectionLabel>Brief Description</SectionLabel>
                <Input
                  value={f.description}
                  onChange={(e) =>
                    updateFeature(f.id, { description: e.target.value })
                  }
                  placeholder="What was built?"
                  className="input-toolkit"
                />
              </div>
              <div className="space-y-1.5">
                <SectionLabel>Acceptance Criteria</SectionLabel>
                <Textarea
                  value={f.acceptanceCriteria}
                  onChange={(e) =>
                    updateFeature(f.id, {
                      acceptanceCriteria: e.target.value,
                    })
                  }
                  placeholder="Given... When... Then..."
                  rows={2}
                  className="bg-surface-deep border-border text-text resize-none focus:border-accent/50"
                />
              </div>
            </div>
          ))}
      </SectionCard>

      {/* Generated script */}
      {features.length > 0 && (
        <SectionCard
          title="Generated Demo Script"
          actions={
            <ExportButton filename="demo-script" clipboardText={script} />
          }
        >
          <pre className="text-sm text-sub whitespace-pre-wrap font-mono leading-relaxed bg-surface-deep/60 rounded-lg p-4 border border-border">
            {script}
          </pre>
        </SectionCard>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 2 — Stakeholder Feedback                                              */
/* -------------------------------------------------------------------------- */

function FeedbackTab() {
  const {
    meetingDate,
    feedbackItems,
    setMeetingDate,
    addFeedback,
    removeFeedback,
    updateFeedback,
  } = useSprintReviewStore();

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
          <Button
            size="sm"
            variant="toolkit"
            onClick={addFeedback}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Feedback
          </Button>
        }
        contentClassName="space-y-4"
      >
          {/* Meeting date */}
          <div className="flex items-center gap-3 pb-2 border-b border-border">
            <Label className="text-sub text-xs whitespace-nowrap">
              Meeting Date
            </Label>
            <Input
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="bg-surface-deep border-border text-text max-w-xs focus:border-accent/50"
            />
          </div>

          {feedbackItems.length === 0 && (
            <p className="text-sm text-sub text-center py-4">
              No feedback yet. Add items above.
            </p>
          )}

          {feedbackItems.map((item) => (
            <div
              key={item.id}
              className="border border-border rounded-lg p-4 space-y-3 bg-surface-deep/50"
            >
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <SectionLabel>Stakeholder</SectionLabel>
                  <Input
                    value={item.stakeholder}
                    onChange={(e) =>
                      updateFeedback(item.id, { stakeholder: e.target.value })
                    }
                    placeholder="Name / Role"
                    className="input-toolkit"
                  />
                </div>
                <div className="space-y-1.5">
                  <SectionLabel>Category</SectionLabel>
                  <Select
                    value={item.category}
                    onValueChange={(v) =>
                      updateFeedback(item.id, {
                        category: v as FeedbackCategory,
                      })
                    }
                  >
                    <SelectTrigger className="input-toolkit">
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
                  className="h-9 w-9"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <SectionLabel>Feedback</SectionLabel>
                <Textarea
                  value={item.feedback}
                  onChange={(e) =>
                    updateFeedback(item.id, { feedback: e.target.value })
                  }
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
                      <Badge
                        className={`${CATEGORY_COLORS[cat]} border text-xs capitalize`}
                      >
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
                          <p className="text-xs text-sub mb-0.5">
                            {item.stakeholder || "Unknown"}
                          </p>
                          <p className="text-sm text-text">
                            {item.feedback || "—"}
                          </p>
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

/* -------------------------------------------------------------------------- */
/*  Tab 3 — Showcase Checklist                                                */
/* -------------------------------------------------------------------------- */

function ShowcaseChecklistTab() {
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
    checklistItems.length > 0
      ? Math.round((checkedCount / checklistItems.length) * 100)
      : 0;

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
            {progress === 100 && (
              <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />
            )}
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
            <Progress
              value={progress}
              className="h-2 bg-card"
            />
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
                    item.checked
                      ? "bg-accent border-accent"
                      : "border-border hover:border-accent/50"
                  }`}
                >
                  {item.checked && (
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      className="w-full h-full"
                    >
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
                <Input
                  value={item.label}
                  onChange={(e) =>
                    updateChecklistLabel(item.id, e.target.value)
                  }
                  className={`flex-1 border-none bg-transparent p-0 h-auto text-sm focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${
                    item.checked
                      ? "line-through text-sub"
                      : "text-text"
                  }`}
                />
                <Button
                  variant="danger-ghost"
                  size="icon"
                  onClick={() => removeChecklistItem(item.id)}
                  className="min-touch-coarse h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
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

/* -------------------------------------------------------------------------- */
/*  Tab 4 — Velocity Summary                                                  */
/* -------------------------------------------------------------------------- */

function VelocitySummaryTab() {
  const {
    committed,
    completed,
    totalBacklog,
    backlogDone,
    sprintName,
    sprintNumber,
    setCommitted,
    setCompleted,
    setTotalBacklog,
    setBacklogDone,
  } = useSprintReviewStore();

  const completionRate =
    committed > 0 ? Math.round((completed / committed) * 100) : 0;
  const releaseProgress =
    totalBacklog > 0 ? Math.round((backlogDone / totalBacklog) * 100) : 0;

  const card = useMemo(
    () =>
      [
        `# Velocity Summary — Sprint ${sprintNumber}: ${sprintName}`,
        "",
        `## Sprint Velocity`,
        `- **Committed:** ${committed} points`,
        `- **Completed:** ${completed} points`,
        `- **Completion Rate:** ${completionRate}%`,
        "",
        `## Release Progress`,
        `- **Total Backlog:** ${totalBacklog} points`,
        `- **Done to Date:** ${backlogDone} points`,
        `- **Release Progress:** ${releaseProgress}%`,
        "",
        `_Generated ${new Date().toLocaleDateString()}_`,
      ].join("\n"),
    [
      sprintName,
      sprintNumber,
      committed,
      completed,
      completionRate,
      totalBacklog,
      backlogDone,
      releaseProgress,
    ]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Sprint velocity inputs */}
        <SectionCard
          title="Sprint Velocity"
          icon={BarChart3}
          contentClassName="space-y-4"
        >
          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Committed Points</Label>
            <Input
              type="number"
              min={0}
              value={committed}
              onChange={(e) =>
                setCommitted(Math.max(0, Number(e.target.value)))
              }
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Completed Points</Label>
            <Input
              type="number"
              min={0}
              value={completed}
              onChange={(e) =>
                setCompleted(Math.max(0, Number(e.target.value)))
              }
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-sub">
              <span>Completion Rate</span>
              <span
                className="font-data font-bold"
                style={{
                  color:
                    completionRate >= 90
                      ? "#00ff88"
                      : completionRate >= 70
                      ? "#ffaa00"
                      : "#ef4444",
                }}
              >
                {completionRate}%
              </span>
            </div>
            <Progress value={completionRate} className="h-2 bg-card" />
          </div>
        </SectionCard>

        {/* Release progress inputs */}
        <SectionCard
          title="Release Progress"
          icon={BarChart3}
          iconClassName="text-[#00ff88]"
          contentClassName="space-y-4"
        >
          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Total Backlog Points</Label>
            <Input
              type="number"
              min={0}
              value={totalBacklog}
              onChange={(e) =>
                setTotalBacklog(Math.max(0, Number(e.target.value)))
              }
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Done to Date</Label>
            <Input
              type="number"
              min={0}
              value={backlogDone}
              onChange={(e) =>
                setBacklogDone(Math.max(0, Number(e.target.value)))
              }
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-sub">
              <span>Release Progress</span>
              <span
                className="font-data font-bold"
                style={{
                  color:
                    releaseProgress >= 75
                      ? "#00ff88"
                      : releaseProgress >= 40
                      ? "#ffaa00"
                      : "#00f0ff",
                }}
              >
                {releaseProgress}%
              </span>
            </div>
            <Progress value={releaseProgress} className="h-2 bg-card" />
          </div>
        </SectionCard>
      </div>

      {/* Generated velocity card */}
      <SectionCard
        title="Velocity Summary Card"
        actions={
          <ExportButton filename="velocity-summary" clipboardText={card} />
        }
      >
        <pre className="text-sm text-sub whitespace-pre-wrap font-mono leading-relaxed bg-surface-deep/60 rounded-lg p-4 border border-border">
          {card}
        </pre>
      </SectionCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function SprintReviewClient() {
  const {
    sprintName,
    sprintNumber,
    features,
    meetingDate,
    feedbackItems,
    checklistItems,
    committed,
    completed,
    totalBacklog,
    backlogDone,
    reset,
  } = useSprintReviewStore();

  // Build combined markdown export
  const fullExport = useMemo(() => {
    const totalMinutes = features.reduce((s, f) => s + (f.timeMinutes || 0), 0);
    const completionRate =
      committed > 0 ? Math.round((completed / committed) * 100) : 0;
    const releaseProgress =
      totalBacklog > 0 ? Math.round((backlogDone / totalBacklog) * 100) : 0;
    const checkedCount = checklistItems.filter((c) => c.checked).length;

    const lines: string[] = [];
    lines.push(`# Sprint ${sprintNumber} Review Kit — ${sprintName}`);
    lines.push(`_Date: ${meetingDate}_`);
    lines.push("");

    // Demo Script
    lines.push("---");
    lines.push("## Demo Script");
    lines.push(`**Estimated Duration:** ${totalMinutes} minutes`);
    lines.push("");
    features.forEach((f, i) => {
      lines.push(
        `### ${i + 1}. ${f.name || "Untitled Feature"} (${f.timeMinutes} min)`
      );
      if (f.description) lines.push(`**Description:** ${f.description}`);
      if (f.acceptanceCriteria)
        lines.push(`**Acceptance Criteria:** ${f.acceptanceCriteria}`);
      lines.push("");
    });

    // Feedback
    lines.push("---");
    lines.push("## Stakeholder Feedback");
    if (feedbackItems.length === 0) {
      lines.push("_No feedback recorded._");
    } else {
      (["positive", "concern", "suggestion"] as FeedbackCategory[]).forEach(
        (cat) => {
          const items = feedbackItems.filter((f) => f.category === cat);
          if (items.length > 0) {
            lines.push(
              `\n### ${
                cat.charAt(0).toUpperCase() + cat.slice(1)
              }`
            );
            items.forEach((item) => {
              lines.push(
                `- **${item.stakeholder || "Unknown"}:** ${item.feedback || "—"}`
              );
            });
          }
        }
      );
    }
    lines.push("");

    // Checklist
    lines.push("---");
    lines.push("## Showcase Checklist");
    lines.push(`Progress: ${checkedCount}/${checklistItems.length}`);
    lines.push("");
    checklistItems.forEach((c) => {
      lines.push(`- [${c.checked ? "x" : " "}] ${c.label}`);
    });
    lines.push("");

    // Velocity
    lines.push("---");
    lines.push("## Velocity Summary");
    lines.push(`- **Committed:** ${committed} points`);
    lines.push(`- **Completed:** ${completed} points`);
    lines.push(`- **Completion Rate:** ${completionRate}%`);
    lines.push(`- **Total Backlog:** ${totalBacklog} points`);
    lines.push(`- **Done to Date:** ${backlogDone} points`);
    lines.push(`- **Release Progress:** ${releaseProgress}%`);
    lines.push("");
    lines.push(`_Generated ${new Date().toLocaleDateString()}_`);

    return lines.join("\n");
  }, [
    sprintName,
    sprintNumber,
    features,
    meetingDate,
    feedbackItems,
    checklistItems,
    committed,
    completed,
    totalBacklog,
    backlogDone,
  ]);

  const promptConfig = useMemo(() => ({
    toolName: "Sprint Review",
    prompts: generateSprintReviewPrompts({
      sprintName,
      sprintNumber: Number(sprintNumber),
      features: features.map((f) => ({ name: f.name, description: f.description, timeMinutes: f.timeMinutes })),
      feedbackItems: feedbackItems.map((f) => ({ stakeholder: f.stakeholder, feedback: f.feedback, category: f.category })),
      checklistItems: checklistItems.map((c) => ({ label: c.label, checked: c.checked })),
      committed,
      completed,
    }),
  }), [sprintName, sprintNumber, features, feedbackItems, checklistItems, committed, completed]);

  return (
    <ToolPageWrapper
      toolId="sprint-review"
      title="Sprint Review Kit"
      description="Generate demo scripts, collect stakeholder feedback, run showcase checklists, and review velocity."
      category="Ceremonies"
    >
      <div className="space-y-6">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-sub">
            Sprint{" "}
            <span className="text-accent font-data font-semibold">
              #{sprintNumber}
            </span>{" "}
            — {sprintName}
          </div>
          <div className="flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename={`sprint-${sprintNumber}-review`}
              clipboardText={fullExport}
            />
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={reset}
            >
              Reset
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="demo">
          <TabsList className="bg-surface-deep border border-border p-1 h-auto flex-wrap gap-1">
            <TabsTrigger
              value="demo"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <Presentation className="w-3.5 h-3.5" />
              Demo Script
            </TabsTrigger>
            <TabsTrigger
              value="feedback"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Stakeholder Feedback
            </TabsTrigger>
            <TabsTrigger
              value="checklist"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Showcase Checklist
            </TabsTrigger>
            <TabsTrigger
              value="velocity"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Velocity Summary
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="demo">
              <DemoScriptTab />
            </TabsContent>
            <TabsContent value="feedback">
              <FeedbackTab />
            </TabsContent>
            <TabsContent value="checklist">
              <ShowcaseChecklistTab />
            </TabsContent>
            <TabsContent value="velocity">
              <VelocitySummaryTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </ToolPageWrapper>
  );
}
