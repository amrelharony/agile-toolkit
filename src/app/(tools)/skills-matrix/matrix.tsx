"use client";

import { useRef, useState, type MouseEvent } from "react";
import { Star, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EditableName } from "@/components/shared/editable-name";
import { ScalePicker } from "@/components/shared/scale-picker";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type {
  SkillProficiency,
  SkillsMatrix,
  SkillsMatrixSkill,
} from "@/lib/stores/workspace-types";
import {
  CAPABLE_LEVEL,
  NOT_RATED,
  PROFICIENCY_STEPS,
  TARGET_LEVELS,
  TARGET_LEVEL_LABEL,
  isTargetLevel,
  proficiencyName,
  ratingOf,
  type SkillColumn,
  type SkillCoverage,
  type SkillTargetLevel,
} from "@/lib/skills/coverage";

/** Token tints per level: no colour carries meaning alone (each cell names its level). */
const LEVEL_CLASS: Record<SkillProficiency, string> = {
  0: "border-border bg-card text-sub",
  1: "border-accent/20 bg-accent/5 text-text",
  2: "border-accent/30 bg-accent/15 text-text",
  3: "border-accent/50 bg-accent/25 text-text",
  4: "border-accent bg-accent/40 text-text font-semibold",
};

const SCALE = PROFICIENCY_STEPS.map((s) => ({ value: s.value, name: s.name, meaning: s.meaning }));

/**
 * One rating: a button naming the level ("Not rated" until someone picks
 * one) that opens the five levels with their meanings. It replaced
 * click-to-cycle, where Expert back to Advanced took four clicks and
 * "never rated" looked the same as None.
 *
 * Inside the picker the arrow keys only move the choice (the radio group
 * selects as focus moves); a click, Enter or Space on a level saves it,
 * once. Saving on every arrow press wrote Beginner and Intermediate on the
 * way to Advanced, each one logged and announced: click-cycling again, for
 * keyboard users.
 */
