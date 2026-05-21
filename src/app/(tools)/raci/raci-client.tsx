"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EditableName } from "@/components/shared/editable-name";
import { generateRACIPrompts } from "@/lib/ai-prompts/raci";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RACI_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/shared/section-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Grid3X3,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type RACIValue = "" | "R" | "A" | "C" | "I";

interface RACIRole {
  id: string;
  name: string;
  description?: string;
}

interface RACIActivity {
  id: string;
  name: string;
  description?: string;
}

type MatrixData = Record<string, Record<string, RACIValue>>; // activityId -> roleId -> value

interface RACIStore {
  roles: RACIRole[];
  activities: RACIActivity[];
  matrix: MatrixData;
  addRole: () => void;
  removeRole: (id: string) => void;
  updateRoleName: (id: string, name: string) => void;
  updateRoleDescription: (id: string, description: string) => void;
  addActivity: () => void;
  removeActivity: (id: string) => void;
  updateActivityName: (id: string, name: string) => void;
  updateActivityDescription: (id: string, description: string) => void;
  setCellValue: (activityId: string, roleId: string, value: RACIValue) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const RACI_COLORS: Record<string, string> = {
  R: "#00f0ff",
  A: "#ff00aa",
  C: "#00ff88",
  I: "#ffaa00",
};

const RACI_LABELS: Record<string, string> = {
  R: "Responsible",
  A: "Accountable",
  C: "Consulted",
  I: "Informed",
};

// Deterministic IDs in module-level defaults so SSR HTML matches client HTML
// on first paint. User-added rows get real UUIDs via the action handlers.
const DEFAULT_ROLES: RACIRole[] = [
  { id: "default:role-po", name: "Product Owner" },
  { id: "default:role-sm", name: "Scrum Master" },
  { id: "default:role-dev", name: "Dev Team" },
];

const DEFAULT_ACTIVITIES: RACIActivity[] = [
  { id: "default:act-refinement", name: "Backlog Refinement" },
  { id: "default:act-planning", name: "Sprint Planning" },
  { id: "default:act-standup", name: "Daily Standup" },
];

function buildDefaultMatrix(
  activities: RACIActivity[],
  roles: RACIRole[]
): MatrixData {
  const m: MatrixData = {};
  for (const a of activities) {
    m[a.id] = {};
    for (const r of roles) {
      m[a.id][r.id] = "";
    }
  }
  return m;
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useRACIStore = create<RACIStore>()(
  persist(
    (set) => ({
      roles: DEFAULT_ROLES,
      activities: DEFAULT_ACTIVITIES,
      matrix: buildDefaultMatrix(DEFAULT_ACTIVITIES, DEFAULT_ROLES),

      addRole: () => {
        set((s) => {
          const used = new Set(
            s.roles
              .map((r) => parseInt(String(r.name).replace(/\D/g, ""), 10))
              .filter(Number.isFinite)
          );
          let n = 1;
          while (used.has(n)) n++;
          const newRole: RACIRole = {
            id: crypto.randomUUID(),
            name: `Role ${n}`,
          };
          const matrix = { ...s.matrix };
          for (const aId of Object.keys(matrix)) {
            matrix[aId] = { ...matrix[aId], [newRole.id]: "" };
          }
          return { roles: [...s.roles, newRole], matrix };
        });
      },

      removeRole: (id) =>
        set((s) => {
          const matrix = { ...s.matrix };
          for (const aId of Object.keys(matrix)) {
            const row = { ...matrix[aId] };
            delete row[id];
            matrix[aId] = row;
          }
          return {
            roles: s.roles.filter((r) => r.id !== id),
            matrix,
          };
        }),

      updateRoleName: (id, name) =>
        set((s) => ({
          roles: s.roles.map((r) => (r.id === id ? { ...r, name } : r)),
        })),

      updateRoleDescription: (id, description) =>
        set((s) => ({
          roles: s.roles.map((r) =>
            r.id === id
              ? { ...r, description: description.trim() || undefined }
              : r
          ),
        })),

      addActivity: () => {
        set((s) => {
          const used = new Set(
            s.activities
              .map((a) => parseInt(String(a.name).replace(/\D/g, ""), 10))
              .filter(Number.isFinite)
          );
          let n = 1;
          while (used.has(n)) n++;
          const newActivity: RACIActivity = {
            id: crypto.randomUUID(),
            name: `Activity ${n}`,
          };
          const row: Record<string, RACIValue> = {};
          for (const r of s.roles) {
            row[r.id] = "";
          }
          return {
            activities: [...s.activities, newActivity],
            matrix: { ...s.matrix, [newActivity.id]: row },
          };
        });
      },

      removeActivity: (id) =>
        set((s) => {
          const matrix = { ...s.matrix };
          delete matrix[id];
          return {
            activities: s.activities.filter((a) => a.id !== id),
            matrix,
          };
        }),

      updateActivityName: (id, name) =>
        set((s) => ({
          activities: s.activities.map((a) =>
            a.id === id ? { ...a, name } : a
          ),
        })),

      updateActivityDescription: (id, description) =>
        set((s) => ({
          activities: s.activities.map((a) =>
            a.id === id
              ? { ...a, description: description.trim() || undefined }
              : a
          ),
        })),

      setCellValue: (activityId, roleId, value) =>
        set((s) => ({
          matrix: {
            ...s.matrix,
            [activityId]: {
              ...s.matrix[activityId],
              [roleId]: value,
            },
          },
        })),

      reset: () => {
        const roles = [
          { id: crypto.randomUUID(), name: "Product Owner" },
          { id: crypto.randomUUID(), name: "Scrum Master" },
          { id: crypto.randomUUID(), name: "Dev Team" },
        ];
        const activities = [
          { id: crypto.randomUUID(), name: "Backlog Refinement" },
          { id: crypto.randomUUID(), name: "Sprint Planning" },
          { id: crypto.randomUUID(), name: "Daily Standup" },
        ];
        set({
          roles,
          activities,
          matrix: buildDefaultMatrix(activities, roles),
        });
      },
    }),
    { name: "agile-toolkit:raci" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

interface ValidationIssue {
  activityId: string;
  activityName: string;
  message: string;
}

function validateMatrix(
  activities: RACIActivity[],
  roles: RACIRole[],
  matrix: MatrixData
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const activity of activities) {
    const row = matrix[activity.id] || {};
    let aCount = 0;
    for (const role of roles) {
      if (row[role.id] === "A") aCount++;
    }
    if (aCount === 0) {
      issues.push({
        activityId: activity.id,
        activityName: activity.name,
        message: `"${activity.name}" has no Accountable (A) role assigned.`,
      });
    } else if (aCount > 1) {
      issues.push({
        activityId: activity.id,
        activityName: activity.name,
        message: `"${activity.name}" has ${aCount} Accountable (A) roles. Must be exactly 1.`,
      });
    }
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/*  Editable Name Cell                                                        */
/* -------------------------------------------------------------------------- */

// EditableName moved to @/components/shared/editable-name (imported above).

/* -------------------------------------------------------------------------- */
/*  RACI Cell                                                                 */
/* -------------------------------------------------------------------------- */

function RACICell({
  value,
  onChange,
}: {
  value: RACIValue;
  onChange: (v: RACIValue) => void;
}) {
  const color = value ? RACI_COLORS[value] : undefined;

  return (
    <Select value={value || "empty"} onValueChange={(v) => onChange(v === "empty" ? "" : (v as RACIValue))}>
      <SelectTrigger
        className="h-10 w-full border-border bg-surface text-center justify-center focus:ring-accent/20"
        style={
          color
            ? {
                borderColor: `${color}40`,
                backgroundColor: `${color}10`,
              }
            : undefined
        }
      >
        <SelectValue>
          {value ? (
            <span
              className="text-lg font-bold font-data"
              style={{ color }}
            >
              {value}
            </span>
          ) : (
            <span className="text-sub text-xs">-</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-surface border-border">
        <SelectItem value="empty" className="cursor-pointer">
          <span className="text-sub">- (None)</span>
        </SelectItem>
        {(["R", "A", "C", "I"] as const).map((letter) => (
          <SelectItem key={letter} value={letter} className="cursor-pointer">
            <span style={{ color: RACI_COLORS[letter] }} className="font-bold">
              {letter}
            </span>
            <span className="ml-2 text-sub text-xs">
              {RACI_LABELS[letter]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                     */
/* -------------------------------------------------------------------------- */

export function RACIClient() {
  const {
    roles,
    activities,
    matrix,
    addRole: addRoleRaw,
    removeRole: removeRoleRaw,
    updateRoleName,
    updateRoleDescription,
    addActivity: addActivityRaw,
    removeActivity: removeActivityRaw,
    updateActivityName,
    updateActivityDescription,
    setCellValue: setCellValueRaw,
    reset: resetRaw,
  } = useRACIStore();
  const { log } = useHistoryLogger("raci");

  const addRole: typeof addRoleRaw = (...args) => {
    addRoleRaw(...args);
    log(RACI_ACTIONS.ROLE_ADDED, {});
  };
  const removeRole: typeof removeRoleRaw = (id) => {
    const role = roles.find((r) => r.id === id);
    removeRoleRaw(id);
    log(RACI_ACTIONS.ROLE_REMOVED, { roleId: id, name: role?.name });
  };
  const addActivity: typeof addActivityRaw = (...args) => {
    addActivityRaw(...args);
    log(RACI_ACTIONS.ACTIVITY_ADDED, {});
  };
  const removeActivity: typeof removeActivityRaw = (id) => {
    const activity = activities.find((a) => a.id === id);
    removeActivityRaw(id);
    log(RACI_ACTIONS.ACTIVITY_REMOVED, { activityId: id, name: activity?.name });
  };
  const setCellValue: typeof setCellValueRaw = (...args) => {
    setCellValueRaw(...args);
    log(RACI_ACTIONS.ASSIGNMENT_CHANGED, {
      activityId: args[0],
      roleId: args[1],
      value: args[2],
    });
  };
  const reset = () => {
    resetRaw();
    log(RACI_ACTIONS.RACI_RESET, {});
  };

  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Validation --------------------------------------------------------- */

  const issues = useMemo(
    () => validateMatrix(activities, roles, matrix),
    [activities, roles, matrix]
  );

  const issueActivityIds = useMemo(
    () => new Set(issues.map((i) => i.activityId)),
    [issues]
  );

  /* -- Export data --------------------------------------------------------- */

  const clipboardText = useMemo(() => {
    const colWidths: number[] = [];
    const header = ["Activity", ...roles.map((r) => r.name)];
    header.forEach((h, i) => {
      colWidths[i] = h.length;
    });

    const rows = activities.map((a) => {
      const row = [a.name, ...roles.map((r) => matrix[a.id]?.[r.id] || "-")];
      row.forEach((cell, i) => {
        colWidths[i] = Math.max(colWidths[i] || 0, cell.length);
      });
      return row;
    });

    const pad = (s: string, w: number) => s.padEnd(w);
    const sep = colWidths.map((w) => "-".repeat(w)).join(" | ");
    const headerLine = header.map((h, i) => pad(h, colWidths[i])).join(" | ");
    const bodyLines = rows.map((r) =>
      r.map((c, i) => pad(c, colWidths[i])).join(" | ")
    );

    // Reference blocks listing every role/activity with its description so the
    // matrix labels alone don't strip context when pasted.
    const roleLines = roles.map(
      (r) => `  - ${r.name}${r.description ? `: ${r.description}` : ""}`
    );
    const activityLines = activities.map(
      (a) => `  - ${a.name}${a.description ? `: ${a.description}` : ""}`
    );

    const out: string[] = ["RACI Matrix", ""];
    if (roles.length > 0) {
      out.push("Roles", ...roleLines, "");
    }
    if (activities.length > 0) {
      out.push("Activities", ...activityLines, "");
    }
    out.push(headerLine, sep, ...bodyLines);
    return out.join("\n");
  }, [roles, activities, matrix]);

  const csvData = useMemo(() => {
    // Sidecar table appended after the matrix carries Role/Activity descriptions
    // so the export round-trips with the same data the UI shows.
    const roleColCount = roles.length;
    const matrixRows = activities.map((a) => [
      a.name,
      ...roles.map((r) => matrix[a.id]?.[r.id] || ""),
    ]);

    const sidecarRows: (string | number)[][] = [];
    if (roles.length > 0 || activities.length > 0) {
      // Blank separator row keeps the matrix and reference data visually distinct.
      sidecarRows.push(Array(roleColCount + 1).fill(""));
      sidecarRows.push(["Reference", ...Array(roleColCount).fill("")]);
      if (roles.length > 0) {
        sidecarRows.push(["Role", "Description", ...Array(Math.max(0, roleColCount - 1)).fill("")]);
        for (const r of roles) {
          sidecarRows.push([r.name, r.description ?? "", ...Array(Math.max(0, roleColCount - 1)).fill("")]);
        }
      }
      if (activities.length > 0) {
        sidecarRows.push(["Activity", "Description", ...Array(Math.max(0, roleColCount - 1)).fill("")]);
        for (const a of activities) {
          sidecarRows.push([a.name, a.description ?? "", ...Array(Math.max(0, roleColCount - 1)).fill("")]);
        }
      }
    }

    return {
      headers: ["Activity", ...roles.map((r) => r.name)],
      rows: [...matrixRows, ...sidecarRows],
    };
  }, [roles, activities, matrix]);

  const jsonData = useMemo(
    () => ({
      roles: roles.map((r) => ({ name: r.name, description: r.description ?? "" })),
      activities: activities.map((a) => ({
        name: a.name,
        description: a.description ?? "",
        assignments: Object.fromEntries(
          roles.map((r) => [r.name, matrix[a.id]?.[r.id] || ""])
        ),
      })),
    }),
    [roles, activities, matrix]
  );

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
        impediments: s.impediments, risks: s.risks, okrs: s.okrs,
        decisions: s.decisions, techDebt: s.techDebt,
        maturityLevel: s.maturityLevel, teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(() => ({
    toolName: "RACI Matrix",
    prompts: generateRACIPrompts({ roles, activities, matrix }, workspace),
  }), [roles, activities, matrix, workspace]);

  /* -- Render ------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="raci"
      title="RACI Matrix Builder"
      description="Define roles and activities, then assign Responsible, Accountable, Consulted, or Informed to clarify ownership."
      category="Team Health & Maturity"
    >
      <div ref={exportRef} className="space-y-6">
        {/* ---- Legend ---- */}
        <div className="flex flex-wrap gap-4">
          {(["R", "A", "C", "I"] as const).map((letter) => (
            <div key={letter} className="flex items-center gap-2">
              <span
                className="w-7 h-7 rounded flex items-center justify-center text-sm font-bold font-data"
                style={{
                  color: RACI_COLORS[letter],
                  backgroundColor: `${RACI_COLORS[letter]}15`,
                  border: `1px solid ${RACI_COLORS[letter]}40`,
                }}
              >
                {letter}
              </span>
              <span className="text-sm text-sub">
                {RACI_LABELS[letter]}
              </span>
            </div>
          ))}
        </div>

        {/* ---- Validation Summary ---- */}
        {activities.length > 0 && (
          <Card
            className={`border ${
              issues.length > 0
                ? "bg-red-500/5 border-red-500/30"
                : "bg-emerald-500/5 border-emerald-500/30"
            }`}
          >
            <CardContent className="p-4">
              {issues.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm font-medium">
                      {issues.length} validation{" "}
                      {issues.length === 1 ? "issue" : "issues"}
                    </span>
                  </div>
                  <ul className="space-y-1 pl-6">
                    {issues.map((issue, i) => (
                      <li
                        key={i}
                        className="text-xs text-red-300/80 list-disc"
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium">
                    All activities have exactly one Accountable (A) role.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- Matrix ---- */}
        <SectionCard
          title="RACI Matrix"
          icon={Grid3X3}
          titleSize="lg"
          headerClassName="pb-4"
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="raci-matrix"
                clipboardText={clipboardText}
                csvData={csvData}
                jsonData={jsonData}
                targetRef={exportRef}
              />
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={reset}
              >
                Reset
              </Button>
            </>
          }
        >
          {/* ── Mobile card view (< md / 768px) ───────────────────────── */}
            {/* The table needs ≥ 500 px to be readable; on phones we stack
                each activity into a card with role-by-role rows. Same data,
                same callbacks — only the visual layout changes. */}
            <div className="md:hidden space-y-3">
              {activities.map((activity) => {
                const hasIssue = issueActivityIds.has(activity.id);
                return (
                  <div
                    key={activity.id}
                    className={`rounded-lg border bg-surface-deep p-3 space-y-2 ${
                      hasIssue ? "border-red-500/50" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <EditableName
                        value={activity.name}
                        onChange={(name) =>
                          updateActivityName(activity.id, name)
                        }
                        className="flex-1 font-medium text-text"
                      />
                      {activities.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeActivity(activity.id)}
                          className="btn-danger-ghost min-touch -m-2 p-2 rounded flex-shrink-0"
                          aria-label={`Remove activity ${activity.name}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {/* Optional description for this activity. Empty trims to
                        undefined in the store updater. */}
                    <Textarea
                      value={activity.description ?? ""}
                      onChange={(e) =>
                        updateActivityDescription(activity.id, e.target.value)
                      }
                      placeholder="Description (optional)..."
                      rows={2}
                      className="bg-surface border-border resize-none text-xs"
                      aria-label={`Description for activity ${activity.name}`}
                    />
                    <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
                      {roles.map((role) => (
                        <div
                          key={role.id}
                          className="flex items-center gap-2 rounded-md bg-[var(--bg2)] px-2 py-1.5 border border-border"
                        >
                          <span className="text-xs text-sub font-medium truncate flex-1">
                            {role.name}
                          </span>
                          <RACICell
                            value={matrix[activity.id]?.[role.id] || ""}
                            onChange={(v) =>
                              setCellValue(activity.id, role.id, v)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addActivity}
                  className="gap-1.5 flex-1"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add activity
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRole}
                  className="gap-1.5 flex-1"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add role
                </Button>
              </div>
              {roles.length > 1 && (
                <details className="text-xs text-sub mt-2">
                  <summary className="cursor-pointer hover:text-text min-touch py-2 inline-block">
                    Manage roles ({roles.length})
                  </summary>
                  <ul className="mt-2 space-y-2 pl-1">
                    {roles.map((role) => (
                      <li
                        key={role.id}
                        className="rounded-md border border-border bg-[var(--bg2)] px-2 py-1.5 space-y-1"
                      >
                        <div className="flex items-center gap-2">
                          <EditableName
                            value={role.name}
                            onChange={(name) => updateRoleName(role.id, name)}
                            className="flex-1 font-medium text-text"
                          />
                          <button
                            type="button"
                            onClick={() => removeRole(role.id)}
                            className="btn-danger-ghost min-touch -m-2 p-2 rounded flex-shrink-0"
                            aria-label={`Remove role ${role.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        {/* Compact single-line description input — keeps the
                            roles list dense; empty trims to undefined. */}
                        <Input
                          value={role.description ?? ""}
                          onChange={(e) =>
                            updateRoleDescription(role.id, e.target.value)
                          }
                          placeholder="Description (optional)..."
                          className="h-7 text-xs bg-surface border-border"
                          aria-label={`Description for role ${role.name}`}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* ── Desktop matrix view (md+) ─────────────────────────────── */}
            <div className="hidden md:block table-wrap-responsive">
              <table className="w-full border-collapse min-w-[500px]">
                <thead>
                  <tr>
                    {/* Top-left corner */}
                    <th className="bg-surface-deep border border-border p-2 text-left text-xs text-sub font-medium uppercase tracking-wider min-w-[160px]">
                      Activity / Role
                    </th>
                    {roles.map((role) => (
                      <th
                        key={role.id}
                        className="bg-surface-deep border border-border p-2 min-w-[120px]"
                        title={role.description || undefined}
                      >
                        <div className="flex items-center gap-1">
                          <EditableName
                            value={role.name}
                            onChange={(name) => updateRoleName(role.id, name)}
                            className="flex-1 font-bold text-text"
                          />
                          {roles.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeRole(role.id)}
                              className="btn-danger-ghost p-0.5 rounded flex-shrink-0"
                              title="Remove role"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {/* Compact one-line description input directly under the
                            role name. Stays optional; trims to undefined in store. */}
                        <Input
                          value={role.description ?? ""}
                          onChange={(e) =>
                            updateRoleDescription(role.id, e.target.value)
                          }
                          placeholder="Description (optional)..."
                          className="mt-1 h-6 text-[11px] bg-surface border-border"
                          aria-label={`Description for role ${role.name}`}
                        />
                      </th>
                    ))}
                    <th className="bg-surface-deep border border-border p-2 w-10">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={addRole}
                        className="min-touch-coarse h-7 w-7 text-accent hover:bg-accent/10"
                        title="Add role"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((activity) => {
                    const hasIssue = issueActivityIds.has(activity.id);
                    return (
                      <tr key={activity.id}>
                        <td
                          className={`border p-2 bg-surface-deep ${
                            hasIssue
                              ? "border-red-500/50"
                              : "border-border"
                          }`}
                          title={activity.description || undefined}
                        >
                          <div className="flex items-center gap-1">
                            <EditableName
                              value={activity.name}
                              onChange={(name) =>
                                updateActivityName(activity.id, name)
                              }
                              className="flex-1 font-medium text-text"
                            />
                            {activities.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeActivity(activity.id)}
                                className="btn-danger-ghost p-0.5 rounded flex-shrink-0"
                                title="Remove activity"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {/* Compact one-line description for this activity.
                              Empty trims to undefined in the store updater. */}
                          <Input
                            value={activity.description ?? ""}
                            onChange={(e) =>
                              updateActivityDescription(activity.id, e.target.value)
                            }
                            placeholder="Description (optional)..."
                            className="mt-1 h-6 text-[11px] bg-surface border-border"
                            aria-label={`Description for activity ${activity.name}`}
                          />
                        </td>
                        {roles.map((role) => (
                          <td
                            key={role.id}
                            className={`border p-1.5 ${
                              hasIssue
                                ? "border-red-500/50"
                                : "border-border"
                            }`}
                          >
                            <RACICell
                              value={matrix[activity.id]?.[role.id] || ""}
                              onChange={(v) =>
                                setCellValue(activity.id, role.id, v)
                              }
                            />
                          </td>
                        ))}
                        <td className="border border-border p-1.5" />
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      className="border border-border p-2"
                      colSpan={roles.length + 2}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={addActivity}
                        className="gap-1.5 text-accent hover:bg-accent/10"
                      >
                        <Plus className="w-4 h-4" />
                        Add Activity
                      </Button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
