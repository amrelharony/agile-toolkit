"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, GraduationCap, Info, Plus, Sparkles, Target, Users } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { generateSkillsMatrixPrompts } from "@/lib/ai-prompts/skills-matrix";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SKILLS_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  emptySkillsMatrix,
  type SkillProficiency,
  type SkillsMatrix,
  type SkillsTrainingPair,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { addToRoster, useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayIso } from "@/lib/sprints/series";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  SKILLS_MATRIX_ID,
  coverageCounts,
  matrixColumns,
  newSkill,
  newTrainingPair,
  normalizeSkillsMatrix,
  proficiencyName,
  ratingOf,
  realRoster,
  rekeyToRoster,
  restoreColumn,
  restoreSkill,
  rosterSkillsMissing,
  skillCoverage,
  skillNameError,
  skillsVerdict,
  suggestCrossTraining,
  withRating,
  withSkill,
  withSkillPatch,
  withTraining,
  withTrainingPatch,
  withoutColumn,
  withoutSkill,
  withoutTraining,
  type NewSkill,
  type NewTrainingPair,
  type RemovedColumn,
  type RemovedSkill,
  type SkillColumn,
  type SkillTargetLevel,
  type TrainingSuggestion,
} from "@/lib/skills/coverage";
import { buildExample, type SkillsExample } from "./example";
import { skillsToMarkdown } from "./markdown";
import { LevelLegend, SkillsGrid } from "./matrix";
import { SkillForm } from "./skill-form";
import { TrainingPlan } from "./training";

export const TOOL_ID = "skills-matrix";

/** A change to the matrix, given it and its columns as they are now. */
type MatrixUpdate = (doc: SkillsMatrix, columns: SkillColumn[]) => SkillsMatrix;

/** The stored matrix as the page reads it, with its columns from the real roster. */
function storedState() {
  const { skillsMatrices, teamMembers } = useWorkspaceStore.getState();
  const doc = normalizeSkillsMatrix(
    (skillsMatrices ?? []).find((d) => d.id === SKILLS_MATRIX_ID),
    SKILLS_MATRIX_ID
  );
  return { doc, columns: matrixColumns(doc, realRoster(teamMembers)) };
}

/**
 * Writes to the workspace the way tool.skills_matrix.* does: from the
 * latest stored doc (upgraded: an older doc's 0s were Not rated), with
 * people matched to the roster by name moved onto their roster ids first,
 * so the change lands on the cells the page shows.
 */
function writeStore(update: MatrixUpdate) {
  const { doc, columns } = storedState();
  const next = update(rekeyToRoster(doc, columns), columns);
  useWorkspaceStore.getState().upsertSkillsMatrix({ ...next, id: SKILLS_MATRIX_ID, version: 2 });
}

/** A pair put back where it was in the plan (its Undo after a delete). */
function insertPair(doc: SkillsMatrix, pair: SkillsTrainingPair, index: number): SkillsMatrix {
  const training = (doc.training ?? []).filter((p) => p.id !== pair.id);
  training.splice(Math.min(index, training.length), 0, pair);
  return { ...doc, training };
}

export function SkillsMatrixClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Team Skills Matrix"
      description="Rate each person on the team in the skills it depends on, find the skills nobody can do or only one person can, and plan who learns what."
      category="Team Health & Maturity"
    >
      <SkillsMatrixTool />
    </ToolPageWrapper>
  );
}

/**
 * The Skills Matrix: the Team page roster as columns, a level picker per
 * cell (Not rated until someone picks), gaps and single points of failure
 * by the shared rule (lib/skills/coverage), targets per skill and a
 * cross-training plan. The example lives in this page's memory only.
 */
