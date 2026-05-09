"use client";

import { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateImpedimentPrompts } from "@/lib/ai-prompts/impediments";
import { todayLocalISO } from "@/lib/utils/formatters";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { IMPEDIMENT_ACTIONS } from "@/lib/history/event-actions";
import { withTimeTravel } from "@/lib/stores/with-time-travel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Plus,
  Trash2,
  CheckCircle2,
  ArrowUpCircle,
  Clock,
  Filter,
  X,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type Category = "Technical" | "Organizational" | "External" | "Process";
type Severity = "Low" | "Medium" | "High" | "Critical";
type Status = "Open" | "Escalated" | "Resolved";

interface Impediment {
  id: string;
  title: string;
  description: string;
  category: Category;
  severity: Severity;
  raisedBy: string;
  assignedTo: string;
  status: Status;
  raisedDate: string; // ISO date
  resolvedDate?: string; // ISO date
}

interface ImpedimentStore {
  impediments: Impediment[];
  addImpediment: (imp: Omit<Impediment, "id" | "raisedDate" | "status">) => void;
  updateStatus: (id: string, status: Status, resolvedDate?: string) => void;
  remove: (id: string) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useImpedimentStore = create<ImpedimentStore>()(
  persist(
    withTimeTravel<ImpedimentStore>(
      { toolId: "impediments" },
      (set) => ({
        impediments: [],

        addImpediment: (imp) =>
          set((s) => ({
            impediments: [
              {
                ...imp,
                id: crypto.randomUUID(),
                raisedDate: todayLocalISO(),
                status: "Open",
              },
              ...s.impediments,
            ],
          })),

        updateStatus: (id, status, resolvedDate) =>
          set((s) => ({
            impediments: s.impediments.map((i) =>
              i.id === id
                ? {
                    ...i,
                    status,
                    resolvedDate:
                      status === "Resolved"
                        ? resolvedDate || todayLocalISO()
                        : i.resolvedDate,
                  }
                : i
            ),
          })),

        remove: (id) =>
          set((s) => ({
            impediments: s.impediments.filter((i) => i.id !== id),
          })),

        reset: () => set({ impediments: [] }),
      })
    ),
    {
      name: "agile-toolkit:impediments",
      partialize: (state) => {
        const {
          _ttPast,
          _ttFuture,
          ...rest
        } = state as ImpedimentStore & { _ttPast?: unknown; _ttFuture?: unknown };
        void _ttPast;
        void _ttFuture;
        return rest;
      },
    }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function daysSince(dateStr: string): number {
  const d = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - d) / (1000 * 60 * 60 * 24)));
}

function avgResolutionDays(impediments: Impediment[]): number {
  const resolved = impediments.filter(
    (i) => i.status === "Resolved" && i.resolvedDate
  );
  if (resolved.length === 0) return 0;
  const total = resolved.reduce((sum, i) => {
    const raised = new Date(i.raisedDate).getTime();
    const done = new Date(i.resolvedDate!).getTime();
    return sum + Math.max(0, Math.floor((done - raised) / (1000 * 60 * 60 * 24)));
  }, 0);
  return Math.round(total / resolved.length);
}

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; color: string; bg: string; border: string }
> = {
  Low: {
    label: "Low",
    color: "#00ff88",
    bg: "bg-[#00ff88]/10",
    border: "border-[#00ff88]/20",
  },
  Medium: {
    label: "Medium",
    color: "#ffaa00",
    bg: "bg-[#ffaa00]/10",
    border: "border-[#ffaa00]/20",
  },
  High: {
    label: "High",
    color: "#ef4444",
    bg: "bg-[#ef4444]/10",
    border: "border-[#ef4444]/20",
  },
  Critical: {
    label: "Critical",
    color: "#ef4444",
    bg: "bg-[#ef4444]/20",
    border: "border-[#ef4444]/40",
  },
};

const STATUS_CONFIG: Record<
  Status,
  { label: string; color: string; bg: string; border: string }
> = {
  Open: {
    label: "Open",
    color: "#00f0ff",
    bg: "bg-accent/10",
    border: "border-accent/20",
  },
  Escalated: {
    label: "Escalated",
    color: "#ffaa00",
    bg: "bg-[#ffaa00]/10",
    border: "border-[#ffaa00]/20",
  },
  Resolved: {
    label: "Resolved",
    color: "#00ff88",
    bg: "bg-[#00ff88]/10",
    border: "border-[#00ff88]/20",
  },
};

