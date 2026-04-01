"use client";

import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSkillsMatrixPrompts } from "@/lib/ai-prompts/skills-matrix";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Plus,
  Trash2,
  Star,
  AlertTriangle,
  AlertCircle,
  RotateCcw,
  Info,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types & constants                                                         */
/* -------------------------------------------------------------------------- */

type Proficiency = 0 | 1 | 2 | 3 | 4;

interface TeamMember {
  id: string;
  name: string;
}

interface Skill {
  id: string;
  name: string;
}

type GridData = Record<string, Record<string, Proficiency>>; // skillId -> memberId -> level

interface SkillsMatrixStore {
  members: TeamMember[];
  skills: Skill[];
  grid: GridData;
  addMember: () => void;
  removeMember: (id: string) => void;
  updateMemberName: (id: string, name: string) => void;
  addSkill: () => void;
  removeSkill: (id: string) => void;
  updateSkillName: (id: string, name: string) => void;
  cycleCell: (skillId: string, memberId: string) => void;
  reset: () => void;
}

/* -- Proficiency metadata -------------------------------------------------- */

const PROF_META: {
  label: string;
  shortLabel: string;
  bg: string;
  text: string;
  border: string;
}[] = [
  {
    label: "None",
    shortLabel: "",
    bg: "bg-transparent",
    text: "text-sub",
    border: "border-border",
  },
  {
    label: "Beginner",
    shortLabel: "B",
    bg: "bg-accent/10",
    text: "text-accent/60",
    border: "border-accent/15",
  },
  {
    label: "Intermediate",
    shortLabel: "I",
    bg: "bg-accent/20",
    text: "text-accent/80",
    border: "border-accent/30",
  },
  {
    label: "Advanced",
    shortLabel: "A",
    bg: "bg-accent/40",
    text: "text-accent",
    border: "border-accent/60",
  },
  {
    label: "Expert",
    shortLabel: "E",
    bg: "bg-accent/60",
    text: "text-[#001a1f]",
    border: "border-accent",
  },
];

/* -- Default data ---------------------------------------------------------- */

const DEFAULT_MEMBERS: TeamMember[] = [
  { id: "m1", name: "Alice" },
  { id: "m2", name: "Bob" },
  { id: "m3", name: "Carol" },
];

const DEFAULT_SKILLS: Skill[] = [
  { id: "s1", name: "TypeScript" },
  { id: "s2", name: "React" },
  { id: "s3", name: "Node.js" },
  { id: "s4", name: "CI/CD" },
];