export function SkillsMatrixTool() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) =>
    (s.skillsMatrices ?? []).find((d) => d.id === SKILLS_MATRIX_ID)
  );
  const rosterAll = useTeamRoster();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<SkillsExample | null>(null);
  const preview = example !== null;
  const roster = useMemo(() => example?.roster ?? realRoster(rosterAll), [example, rosterAll]);
  const doc = useMemo(
    () => example?.doc ?? normalizeSkillsMatrix(stored, SKILLS_MATRIX_ID),
    [example, stored]
  );
  const columns = useMemo(() => matrixColumns(doc, roster), [doc, roster]);
  const coverage = useMemo(() => skillCoverage(doc, columns, roster), [doc, columns, roster]);
  const suggestions = useMemo(
    () => suggestCrossTraining(doc, columns, coverage),
    [doc, columns, coverage]
  );
  const counts = coverageCounts(coverage);
  const verdict = skillsVerdict(coverage, columns);
  const missingSkills = rosterSkillsMissing(doc, roster);
  const anyRated = counts.skills * columns.length - counts.unrated > 0;
  const resetBefore = useRef<SkillsMatrix | undefined>(undefined);

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const write = (update: MatrixUpdate) => {
    if (!preview) return writeStore(update);
    setExample((ex) => ex && { ...ex, doc: update(ex.doc, matrixColumns(ex.doc, ex.roster)) });
  };
  const record: typeof log = preview ? () => undefined : log;
  const skillName = (id: string) => doc.skills.find((s) => s.id === id)?.name ?? "the skill";
  const personName = (id: string | undefined) =>
    columns.find((c) => c.id === id)?.name ?? "Someone";

  /* ── Skills ──────────────────────────────────────────────────────── */

  const addSkill = (values: NewSkill) => {
    const skill = newSkill(values, crypto.randomUUID());
    write((d) => withSkill(d, skill));
    record(SKILLS_ACTIONS.SKILL_ADDED, { skillId: skill.id, name: skill.name });
    announce(`Added ${skill.name}`);
  };

  const addListedSkills = (names: readonly string[]) => {
    const skills = names.map((name) => newSkill({ name }, crypto.randomUUID()));
    undoable({
      label:
        skills.length === 1
          ? `Added “${skills[0].name}”`
          : `Added ${skills.length} skills from the Team page`,
      apply: () => {
        write((d) => skills.reduce((acc, s) => withSkill(acc, s), d));
        for (const s of skills) record(SKILLS_ACTIONS.SKILL_ADDED, { skillId: s.id, name: s.name });
      },
      revert: () => write((d) => skills.reduce((acc, s) => withoutSkill(acc, s.id)?.doc ?? acc, d)),
    });
    announce(`Added ${skills.map((s) => s.name).join(", ")}`);
  };

  const rename = (skillId: string, name: string) => {
    const error = skillNameError(name, doc, skillId);
    if (error) {
      toast.error(error);
      announce(error, "assertive");
      return;
    }
    write((d) => withSkillPatch(d, skillId, { name }));
  };

  const setTarget = (skillId: string, people: number | null, level: SkillTargetLevel | null) => {
    write((d) => withSkillPatch(d, skillId, { targetPeople: people, targetLevel: level }));
    announce(
      people === null
        ? `No target for ${skillName(skillId)}`
        : `Target for ${skillName(skillId)}: ${people} at ${proficiencyName(level ?? 2)} or above`
    );
  };

  const removeSkill = (skillId: string) => {
    const name = skillName(skillId);
    let removed: RemovedSkill | null = null;
    undoable({
      label: `Deleted “${name}”`,
      apply: () => {
        write((d) => {
          const out = withoutSkill(d, skillId);
          if (!out) return d;
          removed = out.removed;
          return out.doc;
        });
        record(SKILLS_ACTIONS.SKILL_REMOVED, { skillId, name });
      },
      revert: () => {
        const back = removed;
        if (back) write((d) => restoreSkill(d, back));
      },
    });
    announce(`Deleted ${name}`);
  };

  /* ── Ratings and people ──────────────────────────────────────────── */

  const rate = (skillId: string, column: SkillColumn, level: SkillProficiency | null) => {
    write((d) => withRating(d, skillId, column.id, level));
    record(SKILLS_ACTIONS.RATING_CHANGED, { skillId, memberId: column.id, rating: level });
    announce(`${skillName(skillId)}, ${column.name}: ${proficiencyName(level)}`);
  };

  const addToTeam = (column: SkillColumn) => {
    const member = addToRoster(column.name);
    record(SKILLS_ACTIONS.PERSON_ADDED, { memberId: member.id, name: member.name });
    announce(`Added ${member.name} to the team`);
  };

  const removeColumn = (column: SkillColumn) => {
    let removed: RemovedColumn | null = null;
    undoable({
      label: `Removed ${column.name} from the matrix`,
      apply: () => {
        write((d) => {
          const out = withoutColumn(d, column.id);
          if (!out) return d;
          removed = out.removed;
          return out.doc;
        });
        record(SKILLS_ACTIONS.PERSON_REMOVED, { memberId: column.id, name: column.name });
      },
      revert: () => {
        const back = removed;
        if (back) write((d) => restoreColumn(d, back));
      },
    });
    announce(`Removed ${column.name} from the matrix`);
  };

  /* ── Training ────────────────────────────────────────────────────── */

  const addPair = (values: NewTrainingPair, label: string) => {
    const pair = newTrainingPair(
      values,
      `training_${crypto.randomUUID()}`,
      new Date().toISOString()
    );
    undoable({
      label,
      apply: () => write((d) => withTraining(d, pair)),
      revert: () => write((d) => withoutTraining(d, pair.id)),
    });
    announce(label);
  };

  const addSuggestion = (s: TrainingSuggestion) =>
    addPair(
      { skillId: s.skillId, learnerId: s.learnerId, mentorId: s.mentorId, toLevel: s.toLevel },
      `Planned: ${personName(s.learnerId)} learns ${skillName(s.skillId)}`
    );

  const setDone = (pair: SkillsTrainingPair, done: boolean) => {
    const before = pair.doneAt ?? null;
    const what = `${personName(pair.learnerId)} learns ${skillName(pair.skillId)}`;
    undoable({
      label: done ? `Done: ${what}` : `Reopened: ${what}`,
      apply: () => write((d) => withTrainingPatch(d, pair.id, { doneAt: done ? today : null })),
      revert: () => write((d) => withTrainingPatch(d, pair.id, { doneAt: before })),
    });
    announce(done ? `Marked done: ${what}` : `Reopened: ${what}`);
  };

  // Done stamps today; a pair finished last Friday is moved back here.
  const setDoneDay = (pair: SkillsTrainingPair, day: string) => {
    write((d) => withTrainingPatch(d, pair.id, { doneAt: day }));
    announce(`${personName(pair.learnerId)} learns ${skillName(pair.skillId)}: done on ${day}`);
  };

  const setDue = (pair: SkillsTrainingPair, due: string) =>
    write((d) => withTrainingPatch(d, pair.id, { due: due || null }));

  const removePair = (pair: SkillsTrainingPair) => {
    const index = (doc.training ?? []).findIndex((p) => p.id === pair.id);
    const what = `${personName(pair.learnerId)} learns ${skillName(pair.skillId)}`;
    undoable({
      label: `Deleted the pair: ${what}`,
      apply: () => write((d) => withoutTraining(d, pair.id)),
      revert: () => write((d) => insertPair(d, pair, index)),
    });
    announce(`Deleted the pair: ${what}`);
  };

  /* ── Reset and the example ───────────────────────────────────────── */

  const reset = () => {
    const { skillsMatrices, upsertSkillsMatrix } = useWorkspaceStore.getState();
    resetBefore.current = (skillsMatrices ?? []).find((d) => d.id === SKILLS_MATRIX_ID);
    upsertSkillsMatrix(emptySkillsMatrix(SKILLS_MATRIX_ID));
    log(SKILLS_ACTIONS.SKILLS_RESET, {});
    announce("Reset the skills matrix");
  };
  const undoReset = () => {
    const before = resetBefore.current;
    if (before) useWorkspaceStore.getState().upsertSkillsMatrix(before);
  };

  const loadExample = () => setExample(buildExample());
  const clearExample = () => setExample(null);

  /* ── Exports and prompts ─────────────────────────────────────────── */

  const markdown = skillsToMarkdown({ doc, columns, coverage, suggestions, verdict });
  const csvData = {
    headers: ["Skill", "Description", ...columns.map((c) => c.name)],
    rows: doc.skills.map((s) => [
      s.name,
      s.description ?? "",
      ...columns.map((c) => proficiencyName(ratingOf(doc, s.id, c))),
    ]),
  };
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
  const promptConfig = useMemo(() => {
    // Rated cells only, under the column ids the page shows.
    const grid: Record<string, Record<string, number>> = {};
    for (const s of doc.skills) {
      grid[s.id] = {};
      for (const c of columns) {
        const level = ratingOf(doc, s.id, c);
        if (level !== null) grid[s.id][c.id] = level;
      }
    }
    return {
      toolName: "Skills Matrix",
      prompts: generateSkillsMatrixPrompts(
        { members: columns.map((c) => ({ id: c.id, name: c.name })), skills: doc.skills, grid },
        workspace
      ),
    };
  }, [doc, columns, workspace]);

  if (!hydrated) {
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
      >
        Loading the skills matrix…
      </p>
    );
  }

  const storedHasData =
    !!stored &&
    (stored.skills?.length > 0 || stored.members?.length > 0 || (stored.training?.length ?? 0) > 0);
  const dash = !anyRated;
  // Skills with a target that someone is rated in: only they meet it or miss it.
  const judged = counts.atTarget + counts.belowTarget;

  return (
    <div className="space-y-6">
      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 text-xs text-sub">
            Example: a checkout team of four. Nothing in it is saved, and your own matrix and team
            stay as they are.
          </p>
        </div>
      )}

      {!preview && roster.length === 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-4 py-2.5 text-sm text-text"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <span>
            The matrix rates the people on your team.{" "}
            <Link href="/team" className="font-medium text-accent hover:underline">
              Add your team on the Team page
            </Link>{" "}
            to give each person a column.
          </span>
        </p>
      )}

      <SectionCard title="Add a skill" icon={Plus}>
        {missingSkills.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-sub">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span>
              {missingSkills.length === 1
                ? "1 skill is listed on the Team page but not here:"
                : `${missingSkills.length} skills are listed on the Team page but not here:`}{" "}
              {missingSkills.join(", ")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addListedSkills(missingSkills)}
            >
              {missingSkills.length === 1 ? "Add it" : `Add all ${missingSkills.length}`}
            </Button>
          </div>
        )}
        <SkillForm doc={doc} teamSize={columns.length} onAdd={addSkill} />
      </SectionCard>

      {doc.skills.length === 0 ? (
        <EmptyState
          icon={Users}
          action={!preview ? <LoadExampleButton onLoad={loadExample} /> : undefined}
        >
          No skills yet. Add the skills your team depends on above, then rate each person. The
          matrix shows which skills nobody can do and which hang on one person.
        </EmptyState>
      ) : (
        <>
          <p className="text-sm font-medium text-text">{verdict}</p>
          <KpiGrid cols={4} gap="lg">
            <StatCard
              variant="compact"
              icon={Target}
              label="Skills at target"
              value={judged > 0 ? `${counts.atTarget}/${judged}` : "—"}
              hint={
                counts.withTarget === 0
                  ? "No targets set"
                  : judged < counts.withTarget
                    ? `${counts.withTarget - judged} with a target not rated yet`
                    : undefined
              }
            />
            <StatCard
              variant="compact"
              icon={AlertTriangle}
              label="Single points of failure"
              value={dash ? "—" : counts.spofs}
              tone={!dash && counts.spofs > 0 ? "warning" : "default"}
            />
            <StatCard
              variant="compact"
              icon={AlertTriangle}
              label="Gaps"
              value={dash ? "—" : counts.gaps}
              tone={!dash && counts.gaps > 0 ? "danger" : "default"}
            />
            <StatCard
              variant="compact"
              icon={Users}
              label="Ratings missing"
              value={columns.length > 0 ? counts.unrated : "—"}
            />
          </KpiGrid>

          <ActionRow>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="team-skills-matrix"
              markdown={markdown}
              clipboardText={markdown}
              csvData={csvData}
            />
            {!preview && (
              <ResetButton
                title="Reset the skills matrix?"
                description="Every skill, rating and training pair goes. The people on the Team page stay."
                confirmLabel="Reset matrix"
                doneLabel="Reset the skills matrix"
                disabled={!storedHasData}
                onReset={reset}
                onUndo={undoReset}
              />
            )}
          </ActionRow>

          <SectionCard title="Skills grid" icon={Users} titleSize="lg">
            <SkillsGrid
              doc={doc}
              columns={columns}
              coverage={coverage}
              preview={preview}
              handlers={{
                onRate: rate,
                onRename: rename,
                onTarget: setTarget,
                onRemoveSkill: removeSkill,
                onAddToTeam: addToTeam,
                onRemoveColumn: removeColumn,
              }}
            />
            <details className="mt-4 rounded-lg border border-border bg-card px-4 py-2">
              <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium text-text">
                What the levels mean
              </summary>
              <div className="pt-2">
                <LevelLegend />
              </div>
            </details>
          </SectionCard>

          <SectionCard title="Cross-training plan" icon={GraduationCap} titleSize="lg">
            <TrainingPlan
              doc={doc}
              columns={columns}
              coverage={coverage}
              suggestions={suggestions}
              today={today}
              preview={preview}
              handlers={{
                onAddSuggestion: addSuggestion,
                onAdd: (values) =>
                  addPair(
                    values,
                    `Planned: ${personName(values.learnerId)} learns ${skillName(values.skillId)}`
                  ),
                onDone: setDone,
                onDoneDay: setDoneDay,
                onDue: setDue,
                onRemove: removePair,
              }}
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