function AgeIndicator({ days }: { days: number }) {
  const color =
    days < 3 ? "#00ff88" : days < 7 ? "#ffaa00" : "#ef4444";
  return (
    <span className="flex items-center gap-1 text-xs font-data" style={{ color }}>
      <Clock className="w-3 h-3" />
      {days}d
    </span>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <Badge
      className={`${cfg.bg} border ${cfg.border} text-xs font-medium ${
        severity === "Critical" ? "font-bold" : ""
      }`}
      style={{ color: cfg.color }}
    >
      {cfg.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Badge
      className={`${cfg.bg} border ${cfg.border} text-xs`}
      style={{ color: cfg.color }}
    >
      {cfg.label}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Log Form                                                                  */
/* -------------------------------------------------------------------------- */

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "Technical" as Category,
  severity: "Medium" as Severity,
  raisedBy: "",
  assignedTo: "",
};

function LogForm({ onAdd }: { onAdd: () => void }) {
  const { addImpediment } = useImpedimentStore();
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const { log } = useHistoryLogger("impediments");

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    sonify("impediments", "impediment-raised");
    addImpediment(form);
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_RAISED, {
      title: form.title.trim(),
      category: form.category,
      severity: form.severity,
      assignedTo: form.assignedTo || null,
    });
    setForm(EMPTY_FORM);
    setOpen(false);
    onAdd();
  };

  if (!open) {
    return (
      <Button
        variant="toolkit"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Plus className="w-4 h-4" />
        Log Impediment
      </Button>
    );
  }

  return (
    <SectionCard
      title="Log New Impediment"
      icon={AlertTriangle}
      iconClassName="text-[#ffaa00]"
      actions={
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          className="min-touch-coarse h-7 w-7 text-sub hover:text-text"
        >
          <X className="w-4 h-4" />
        </Button>
      }
      contentClassName="space-y-4"
    >
        <div className="space-y-1.5">
          <Label className="text-sub text-xs">Title *</Label>
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Short description of the impediment"
            className="input-toolkit"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sub text-xs">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Provide context and impact details..."
            rows={3}
            className="bg-surface-deep border-border text-text resize-none focus:border-accent/50"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Category</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v as Category })}
            >
              <SelectTrigger className="bg-surface-deep border-border text-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                {(["Technical", "Organizational", "External", "Process"] as Category[]).map(
                  (c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Severity</Label>
            <Select
              value={form.severity}
              onValueChange={(v) => setForm({ ...form, severity: v as Severity })}
            >
              <SelectTrigger className="bg-surface-deep border-border text-text">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                {(["Low", "Medium", "High", "Critical"] as Severity[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Raised By</Label>
            <Input
              value={form.raisedBy}
              onChange={(e) => setForm({ ...form, raisedBy: e.target.value })}
              placeholder="Name / Role"
              className="input-toolkit"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sub text-xs">Assigned To</Label>
            <Input
              value={form.assignedTo}
              onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
              placeholder="Name / Role"
              className="input-toolkit"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            variant="toolkit"
            onClick={handleSubmit}
            disabled={!form.title.trim()}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Log Impediment
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setForm(EMPTY_FORM);
              setOpen(false);
            }}
            className="text-sub hover:text-text hover:bg-cardH"
          >
            Cancel
          </Button>
        </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Impediment Card                                                           */
/* -------------------------------------------------------------------------- */

function ImpedimentCard({ impediment }: { impediment: Impediment }) {
  const { updateStatus, remove } = useImpedimentStore();
  const age = daysSince(impediment.raisedDate);
  const { log } = useHistoryLogger("impediments");

  const handleResolve = () => {
    sonify("impediments", "impediment-resolved");
    const today = todayLocalISO();
    updateStatus(impediment.id, "Resolved", today);
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_RESOLVED, {
      id: impediment.id,
      title: impediment.title,
      ageDays: age,
    });
  };

  const handleStatusChange = (next: Status) => {
    if (next === impediment.status) return;
    if (next === "Resolved") {
      handleResolve();
      return;
    }
    updateStatus(impediment.id, next);
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_STATUS_CHANGED, {
      id: impediment.id,
      title: impediment.title,
      from: impediment.status,
      to: next,
    });
  };

  const handleRemove = () => {
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_REMOVED, {
      id: impediment.id,
      title: impediment.title,
    });
    remove(impediment.id);
  };

  return (
    <div
      className={`border rounded-lg p-4 bg-surface-deep/50 space-y-3 transition-opacity ${
        impediment.status === "Resolved" ? "opacity-60" : ""
      }`}
      style={{
        borderColor:
          impediment.severity === "Critical"
            ? "rgba(239,68,68,0.4)"
            : impediment.severity === "High"
            ? "rgba(239,68,68,0.2)"
            : "rgba(255,255,255,0.1)",
      }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text truncate">
            {impediment.title}
          </p>
          {impediment.description && (
            <p className="text-xs text-sub mt-0.5 line-clamp-2">
              {impediment.description}
            </p>
          )}
        </div>
        <Button
          variant="danger-ghost"
          size="icon"
          onClick={handleRemove}
          className="min-touch-coarse h-7 w-7 flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={impediment.severity} />
        <StatusBadge status={impediment.status} />
        <Badge className="bg-card border border-border text-sub text-xs">
          {impediment.category}
        </Badge>
        {impediment.status !== "Resolved" && (
          <AgeIndicator days={age} />
        )}
        {impediment.status === "Resolved" && impediment.resolvedDate && (
          <span className="text-xs text-sub">
            Resolved {impediment.resolvedDate}
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sub">
        {impediment.raisedBy && (
          <span>Raised by: <span className="text-text">{impediment.raisedBy}</span></span>
        )}
        {impediment.assignedTo && (
          <span>Assigned: <span className="text-text">{impediment.assignedTo}</span></span>
        )}
        <span>Raised: {impediment.raisedDate}</span>
      </div>

      {/* Status controls */}
      {impediment.status !== "Resolved" && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <Select
            value={impediment.status}
            onValueChange={(v) => handleStatusChange(v as Status)}
          >
            <SelectTrigger className="min-touch-coarse h-7 text-xs bg-surface-deep border-border text-text w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="Escalated">Escalated</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          {impediment.status === "Open" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleStatusChange("Escalated")}
              className="h-7 text-xs gap-1 text-[#ffaa00] hover:text-[#ffaa00] hover:bg-[#ffaa00]/10"
            >
              <ArrowUpCircle className="w-3 h-3" />
              Escalate
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleResolve}
            className="h-7 text-xs gap-1 text-[#00ff88] hover:text-[#00ff88] hover:bg-[#00ff88]/10 ml-auto"
          >
            <CheckCircle2 className="w-3 h-3" />
            Resolve
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function ImpedimentsClient() {
  const { impediments, reset } = useImpedimentStore();

  // Filters
  const [filterStatus, setFilterStatus] = useState<Status | "All">("All");
  const [filterCategory, setFilterCategory] = useState<Category | "All">("All");
  const [filterSeverity, setFilterSeverity] = useState<Severity | "All">("All");

  const [, setRefresh] = useState(0);

  // Dashboard stats
  const stats = useMemo(() => {
    const open = impediments.filter((i) => i.status === "Open").length;
    const escalated = impediments.filter((i) => i.status === "Escalated").length;
    const avgDays = avgResolutionDays(impediments);

    const byCategory = (["Technical", "Organizational", "External", "Process"] as Category[]).map(
      (cat) => ({
        label: cat,
        count: impediments.filter((i) => i.category === cat && i.status !== "Resolved").length,
      })
    );

    return { open, escalated, avgDays, byCategory };
  }, [impediments]);

  // Filtered list
  const filtered = useMemo(
    () =>
      impediments.filter((i) => {
        if (filterStatus !== "All" && i.status !== filterStatus) return false;
        if (filterCategory !== "All" && i.category !== filterCategory) return false;
        if (filterSeverity !== "All" && i.severity !== filterSeverity) return false;
        return true;
      }),
    [impediments, filterStatus, filterCategory, filterSeverity]
  );

  // Sort: Critical first, then by age desc
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
        const statusOrder = { Open: 0, Escalated: 1, Resolved: 2 };
        if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
        if (a.severity !== b.severity)
          return severityOrder[a.severity] - severityOrder[b.severity];
        return daysSince(b.raisedDate) - daysSince(a.raisedDate);
      }),
    [filtered]
  );

  // Export data
  const csvData = useMemo(
    () => ({
      headers: [
        "Title",
        "Category",
        "Severity",
        "Status",
        "Raised By",
        "Assigned To",
        "Raised Date",
        "Resolved Date",
        "Age (days)",
      ],
      rows: impediments.map((i) => [
        i.title,
        i.category,
        i.severity,
        i.status,
        i.raisedBy,
        i.assignedTo,
        i.raisedDate,
        i.resolvedDate || "",
        daysSince(i.raisedDate),
      ]),
    }),
    [impediments]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Impediment Tracker",
    prompts: generateImpedimentPrompts({ impediments }),
  }), [impediments]);

  const hasActiveFilters =
    filterStatus !== "All" || filterCategory !== "All" || filterSeverity !== "All";

  return (
    <ToolPageWrapper
      toolId="impediments"
      title="Impediment Tracker"
      description="Log, escalate, and resolve team impediments. Monitor age, severity, and resolution metrics."
      category="Team Health & Maturity"
    >
      <div className="space-y-6">
        {/* Dashboard Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-1">Total Open</p>
              <p className="text-3xl font-data font-bold text-accent">
                {stats.open}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-1">Escalated</p>
              <p className="text-3xl font-data font-bold text-[#ffaa00]">
                {stats.escalated}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-1">Avg Resolution</p>
              <p className="text-3xl font-data font-bold text-[#00ff88]">
                {stats.avgDays}
                <span className="text-sm font-normal text-sub ml-1">
                  days
                </span>
              </p>
            </CardContent>
          </Card>
          <Card className="bg-surface border-border">
            <CardContent className="p-4">
              <p className="text-xs text-sub mb-2">Open by Category</p>
              <div className="space-y-1">
                {stats.byCategory
                  .filter((c) => c.count > 0)
                  .map((c) => (
                    <div
                      key={c.label}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-sub truncate">{c.label}</span>
                      <span className="text-text font-data font-semibold ml-2">
                        {c.count}
                      </span>
                    </div>
                  ))}
                {stats.byCategory.every((c) => c.count === 0) && (
                  <p className="text-xs text-sub">None open</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions + filters row */}
        <div className="flex flex-wrap items-center gap-3">
          <LogForm onAdd={() => setRefresh((n) => n + 1)} />

          <div className="flex-1" />

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-sub" />

            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as Status | "All")}
            >
              <SelectTrigger className="h-8 text-xs bg-surface border-border text-text w-28">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="All">All Status</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="Escalated">Escalated</SelectItem>
                <SelectItem value="Resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterCategory}
              onValueChange={(v) => setFilterCategory(v as Category | "All")}
            >
              <SelectTrigger className="h-8 text-xs bg-surface border-border text-text w-36">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="All">All Categories</SelectItem>
                {(["Technical", "Organizational", "External", "Process"] as Category[]).map(
                  (c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <Select
              value={filterSeverity}
              onValueChange={(v) => setFilterSeverity(v as Severity | "All")}
            >
              <SelectTrigger className="h-8 text-xs bg-surface border-border text-text w-32">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border">
                <SelectItem value="All">All Severity</SelectItem>
                {(["Low", "Medium", "High", "Critical"] as Severity[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterStatus("All");
                  setFilterCategory("All");
                  setFilterSeverity("All");
                }}
                className="h-8 text-xs text-sub hover:text-text hover:bg-cardH gap-1"
              >
                <X className="w-3 h-3" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            {impediments.length > 0 && (
              <ExportButton
                filename="impediments"
                csvData={csvData}
                jsonData={impediments}
              />
            )}
            {impediments.length > 0 && (
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={reset}
              >
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Impediment list */}
        <div className="space-y-3">
          {sorted.length === 0 ? (
            <Card className="bg-surface border-border">
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-8 h-8 text-sub mx-auto mb-3 opacity-40" />
                <p className="text-sub text-sm">
                  {impediments.length === 0
                    ? "No impediments logged. Click \"Log Impediment\" to add one."
                    : "No impediments match the current filters."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-sub px-1">
                <span>
                  Showing {sorted.length} of {impediments.length} impediment
                  {impediments.length !== 1 ? "s" : ""}
                </span>
                <span>Sorted by severity and age</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {sorted.map((imp) => (
                  <ImpedimentCard key={imp.id} impediment={imp} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
