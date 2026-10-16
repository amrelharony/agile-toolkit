"use client";

import { useRef, useMemo, useEffect } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSkillsMatrixPrompts } from "@/lib/ai-prompts/skills-matrix";
import { EditableName } from "@/components/shared/editable-name";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SKILLS_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { BlurInput } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
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
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  defaultSkillsMatrix,
  type Workspace,
  type SkillsMatrix,
  type SkillsMatrixMember as TeamMember,
  type SkillsMatrixSkill as Skill,
  type SkillProficiency as Proficiency,
  type SkillsMatrixGrid as GridData,
} from "@/lib/stores/workspace-types";

/* -------------------------------------------------------------------------- */
/*  Constants (types come from workspace-types, aliased on import)            */
/* -------------------------------------------------------------------------- */

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

/* -- Synced singleton store (was isolated zustand persist/localStorage) ---- */

const SM_ID = "skillsMatrix:current"; // MUST match SM_ID in skills-matrix.ts.

/** Latest doc snapshot, read synchronously (avoids stale closures in setters). */
function peekDoc(): SkillsMatrix {
  return (
    (useWorkspaceStore.getState().skillsMatrices ?? []).find((d) => d.id === SM_ID) ??
    defaultSkillsMatrix(SM_ID)
  );
}

/** Lowest unused "<prefix> N" label (avoids same-millisecond collisions). */
function nextLabel(names: string[], prefix: string): string {
  const used = new Set(
    names.map((nm) => parseInt(nm.replace(/\D/g, ""), 10)).filter(Number.isFinite)
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix} ${n}`;
}

// Mirrors the old useSkillsStore API ({members, skills, grid, addMember,
// removeMember, updateMemberName, updateMemberDescription, addSkill,
// removeSkill, updateSkillName, updateSkillDescription, cycleCell, reset})
// but backed by the synced workspace store, so the component is unchanged.
function useSkillsMatrix() {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.skillsMatrices ?? []).find((d) => d.id === SM_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertSkillsMatrix);
  const view = doc ?? defaultSkillsMatrix(SM_ID);
  const save = (next: SkillsMatrix) => upsert({ ...next, id: SM_ID });
  return {
    members: view.members,
    skills: view.skills,
    grid: view.grid,
    addMember: () => {
      const c = peekDoc();
      const member: TeamMember = {
        id: crypto.randomUUID(),
        name: nextLabel(
          c.members.map((m) => m.name),
          "Member"
        ),
      };
      const grid: GridData = {};
      for (const sId of Object.keys(c.grid)) grid[sId] = { ...c.grid[sId], [member.id]: 0 };
      save({ ...c, members: [...c.members, member], grid });
    },
    removeMember: (id: string) => {
      const c = peekDoc();
      const grid: GridData = {};
      for (const sId of Object.keys(c.grid)) {
        const row = { ...c.grid[sId] };
        delete row[id];
        grid[sId] = row;
      }
      save({ ...c, members: c.members.filter((m) => m.id !== id), grid });
    },
    updateMemberName: (id: string, name: string) => {
      const c = peekDoc();
      save({ ...c, members: c.members.map((m) => (m.id === id ? { ...m, name } : m)) });
    },
    updateMemberDescription: (id: string, description: string) => {
      const c = peekDoc();
      save({
        ...c,
        members: c.members.map((m) =>
          m.id === id ? { ...m, description: description.trim() || undefined } : m
        ),
      });
    },
    addSkill: () => {
      const c = peekDoc();
      const skill: Skill = {
        id: crypto.randomUUID(),
        name: nextLabel(
          c.skills.map((s) => s.name),
          "Skill"
        ),
      };
      const row: Record<string, Proficiency> = {};
      for (const m of c.members) row[m.id] = 0;
      save({ ...c, skills: [...c.skills, skill], grid: { ...c.grid, [skill.id]: row } });
    },
    removeSkill: (id: string) => {
      const c = peekDoc();
      const grid = { ...c.grid };
      delete grid[id];
      save({ ...c, skills: c.skills.filter((s) => s.id !== id), grid });
    },
    updateSkillName: (id: string, name: string) => {
      const c = peekDoc();
      save({ ...c, skills: c.skills.map((s) => (s.id === id ? { ...s, name } : s)) });
    },
    updateSkillDescription: (id: string, description: string) => {
      const c = peekDoc();
      save({
        ...c,
        skills: c.skills.map((s) =>
          s.id === id ? { ...s, description: description.trim() || undefined } : s
        ),
      });
    },
    cycleCell: (skillId: string, memberId: string) => {
      const c = peekDoc();
      const current = c.grid[skillId]?.[memberId] ?? 0;
      const next = ((current + 1) % 5) as Proficiency;
      save({ ...c, grid: { ...c.grid, [skillId]: { ...c.grid[skillId], [memberId]: next } } });
    },
    reset: () => save(defaultSkillsMatrix(SM_ID)),
  };
}

// EditableName moved to @/components/shared/editable-name.

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
  // Clamp on lookup so a corrupt persisted level (out-of-range index from a
  // schema drift or hand-edited localStorage) doesn't dereference undefined.
  const meta = PROF_META[Math.min(4, Math.max(0, level))];
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
        <span className={`text-xs font-bold ${meta.text}`}>{meta.shortLabel}</span>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Analysis helpers                                                          */
/* -------------------------------------------------------------------------- */

function analyzeSkills(skills: Skill[], members: TeamMember[], grid: GridData) {
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
    addMember: addMemberRaw,
    removeMember: removeMemberRaw,
    updateMemberName,
    updateMemberDescription,
    addSkill: addSkillRaw,
    removeSkill: removeSkillRaw,
    updateSkillName,
    updateSkillDescription,
    cycleCell: cycleCellRaw,
    reset: resetRaw,
  } = useSkillsMatrix();
  const { log } = useHistoryLogger("skills-matrix");
  // Debounce cycleCell logging — users typically click 3-4 times to find the
  // right rating. Logging each click would flood the audit log. We schedule
  // a "settled" log 600ms after the last cycleCell call per (memberId, skillId).
  const cycleCellTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = cycleCellTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const addMember: typeof addMemberRaw = (...args) => {
    addMemberRaw(...args);
    log(SKILLS_ACTIONS.PERSON_ADDED, {});
  };
  const removeMember: typeof removeMemberRaw = (id) => {
    const m = members.find((x) => x.id === id);
    removeMemberRaw(id);
    log(SKILLS_ACTIONS.PERSON_REMOVED, { memberId: id, name: m?.name });
  };
  const addSkill: typeof addSkillRaw = (...args) => {
    addSkillRaw(...args);
    log(SKILLS_ACTIONS.SKILL_ADDED, {});
  };
  const removeSkill: typeof removeSkillRaw = (id) => {
    const s = skills.find((x) => x.id === id);
    removeSkillRaw(id);
    log(SKILLS_ACTIONS.SKILL_REMOVED, { skillId: id, name: s?.name });
  };
  const cycleCell: typeof cycleCellRaw = (...args) => {
    cycleCellRaw(...args);
    const key = `${args[0]}|${args[1]}`;
    const timers = cycleCellTimersRef.current;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      timers.delete(key);
      // Read the *settled* rating from current grid at fire time.
      // cycleCell(skillId, memberId) — args[0]=skillId, args[1]=memberId.
      // The prior log payload swapped these labels, corrupting every
      // rating-change audit entry. Grid lookup was correct because the
      // store is keyed grid[skillId][memberId].
      const settled = peekDoc().grid[args[0]]?.[args[1]] ?? null;
      log(SKILLS_ACTIONS.RATING_CHANGED, {
        memberId: args[1],
        skillId: args[0],
        rating: settled,
      });
    }, 600);
    timers.set(key, handle);
  };
  const reset = () => {
    resetRaw();
    log(SKILLS_ACTIONS.SKILLS_RESET, {});
  };

  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Analysis ----------------------------------------------------------- */

  const analysis = useMemo(() => analyzeSkills(skills, members, grid), [skills, members, grid]);

  const spofCount = useMemo(() => analysis.filter((a) => a.isSPOF).length, [analysis]);
  const busFactorCount = useMemo(() => analysis.filter((a) => a.isBusFactor).length, [analysis]);

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
      // Skill descriptions slot in as a second column without breaking the
      // member-per-column matrix layout.
      headers: ["Skill", "Description", ...members.map((m) => m.name)],
      rows: skills.map((skill) => [
        skill.name,
        skill.description ?? "",
        ...members.map((m) => {
          const l = grid[skill.id]?.[m.id] ?? 0;
          return l === 0 ? "" : PROF_META[Math.min(4, Math.max(0, l))].label;
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
          return (l === 0 ? "-" : PROF_META[Math.min(4, Math.max(0, l))].label).padEnd(14);
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

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Skills Matrix",
      prompts: generateSkillsMatrixPrompts({ members, skills, grid }, workspace),
    }),
    [members, skills, grid, workspace]
  );

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="skills-matrix"
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
            <span className="font-data font-bold text-accent">{overallCoverage}%</span>
          </div>
          {busFactorCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-warning/5 border border-warning/30">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <span className="text-sm text-warning">
                {busFactorCount} bus factor{busFactorCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
          {spofCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-danger/5 border border-danger/30">
              <AlertCircle className="w-4 h-4 text-danger" />
              <span className="text-sm text-danger">
                {spofCount} knowledge gap{spofCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="team-skills-matrix"
              clipboardText={clipboardText}
              csvData={csvData}
              targetRef={exportRef}
            />
            <Button variant="danger-ghost" size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>
        </div>

        {/* ---- Matrix ----------------------------------------------------- */}
        <SectionCard title="Skills Grid" icon={Users} titleSize="lg" headerClassName="pb-4">
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
                      title={member.description || undefined}
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
                            className="btn-danger-ghost p-0.5 rounded flex-shrink-0"
                            title="Remove member"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {/* Compact one-line description input — keeps the
                            matrix header dense; empty trims to undefined. */}
                      <BlurInput
                        value={member.description ?? ""}
                        onCommit={(v) => updateMemberDescription(member.id, v)}
                        placeholder="Description (optional)..."
                        className="mt-1 h-6 text-[11px] bg-surface border-border font-normal"
                        aria-label={`Description for member ${member.name}`}
                      />
                    </th>
                  ))}
                  <th className="bg-surface-deep border border-border p-2 w-10">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={addMember}
                      className="min-touch-coarse h-7 w-7 text-accent hover:bg-accent/10"
                      title="Add member"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {analysis.map(({ skill, isSPOF, isBusFactor }) => (
                  <tr key={skill.id}>
                    <td
                      className={`border p-2 bg-surface-deep ${
                        isSPOF
                          ? "border-danger/50"
                          : isBusFactor
                            ? "border-warning/40"
                            : "border-border"
                      }`}
                      title={skill.description || undefined}
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
                            className="text-[10px] border-danger/50 text-danger bg-danger/10 px-1 py-0 h-4 flex-shrink-0"
                            title="Knowledge gap: no one has Intermediate+ proficiency"
                          >
                            GAP
                          </Badge>
                        )}
                        {isBusFactor && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-warning/50 text-warning bg-warning/10 px-1 py-0 h-4 flex-shrink-0"
                            title="Bus factor risk: only 1 person at Advanced+ level"
                          >
                            BUS 1
                          </Badge>
                        )}
                        {skills.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSkill(skill.id)}
                            className="btn-danger-ghost p-0.5 rounded flex-shrink-0"
                            title="Remove skill"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {/* Compact one-line description input keeps the
                              skill row tidy; empty trims to undefined. */}
                      <BlurInput
                        value={skill.description ?? ""}
                        onCommit={(v) => updateSkillDescription(skill.id, v)}
                        placeholder="Description (optional)..."
                        className="mt-1 h-6 text-[11px] bg-surface border-border"
                        aria-label={`Description for skill ${skill.name}`}
                      />
                    </td>
                    {members.map((member) => (
                      <td
                        key={member.id}
                        className={`border p-1.5 ${
                          isSPOF
                            ? "border-danger/30"
                            : isBusFactor
                              ? "border-warning/20"
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
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="border border-border p-2" colSpan={members.length + 2}>
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
        </SectionCard>

        {/* ---- Legend + Risk summary -------------------------------------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Proficiency legend */}
          <SectionCard
            title="Proficiency Levels"
            icon={Info}
            titleSize="sm"
            contentClassName="space-y-2"
          >
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
                    <span className={`text-xs font-bold ${meta.text}`}>{meta.shortLabel}</span>
                  )}
                </div>
                <div>
                  <span className="text-sm font-medium text-text">
                    {i} — {meta.label}
                  </span>
                  {i === 0 && (
                    <span className="text-xs text-sub ml-2">(click a cell to start)</span>
                  )}
                </div>
              </div>
            ))}
          </SectionCard>

          {/* Risk summary */}
          <SectionCard
            title="Risk Analysis"
            icon={AlertTriangle}
            titleSize="sm"
            contentClassName="space-y-3"
          >
            {analysis.filter((a) => a.isSPOF || a.isBusFactor).length === 0 ? (
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
                      className="flex items-start gap-2 p-2 rounded-lg bg-danger/5 border border-danger/20"
                    >
                      <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-danger">{skill.name}</p>
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
                      className="flex items-start gap-2 p-2 rounded-lg bg-warning/5 border border-warning/20"
                    >
                      <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-warning">{skill.name}</p>
                        <p className="text-xs text-sub">
                          Bus factor 1 — only one person at Advanced or Expert level.
                        </p>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