function buildDefaultGrid(
  skills: Skill[],
  members: TeamMember[]
): GridData {
  const grid: GridData = {};
  for (const s of skills) {
    grid[s.id] = {};
    for (const m of members) {
      grid[s.id][m.id] = 0;
    }
  }
  return grid;
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useSkillsStore = create<SkillsMatrixStore>()(
  persist(
    (set) => ({
      members: DEFAULT_MEMBERS,
      skills: DEFAULT_SKILLS,
      grid: buildDefaultGrid(DEFAULT_SKILLS, DEFAULT_MEMBERS),

      addMember: () => {
        const newMember: TeamMember = {
          id: crypto.randomUUID(),
          name: `Member ${Date.now() % 1000}`,
        };
        set((s) => {
          const grid = { ...s.grid };
          for (const sId of Object.keys(grid)) {
            grid[sId] = { ...grid[sId], [newMember.id]: 0 };
          }
          return { members: [...s.members, newMember], grid };
        });
      },

      removeMember: (id) =>
        set((s) => {
          const grid = { ...s.grid };
          for (const sId of Object.keys(grid)) {
            const row = { ...grid[sId] };
            delete row[id];
            grid[sId] = row;
          }
          return { members: s.members.filter((m) => m.id !== id), grid };
        }),

      updateMemberName: (id, name) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, name } : m)),
        })),

      addSkill: () => {
        const newSkill: Skill = {
          id: crypto.randomUUID(),
          name: `Skill ${Date.now() % 1000}`,
        };
        set((s) => {
          const row: Record<string, Proficiency> = {};
          for (const m of s.members) {
            row[m.id] = 0;
          }
          return {
            skills: [...s.skills, newSkill],
            grid: { ...s.grid, [newSkill.id]: row },
          };
        });
      },

      removeSkill: (id) =>
        set((s) => {
          const grid = { ...s.grid };
          delete grid[id];
          return { skills: s.skills.filter((sk) => sk.id !== id), grid };
        }),

      updateSkillName: (id, name) =>
        set((s) => ({
          skills: s.skills.map((sk) => (sk.id === id ? { ...sk, name } : sk)),
        })),

      cycleCell: (skillId, memberId) =>
        set((s) => {
          const current = s.grid[skillId]?.[memberId] ?? 0;
          const next = ((current + 1) % 5) as Proficiency;
          return {
            grid: {
              ...s.grid,
              [skillId]: {
                ...s.grid[skillId],
                [memberId]: next,
              },
            },
          };
        }),

      reset: () => {
        const members = [
          { id: crypto.randomUUID(), name: "Alice" },
          { id: crypto.randomUUID(), name: "Bob" },
          { id: crypto.randomUUID(), name: "Carol" },
        ];
        const skills = [
          { id: crypto.randomUUID(), name: "TypeScript" },
          { id: crypto.randomUUID(), name: "React" },
          { id: crypto.randomUUID(), name: "Node.js" },
          { id: crypto.randomUUID(), name: "CI/CD" },
        ];
        set({
          members,
          skills,
          grid: buildDefaultGrid(skills, members),
        });
      },
    }),
    { name: "agile-toolkit:skills-matrix" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Editable name cell                                                        */
/* -------------------------------------------------------------------------- */

function EditableName({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`h-7 text-sm bg-card border-border text-text focus:border-accent/50 ${className ?? ""}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`text-sm text-left truncate hover:text-accent transition-colors cursor-text ${className ?? ""}`}
    >
      {value}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Proficiency cell                                                          */
/* -------------------------------------------------------------------------- */

function ProfCell({
  level,
  onClick,
  title,
}: {
  level: Proficiency;
  onClick: () => void;
  title: string;
}) {
  const meta = PROF_META[level];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title}: ${meta.label} — click to advance`}
      className={`w-full h-10 rounded border flex items-center justify-center transition-all hover:opacity-80 active:scale-95 select-none ${meta.bg} ${meta.border}`}
    >
      {level === 0 ? (
        <span className="text-xs text-sub/50">·</span>
      ) : level === 4 ? (
        <span className={`flex items-center gap-0.5 text-xs font-bold ${meta.text}`}>
          <Star className="w-3 h-3 fill-current" />
          {meta.shortLabel}
        </span>
      ) : (
        <span className={`text-xs font-bold ${meta.text}`}>
          {meta.shortLabel}
        </span>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Analysis helpers                                                          */
/* -------------------------------------------------------------------------- */

function analyzeSkills(
  skills: Skill[],
  members: TeamMember[],
  grid: GridData
) {
  return skills.map((skill) => {
    const row = grid[skill.id] ?? {};
    const proficient = members.filter((m) => (row[m.id] ?? 0) >= 2).length;
    const advanced = members.filter((m) => (row[m.id] ?? 0) >= 3).length;
    const isSPOF = proficient === 0;
    const isBusFactor = !isSPOF && advanced === 1;
    return { skill, proficient, advanced, isSPOF, isBusFactor };
  });
}

/* -------------------------------------------------------------------------- */
/*  Main Client                                                               */
/* -------------------------------------------------------------------------- */

export function SkillsMatrixClient() {
  const {
    members,
    skills,
    grid,
    addMember,
    removeMember,
    updateMemberName,
    addSkill,
    removeSkill,
    updateSkillName,
    cycleCell,
    reset,
  } = useSkillsStore();

  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Analysis ----------------------------------------------------------- */

  const analysis = useMemo(
    () => analyzeSkills(skills, members, grid),
    [skills, members, grid]
  );

  const spofCount = useMemo(
    () => analysis.filter((a) => a.isSPOF).length,
    [analysis]
  );
  const busFactorCount = useMemo(
    () => analysis.filter((a) => a.isBusFactor).length,
    [analysis]
  );

  const overallCoverage = useMemo(() => {
    if (skills.length === 0 || members.length === 0) return 0;
    let filled = 0;
    let total = 0;
    for (const skill of skills) {
      for (const member of members) {
        total++;
        if ((grid[skill.id]?.[member.id] ?? 0) > 0) filled++;
      }
    }
    return total > 0 ? Math.round((filled / total) * 100) : 0;
  }, [skills, members, grid]);

  /* -- Export -------------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: ["Skill", ...members.map((m) => m.name)],
      rows: skills.map((skill) => [
        skill.name,
        ...members.map((m) => {
          const l = grid[skill.id]?.[m.id] ?? 0;
          return l === 0 ? "" : PROF_META[l].label;
        }),
      ]),
    }),
    [skills, members, grid]
  );

  const clipboardText = useMemo(() => {
    const header = ["Skill".padEnd(20), ...members.map((m) => m.name.padEnd(14))].join(" | ");
    const sep = "-".repeat(header.length);
    const rows = skills.map((skill) => {
      const cols = [
        skill.name.padEnd(20),
        ...members.map((m) => {
          const l = grid[skill.id]?.[m.id] ?? 0;
          return (l === 0 ? "-" : PROF_META[l].label).padEnd(14);
        }),
      ];
      return cols.join(" | ");
    });
    const flags = analysis
      .filter((a) => a.isSPOF || a.isBusFactor)
      .map((a) =>
        a.isSPOF
          ? `[KNOWLEDGE GAP] ${a.skill.name}`
          : `[BUS FACTOR] ${a.skill.name} — only 1 person at Advanced+`
      );
    return [
      "TEAM SKILLS MATRIX",
      "=".repeat(40),
      "",
      header,
      sep,
      ...rows,
      ...(flags.length > 0 ? ["", "RISK FLAGS", "-".repeat(40), ...flags] : []),
    ].join("\n");
  }, [skills, members, grid, analysis]);

  const promptConfig = useMemo(() => ({
    toolName: "Skills Matrix",
    prompts: generateSkillsMatrixPrompts({ members, skills, grid }),
  }), [members, skills, grid]);

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      title="Team Skills Matrix"
      description="Map team proficiency across skills, detect bus factor risks, and identify knowledge gaps at a glance."
      category="Team Health & Maturity"
    >
      <div className="space-y-6">
        {/* ---- Stats bar -------------------------------------------------- */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/5 border border-accent/20">
            <Users className="w-4 h-4 text-accent" />
            <span className="text-sm text-sub">Coverage</span>
            <span className="font-data font-bold text-accent">
              {overallCoverage}%
            </span>
          </div>
          {busFactorCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/5 border border-amber-500/30">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-amber-300">
                {busFactorCount} bus factor{busFactorCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
          {spofCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/5 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-300">
                {spofCount} knowledge gap{spofCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="team-skills-matrix"
              clipboardText={clipboardText}
              csvData={csvData}
              targetRef={exportRef}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="gap-1.5 text-sub hover:text-red-400 hover:bg-red-400/10"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>
        </div>

        {/* ---- Matrix ----------------------------------------------------- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
              <Users className="w-5 h-5 text-accent" />
              Skills Grid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={exportRef} className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {/* corner cell */}
                    <th className="bg-surface-deep border border-border p-2 text-left text-xs text-sub font-medium uppercase tracking-wider min-w-[160px]">
                      Skill / Member
                    </th>
                    {members.map((member) => (
                      <th
                        key={member.id}
                        className="bg-surface-deep border border-border p-2 min-w-[110px]"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <EditableName
                            value={member.name}
                            onChange={(n) => updateMemberName(member.id, n)}
                            className="flex-1 font-bold text-text text-xs"
                          />
                          {members.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeMember(member.id)}
                              className="p-0.5 rounded text-sub hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                              title="Remove member"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="bg-surface-deep border border-border p-2 w-10">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={addMember}
                        className="h-7 w-7 text-accent hover:bg-accent/10"
                        title="Add member"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.map(
                    ({ skill, isSPOF, isBusFactor }) => (
                      <tr key={skill.id}>
                        <td
                          className={`border p-2 bg-surface-deep ${
                            isSPOF
                              ? "border-red-500/50"
                              : isBusFactor
                              ? "border-amber-500/40"
                              : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <EditableName
                              value={skill.name}
                              onChange={(n) => updateSkillName(skill.id, n)}
                              className="flex-1 font-medium text-text text-sm"
                            />
                            {isSPOF && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-red-500/50 text-red-400 bg-red-500/10 px-1 py-0 h-4 flex-shrink-0"
                                title="Knowledge gap: no one has Intermediate+ proficiency"
                              >
                                GAP
                              </Badge>
                            )}
                            {isBusFactor && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/50 text-amber-400 bg-amber-500/10 px-1 py-0 h-4 flex-shrink-0"
                                title="Bus factor risk: only 1 person at Advanced+ level"
                              >
                                BUS 1
                              </Badge>
                            )}
                            {skills.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeSkill(skill.id)}
                                className="p-0.5 rounded text-sub hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                                title="Remove skill"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>
                        {members.map((member) => (
                          <td
                            key={member.id}
                            className={`border p-1.5 ${
                              isSPOF
                                ? "border-red-500/30"
                                : isBusFactor
                                ? "border-amber-500/20"
                                : "border-border"
                            }`}
                          >
                            <ProfCell
                              level={grid[skill.id]?.[member.id] ?? 0}
                              onClick={() => cycleCell(skill.id, member.id)}
                              title={`${skill.name} / ${member.name}`}
                            />
                          </td>
                        ))}
                        <td className="border border-border p-1.5" />
                      </tr>
                    )
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      className="border border-border p-2"
                      colSpan={members.length + 2}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={addSkill}
                        className="gap-1.5 text-accent hover:bg-accent/10"
                      >
                        <Plus className="w-4 h-4" />
                        Add Skill
                      </Button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ---- Legend + Risk summary -------------------------------------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Proficiency legend */}
          <Card className="bg-surface border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-display text-text flex items-center gap-2">
                <Info className="w-4 h-4 text-accent" />
                Proficiency Levels
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {PROF_META.map((meta, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className={`w-8 h-6 rounded border flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.border}`}
                  >
                    {i === 0 ? (
                      <span className="text-xs text-sub/50">·</span>
                    ) : i === 4 ? (
                      <Star className={`w-3 h-3 fill-current ${meta.text}`} />
                    ) : (
                      <span className={`text-xs font-bold ${meta.text}`}>
                        {meta.shortLabel}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-medium text-text">
                      {i} — {meta.label}
                    </span>
                    {i === 0 && (
                      <span className="text-xs text-sub ml-2">
                        (click a cell to start)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Risk summary */}
          <Card className="bg-surface border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-display text-text flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-accent" />
                Risk Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {analysis.filter((a) => a.isSPOF || a.isBusFactor).length ===
              0 ? (
                <p className="text-sm text-sub">
                  No risks detected. All skills have adequate coverage.
                </p>
              ) : (
                <>
                  {analysis
                    .filter((a) => a.isSPOF)
                    .map(({ skill }) => (
                      <div
                        key={skill.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20"
                      >
                        <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-red-300">
                            {skill.name}
                          </p>
                          <p className="text-xs text-sub">
                            Knowledge gap — nobody has Intermediate+ proficiency.
                          </p>
                        </div>
                      </div>
                    ))}
                  {analysis
                    .filter((a) => a.isBusFactor)
                    .map(({ skill }) => (
                      <div
                        key={skill.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-amber-300">
                            {skill.name}
                          </p>
                          <p className="text-xs text-sub">
                            Bus factor 1 — only one person at Advanced or Expert level.
                          </p>
                        </div>
                      </div>
                    ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