function RatingCell({
  skill,
  column,
  level,
  listed,
  onPick,
}: {
  skill: string;
  column: SkillColumn;
  level: SkillProficiency | null;
  /** The person lists this skill on the Team page. */
  listed: boolean;
  onPick: (level: SkillProficiency | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<SkillProficiency | null>(level);
  // The click that saves runs in the same event as the change that set the
  // choice, before a re-render, so it reads the choice from here.
  const choiceRef = useRef<SkillProficiency | null>(level);
  const label = `${skill} · ${column.name}`;
  const choose = (next: SkillProficiency | null) => {
    choiceRef.current = next;
    setChoice(next);
  };
  const pick = (next: SkillProficiency | null) => {
    if (next !== level) onPick(next);
    setOpen(false);
  };
  // Enter and Space on a level arrive here as clicks too; arrows never do.
  const saveOnActivate = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[role="radio"]')) pick(choiceRef.current);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) choose(level);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${proficiencyName(level)}. Change rating`}
          className={cn(
            "min-touch-coarse flex h-10 w-full flex-col items-center justify-center rounded border px-1 text-xs transition-colors hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            level === null
              ? "border-dashed border-border bg-transparent text-sub"
              : LEVEL_CLASS[level]
          )}
        >
          <span className="flex items-center gap-0.5">
            {level === 4 && <Star className="h-3 w-3 fill-current" aria-hidden="true" />}
            {proficiencyName(level)}
          </span>
          {level === null && listed && <span className="text-sub">listed on Team page</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="center" onClick={saveOnActivate}>
        <ScalePicker
          label={label}
          steps={SCALE}
          value={choice}
          size="sm"
          optionsClassName="grid grid-cols-1"
          onValueChange={(v) => choose(v as SkillProficiency)}
          onClear={() => pick(null)}
          hint={
            <>
              {choice === null ? `${NOT_RATED} yet.` : PROFICIENCY_STEPS[choice]?.meaning}
              <span className="mt-0.5 block">Arrow keys choose; Enter or a click saves.</span>
            </>
          }
        />
      </PopoverContent>
    </Popover>
  );
}

const SELECT_CLASS =
  "h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** "2 at Intermediate or above (Ana, Bo)", with what's left to rate. */
function coverageLine(c: SkillCoverage): string {
  if (c.notRatedYet) return "Nobody rated yet";
  const who = c.capable > 0 ? ` (${c.holders.join(", ")})` : "";
  const soFar = c.unrated > 0 ? `, so far (${c.unrated} not rated)` : "";
  return `${c.capable} at Intermediate or above${who}${soFar}`;
}

/** The status badges, in words: never colour alone. */
function Flags({ c }: { c: SkillCoverage }) {
  return (
    <div className="flex flex-wrap gap-1">
      {c.notRatedYet && (
        <Badge variant="outline" className="border-border text-sub">
          Not rated yet
        </Badge>
      )}
      {c.gap && (
        <Badge variant="outline" className="border-danger/50 bg-danger/10 text-danger">
          Gap: nobody at Intermediate+
        </Badge>
      )}
      {c.spof && (
        <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
          Single point of failure: {c.holders[0]}
        </Badge>
      )}
      {c.meetsTarget === false && (
        <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
          Below target {c.atTarget}/{c.target}
        </Badge>
      )}
      {c.meetsTarget === true && (
        <Badge variant="outline" className="border-success/50 bg-success/10 text-success">
          At target {c.atTarget}/{c.target}
        </Badge>
      )}
    </div>
  );
}

export interface MatrixHandlers {
  onRate: (skillId: string, column: SkillColumn, level: SkillProficiency | null) => void;
  onRename: (skillId: string, name: string) => void;
  onTarget: (skillId: string, people: number | null, level: SkillTargetLevel | null) => void;
  onRemoveSkill: (skillId: string) => void;
  onAddToTeam: (column: SkillColumn) => void;
  onRemoveColumn: (column: SkillColumn) => void;
}

/** A skill's name, coverage, flags and target: the grid's row header, or a card's top. */
function SkillDetails({
  skill,
  c,
  teamSize,
  handlers,
}: {
  skill: SkillsMatrixSkill;
  c: SkillCoverage;
  teamSize: number;
  handlers: MatrixHandlers;
}) {
  const level = isTargetLevel(skill.targetLevel) ? skill.targetLevel : 2;
  const people = skill.targetPeople ?? null;
  const most = Math.max(teamSize, people ?? 0);
  return (
    <>
      <div className="flex items-start gap-1">
        <EditableName
          value={skill.name}
          onChange={(n) => handlers.onRename(skill.id, n)}
          ariaLabel={`Rename ${skill.name}`}
          className="min-w-0 flex-1 text-sm font-medium text-text"
        />
        <IconButton
          label={`Delete ${skill.name}`}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          className="h-7 w-7 shrink-0 text-sub hover:text-danger"
          onClick={() => handlers.onRemoveSkill(skill.id)}
        />
      </div>
      {skill.description && <p className="mt-0.5 text-xs text-sub">{skill.description}</p>}
      <p className="mt-1 text-xs text-sub">{coverageLine(c)}</p>
      <div className="mt-1">
        <Flags c={c} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-sub">
        <select
          aria-label={`Target people for ${skill.name}`}
          className={SELECT_CLASS}
          value={people === null ? "" : String(people)}
          onChange={(e) =>
            handlers.onTarget(
              skill.id,
              e.target.value === "" ? null : Number(e.target.value),
              skill.targetLevel ?? null
            )
          }
        >
          <option value="">No target</option>
          {Array.from({ length: most }, (_, i) => i + 1).map((n) => (
            <option key={n} value={String(n)}>
              Target {n}
            </option>
          ))}
        </select>
        <select
          aria-label={`Target level for ${skill.name}`}
          className={SELECT_CLASS}
          value={String(level)}
          disabled={people === null}
          onChange={(e) =>
            handlers.onTarget(skill.id, people, Number(e.target.value) as SkillTargetLevel)
          }
        >
          {TARGET_LEVELS.map((l) => (
            <option key={l} value={String(l)}>
              {TARGET_LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** "Not on the team", with "Add to the team" and remove, for a matrix-only person. */
function OffTeamActions({
  col,
  preview,
  handlers,
}: {
  col: SkillColumn;
  preview: boolean;
  handlers: MatrixHandlers;
}) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs font-normal text-sub">
      Not on the team
      {!preview && (
        <button
          type="button"
          onClick={() => handlers.onAddToTeam(col)}
          className="min-touch-coarse inline-flex items-center gap-1 rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Add to the team
        </button>
      )}
      <IconButton
        label={`Remove ${col.name} from the matrix`}
        icon={<Trash2 className="h-3.5 w-3.5" />}
        className="h-7 w-7 text-sub hover:text-danger"
        onClick={() => handlers.onRemoveColumn(col)}
      />
    </span>
  );
}

const flagBorder = (c: SkillCoverage) =>
  c.gap ? "border-danger/50" : c.spof ? "border-warning/50" : "border-border";

interface GridProps {
  doc: SkillsMatrix;
  columns: readonly SkillColumn[];
  coverage: readonly SkillCoverage[];
  preview: boolean;
  handlers: MatrixHandlers;
}

/**
 * The matrix: a row per skill and a column per person, or on a phone a
 * card per skill with each person's level under it. The pinned skill
 * column of the grid (name, coverage, flags and targets) took most of a
 * 375 px screen, leaving no person's column fully in view beside it.
 */
export function SkillsGrid(props: GridProps) {
  const mobile = useIsMobile();
  return mobile ? <SkillCards {...props} /> : <SkillsTable {...props} />;
}

/**
 * The grid. It scrolls sideways inside its own box (position: relative, so
 * nothing in it can widen the page) with the skill column pinned.
 */
function SkillsTable({ doc, columns, coverage, preview, handlers }: GridProps) {
  const bySkill = new Map(coverage.map((c) => [c.skillId, c]));
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Skills by person. Each cell opens the five levels; Not rated never counts.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[13rem] border-b border-r border-border bg-surface-deep p-2 text-left text-xs font-medium uppercase tracking-wider text-sub"
            >
              Skill
            </th>
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className="min-w-[7.5rem] border-b border-border bg-surface-deep p-2 text-left align-top"
              >
                <span className="block text-xs font-semibold text-text">{col.name}</span>
                {!col.onRoster && (
                  <OffTeamActions col={col} preview={preview} handlers={handlers} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.skills.map((skill) => {
            const c = bySkill.get(skill.id);
            if (!c) return null;
            return (
              <tr key={skill.id} className="border-b border-border last:border-0">
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-r bg-surface-deep p-2 text-left align-top font-normal",
                    flagBorder(c)
                  )}
                >
                  <SkillDetails skill={skill} c={c} teamSize={columns.length} handlers={handlers} />
                </th>
                {columns.map((col) => (
                  <td key={col.id} className="p-1.5 align-top">
                    <RatingCell
                      skill={skill.name}
                      column={col}
                      level={ratingOf(doc, skill.id, col)}
                      listed={c.listedBy.includes(col.id)}
                      onPick={(next) => handlers.onRate(skill.id, col, next)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The phone layout: one card per skill, each person's level a row in it. */
function SkillCards({ doc, columns, coverage, preview, handlers }: GridProps) {
  const bySkill = new Map(coverage.map((c) => [c.skillId, c]));
  const offTeam = columns.filter((col) => !col.onRoster);
  return (
    <div className="space-y-3">
      {offTeam.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-border bg-card p-3">
          {offTeam.map((col) => (
            <li key={col.id} className="text-sm">
              <span className="font-medium text-text">{col.name}</span>
              <OffTeamActions col={col} preview={preview} handlers={handlers} />
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-3" aria-label="Skills by person">
        {doc.skills.map((skill) => {
          const c = bySkill.get(skill.id);
          if (!c) return null;
          return (
            <li
              key={skill.id}
              className={cn("rounded-lg border bg-surface-deep p-3", flagBorder(c))}
            >
              <SkillDetails skill={skill} c={c} teamSize={columns.length} handlers={handlers} />
              {columns.length > 0 && (
                <ul className="mt-3 divide-y divide-border border-t border-border">
                  {columns.map((col) => (
                    <li key={col.id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1 break-words text-sm text-text">
                        {col.name}
                        {!col.onRoster && (
                          <span className="block text-xs text-sub">Not on the team</span>
                        )}
                      </span>
                      <div className="w-32 shrink-0">
                        <RatingCell
                          skill={skill.name}
                          column={col}
                          level={ratingOf(doc, skill.id, col)}
                          listed={c.listedBy.includes(col.id)}
                          onPick={(next) => handlers.onRate(skill.id, col, next)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The five levels and what each means, under the grid. */
export function LevelLegend() {
  return (
    <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
      {PROFICIENCY_STEPS.map((s) => (
        <div key={s.value} className="flex items-start gap-2">
          <dt className="w-28 shrink-0 font-medium text-text">
            {s.value} {s.name}
          </dt>
          <dd className="text-sub">
            {s.meaning}
            {s.value === CAPABLE_LEVEL && " Counts as capable."}
          </dd>
        </div>
      ))}
      <div className="flex items-start gap-2">
        <dt className="w-28 shrink-0 font-medium text-text">{NOT_RATED}</dt>
        <dd className="text-sub">Nobody has rated it yet. It never counts, unlike None.</dd>
      </div>
    </dl>
  );
}
