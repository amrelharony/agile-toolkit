"use client";

import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateRACIPrompts } from "@/lib/ai-prompts/raci";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type RACIValue = "" | "R" | "A" | "C" | "I";

interface RACIRole {
  id: string;
  name: string;
}

interface RACIActivity {
  id: string;
  name: string;
}

type MatrixData = Record<string, Record<string, RACIValue>>; // activityId -> roleId -> value

interface RACIStore {
  roles: RACIRole[];
  activities: RACIActivity[];
  matrix: MatrixData;
  addRole: () => void;
  removeRole: (id: string) => void;
  updateRoleName: (id: string, name: string) => void;
  addActivity: () => void;
  removeActivity: (id: string) => void;
  updateActivityName: (id: string, name: string) => void;
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

const DEFAULT_ROLES: RACIRole[] = [
  { id: crypto.randomUUID(), name: "Product Owner" },
  { id: crypto.randomUUID(), name: "Scrum Master" },
  { id: crypto.randomUUID(), name: "Dev Team" },
];

const DEFAULT_ACTIVITIES: RACIActivity[] = [
  { id: crypto.randomUUID(), name: "Backlog Refinement" },
  { id: crypto.randomUUID(), name: "Sprint Planning" },
  { id: crypto.randomUUID(), name: "Daily Standup" },
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
        const newRole: RACIRole = {
          id: crypto.randomUUID(),
          name: `Role ${Date.now() % 1000}`,
        };
        set((s) => {
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

      addActivity: () => {
        const newActivity: RACIActivity = {
          id: crypto.randomUUID(),
          name: `Activity ${Date.now() % 1000}`,
        };
        set((s) => {
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

function EditableName({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onChange(trimmed);
    } else {
      setDraft(value);
    }
  }, [draft, value, onChange]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`h-7 text-sm bg-card border-border text-text focus:border-accent/50 focus:ring-accent/20 ${className ?? ""}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`text-sm text-left truncate hover:text-accent transition-colors cursor-text ${className ?? ""}`}
      title="Click to edit"
    >
      {value}
    </button>
  );
}

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
    addRole,
    removeRole,
    updateRoleName,
    addActivity,
    removeActivity,
    updateActivityName,
    setCellValue,
    reset,
  } = useRACIStore();

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

    return ["RACI Matrix", "", headerLine, sep, ...bodyLines].join("\n");
  }, [roles, activities, matrix]);

  const csvData = useMemo(
    () => ({
      headers: ["Activity", ...roles.map((r) => r.name)],
      rows: activities.map((a) => [
        a.name,
        ...roles.map((r) => matrix[a.id]?.[r.id] || ""),
      ]),
    }),
    [roles, activities, matrix]
  );

  const jsonData = useMemo(
    () => ({
      roles: roles.map((r) => r.name),
      activities: activities.map((a) => ({
        name: a.name,
        assignments: Object.fromEntries(
          roles.map((r) => [r.name, matrix[a.id]?.[r.id] || ""])
        ),
      })),
    }),
    [roles, activities, matrix]
  );

  const promptConfig = useMemo(() => ({
    toolName: "RACI Matrix",
    prompts: generateRACIPrompts({ roles, activities, matrix }),
  }), [roles, activities, matrix]);

  /* -- Render ------------------------------------------------------------- */

  return (
    <ToolPageWrapper
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
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <Grid3X3 className="w-5 h-5 text-accent" />
                RACI Matrix
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="raci-matrix"
                  clipboardText={clipboardText}
                  csvData={csvData}
                  jsonData={jsonData}
                  targetRef={exportRef}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="text-sub hover:text-red-400 hover:bg-red-400/10"
                >
                  Reset
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
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
                              className="p-0.5 rounded text-sub hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                              title="Remove role"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="bg-surface-deep border border-border p-2 w-10">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={addRole}
                        className="h-7 w-7 text-accent hover:bg-accent/10"
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
                                className="p-0.5 rounded text-sub hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                                title="Remove activity"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
