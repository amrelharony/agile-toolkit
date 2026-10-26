"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  CheckCircle2,
  Grid3X3,
  Plus,
  Scale,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { generateRACIPrompts } from "@/lib/ai-prompts/raci";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RACI_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  RaciActivity,
  RaciLetter,
  RaciMatrix,
  RaciRole,
  Workspace,
} from "@/lib/stores/workspace-types";
import { findRosterMember } from "@/lib/team/names";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  RACI_ID,
  RACI_LETTERS,
  RACI_LETTER_NAME,
  RACI_LOAD,
  activityIssues,
  cellOf,
  cellText,
  cellWords,
  countsByRole,
  emptyRaci,
  hasAssignments,
  loadWarnings,
  nameTaken,
  normalizeRaci,
  raciVerdict,
  removedActivity,
  removedRole,
  restoreActivity,
  restoreRole,
  unassignedActivities,
  withActivity,
  withCell,
  withRole,
  withoutActivity,
  withoutRole,
  type RoleCounts,
} from "@/lib/raci/model";
import { AddActivityForm, AddColumnForm } from "./add-forms";
import { LETTER_CLASS } from "./cell-chips";
import { buildExample, type RaciExample } from "./example";
import type { NameValues } from "./form";
import { raciMarkdown } from "./markdown";
import { RaciMatrixView } from "./matrix";
import { useLegacyRaciMove } from "./migrate";
import { cn } from "@/lib/utils";

export const TOOL_ID = "raci";

/** A change to the matrix, applied to the document as it is when it runs. */
type DocUpdate = (doc: RaciMatrix) => RaciMatrix;

/** Writes the workspace's matrix, read fresh from the store (never a render's copy). */
function writeStore(update: DocUpdate) {
  const { raciMatrices, upsertRaciMatrix } = useWorkspaceStore.getState();
  const current = normalizeRaci((raciMatrices ?? []).find((d) => d.id === RACI_ID));
  upsertRaciMatrix({ ...update(current), id: RACI_ID });
}

const noLog = () => undefined;

/** `row` with a description set, or without one for a blank. */
function described<T extends { description?: string }>(row: T, description: string): T {
  const next = { ...row };
  if (description.trim()) next.description = description.trim();
  else delete next.description;
  return next;
}

/** The Scrum roles and ceremonies a team can start from (an explicit choice, with Undo). */
const SCRUM_ROLES = ["Product Owner", "Scrum Master", "Dev Team"];
const SCRUM_ACTIVITIES = [
  "Backlog refinement",
  "Sprint planning",
  "Daily standup",
  "Sprint review",
];

/**
 * The RACI matrix: who is Responsible, Accountable, Consulted or Informed
 * for each activity. Columns are people from the roster or group roles;
 * a cell can hold A and R together; the checks name each activity without
 * one Accountable or anyone Responsible, and where the load piles up. It
 * is a workspace document, so it syncs and agents can read and write it.
 */
export function RACIClient() {
  const hydrated = useWorkspaceHydrated();
  const moving = useLegacyRaciMove();
  const stored = useWorkspaceStore(
    useShallow((s) => (s.raciMatrices ?? []).find((d) => d.id === RACI_ID))
  );
  const workspaceRoster = useTeamRoster();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const resetSnapshot = useRef<RaciMatrix | null>(null);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<RaciExample | null>(null);
  const preview = example !== null;
  const doc = useMemo(() => normalizeRaci(example?.doc ?? stored), [example, stored]);
  const roster = example?.roster ?? workspaceRoster;

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const write: (update: DocUpdate) => void = preview
    ? (update) => setExample((ex) => (ex ? { ...ex, doc: update(normalizeRaci(ex.doc)) } : ex))
    : writeStore;
  const record: typeof log = preview ? noLog : log;
  const newId = (kind: "role" | "act") =>
    preview ? exampleId(`raci-${kind}-${nanoid(6)}`) : `raci_${kind}_${nanoid(8)}`;

  /* ── Numbers ──────────────────────────────────────────────────────── */

  const assigned = hasAssignments(doc);
  const issues = activityIssues(doc);
  const warnings = loadWarnings(doc);
  const unassigned = unassignedActivities(doc);
  const flagged = new Set(issues.map((i) => i.activityId));
  const verdict = raciVerdict(doc);
  const counts = countsByRole(doc);
  const markdown = raciMarkdown(doc, roster, { verdict });
  const onTeam = (memberId: string) => roster.some((m) => m.id === memberId);
  const missingFromMatrix = roster.filter(
    (m) => !doc.roles.some((r) => r.memberId === m.id) && !nameTaken(doc.roles, m.name)
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  const addColumn = (v: NameValues) => {
    const member = findRosterMember(roster, v.name);
    const role: RaciRole = {
      id: newId("role"),
      name: member?.name ?? v.name,
      ...(member ? { memberId: member.id } : {}),
      ...(v.description ? { description: v.description } : {}),
    };
    write((d) => withRole(d, role));
    record(RACI_ACTIONS.ROLE_ADDED, { roleId: role.id, name: role.name, person: Boolean(member) });
    announce(`Added the column ${role.name}`);
  };

  const addEveryone = () => {
    const added: RaciRole[] = missingFromMatrix.map((m) => ({
      id: newId("role"),
      name: m.name,
      memberId: m.id,
    }));
    if (added.length === 0) return;
    const ids = new Set(added.map((r) => r.id));
    undoable({
      label: `Added ${added.length} ${added.length === 1 ? "person" : "people"} as columns`,
      apply: () => write((d) => added.reduce(withRole, d)),
      revert: () => write((d) => Array.from(ids).reduce(withoutRole, d)),
    });
    announce(`Added ${added.map((r) => r.name).join(", ")}`);
  };

  const addActivity = (v: NameValues) => {
    const activity: RaciActivity = {
      id: newId("act"),
      name: v.name,
      ...(v.description ? { description: v.description } : {}),
    };
    write((d) => withActivity(d, activity));
    record(RACI_ACTIONS.ACTIVITY_ADDED, { activityId: activity.id, name: activity.name });
    announce(`Added the activity ${activity.name}`);
  };

  const startFromScrum = () => {
    const roles: RaciRole[] = SCRUM_ROLES.map((name) => ({ id: newId("role"), name }));
    const activities: RaciActivity[] = SCRUM_ACTIVITIES.map((name) => ({
      id: newId("act"),
      name,
    }));
    undoable({
      label: "Added the Scrum roles and events",
      apply: () =>
        write((d) => ({
          ...d,
          roles: [...d.roles, ...roles],
          activities: [...d.activities, ...activities],
        })),
      revert: () =>
        write((d) => {
          let next = d;
          for (const r of roles) next = withoutRole(next, r.id);
          for (const a of activities) next = withoutActivity(next, a.id);
          return next;
        }),
    });
    announce("Added the Scrum roles and events");
  };

  const setCell = (a: RaciActivity, r: RaciRole, letters: RaciLetter[]) => {
    write((d) => withCell(d, a.id, r.id, letters));
    record(RACI_ACTIONS.ASSIGNMENT_CHANGED, {
      activityId: a.id,
      roleId: r.id,
      value: cellText(letters),
    });
    announce(`${a.name}, ${r.name}: ${cellWords(letters)}`);
  };

  const renameRole = (r: RaciRole, name: string) => {
    if (name === r.name) return;
    if (
      nameTaken(
        doc.roles.filter((x) => x.id !== r.id),
        name
      )
    ) {
      toast.error(`“${name}” is already a column.`);
      return;
    }
    // The column follows a roster person by name; a name off the roster makes it a group role.
    const member = findRosterMember(roster, name);
    write((d) => ({
      ...d,
      roles: d.roles.map((x) => {
        if (x.id !== r.id) return x;
        const next: RaciRole = { ...x, name: member?.name ?? name };
        if (member) next.memberId = member.id;
        else delete next.memberId;
        return next;
      }),
    }));
  };

  const renameActivity = (a: RaciActivity, name: string) => {
    if (name === a.name) return;
    if (
      nameTaken(
        doc.activities.filter((x) => x.id !== a.id),
        name
      )
    ) {
      toast.error(`“${name}” is already an activity.`);
      return;
    }
    write((d) => ({
      ...d,
      activities: d.activities.map((x) => (x.id === a.id ? { ...x, name } : x)),
    }));
  };

  const removeRole = (r: RaciRole) => {
    const removed = removedRole(doc, r.id);
    if (!removed) return;
    undoable({
      label: `Deleted the column ${r.name}`,
      apply: () => {
        write((d) => withoutRole(d, r.id));
        record(RACI_ACTIONS.ROLE_REMOVED, { roleId: r.id, name: r.name });
      },
      revert: () => write((d) => restoreRole(d, removed)),
    });
    announce(`Deleted the column ${r.name}`);
  };

  const removeActivity = (a: RaciActivity) => {
    const removed = removedActivity(doc, a.id);
    if (!removed) return;
    undoable({
      label: `Deleted the activity ${a.name}`,
      apply: () => {
        write((d) => withoutActivity(d, a.id));
        record(RACI_ACTIONS.ACTIVITY_REMOVED, { activityId: a.id, name: a.name });
      },
      revert: () => write((d) => restoreActivity(d, removed)),
    });
    announce(`Deleted the activity ${a.name}`);
  };

  /* ── Export and prompts ───────────────────────────────────────────── */

  const csvData = {
    headers: ["Activity", ...doc.roles.map((r) => r.name)],
    rows: doc.activities.map((a) => [
      a.name,
      ...doc.roles.map((r) => cellText(cellOf(doc, a.id, r.id))),
    ]),
  };
  // Keyed by role id (with its name), so two roles with one name can't collide.
  const jsonData = {
    roles: doc.roles.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.memberId ? { memberId: r.memberId } : {}),
      description: r.description ?? "",
    })),
    activities: doc.activities.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? "",
      assignments: Object.fromEntries(doc.roles.map((r) => [r.id, cellOf(doc, a.id, r.id)])),
    })),
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
  const promptConfig = useMemo(
    () => ({
      toolName: "RACI Matrix",
      prompts: generateRACIPrompts(
        {
          roles: doc.roles,
          activities: doc.activities,
          // The prompt reads one string per cell: "A/R" for both.
          matrix: Object.fromEntries(
            doc.activities.map((a) => [
              a.id,
              Object.fromEntries(doc.roles.map((r) => [r.id, cellText(cellOf(doc, a.id, r.id))])),
            ])
          ),
        },
        workspace
      ),
    }),
    [doc, workspace]
  );

  const page = (body: ReactNode) => (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="RACI Matrix Builder"
      description="Who is Responsible, Accountable, Consulted or Informed for each activity, with the team's people as columns and checks on where the load piles up."
      category="Team Health & Maturity"
    >
      {body}
    </ToolPageWrapper>
  );

  if (!hydrated) {
    return page(
      <p
        role="status"
        className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
      >
        Loading the RACI matrix…
      </p>
    );
  }

  const empty = doc.roles.length === 0 && doc.activities.length === 0;

  return page(
    <div className="space-y-6">
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="raci-matrix"
          markdown={markdown}
          clipboardText={markdown}
          csvData={csvData}
          jsonData={jsonData}
          targetRef={exportRef}
        />
      </ActionRow>

      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 text-xs text-sub">
            Example: a product team&apos;s matrix. Nothing in it is saved, and your own matrix stays
            as it is.
          </p>
        </div>
      )}

      {moving && !preview && empty && (
        <p role="status" className="text-sm text-sub">
          Moving the matrix saved in this browser into the workspace…
        </p>
      )}

      {empty && !preview && (
        <EmptyState
          icon={Grid3X3}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" className="gap-1" onClick={startFromScrum}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Start from the Scrum roles
              </Button>
              <LoadExampleButton onLoad={() => setExample(buildExample())} />
            </div>
          }
        >
          No matrix yet. Add the team&apos;s people (or group roles) as columns and the activities
          as rows below, then mark who is Responsible, Accountable, Consulted or Informed for each.
        </EmptyState>
      )}

      {!empty && (
        <div ref={exportRef} className="space-y-4">
          <p className="text-sm font-medium text-text">{verdict}</p>

          <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
            {RACI_LETTERS.map((l) => (
              <li key={l} className="flex items-center gap-2 text-sm text-sub">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded border font-data text-sm font-bold",
                    LETTER_CLASS[l].on
                  )}
                  aria-hidden="true"
                >
                  {l}
                </span>
                {RACI_LETTER_NAME[l]}
              </li>
            ))}
          </ul>

          {assigned && (
            <SectionCard
              title={
                issues.length + warnings.length === 0
                  ? "Checks: all clear"
                  : `Checks: ${issues.length + warnings.length} to look at`
              }
              icon={issues.length > 0 ? AlertTriangle : warnings.length > 0 ? Scale : CheckCircle2}
            >
              {issues.length + warnings.length === 0 ? (
                <p className="text-sm text-success">
                  Every assigned activity has one Accountable and someone Responsible, and no one
                  carries too much.
                </p>
              ) : (
                <ul className="space-y-1.5 text-sm" aria-label="Checks">
                  {issues.map((i) => (
                    <li key={`${i.kind}:${i.activityId}`} className="flex gap-2 text-danger">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{i.message}</span>
                    </li>
                  ))}
                  {warnings.map((w) => (
                    <li
                      key={`${w.kind}:${w.roleId ?? w.activityId}`}
                      className="flex gap-2 text-warning"
                    >
                      <Scale className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{w.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              {unassigned.length > 0 && (
                <p className="mt-2 text-xs text-sub">
                  Not assigned yet: {unassigned.map((a) => a.name).join(", ")}.
                </p>
              )}
              <p className="mt-2 text-xs text-sub">
                Rules of thumb: one Accountable per activity; nobody Accountable for more than{" "}
                {Math.round(RACI_LOAD.maxAccountableShare * 100)}% of{" "}
                {RACI_LOAD.minActivitiesForShare} or more activities; no more than{" "}
                {RACI_LOAD.maxConsulted} roles consulted on one.
              </p>
            </SectionCard>
          )}

          <SectionCard title="RACI matrix" icon={Grid3X3} titleSize="lg">
            {doc.roles.length === 0 || doc.activities.length === 0 ? (
              <p className="text-sm text-sub">
                {doc.roles.length === 0
                  ? "Add a person or role as a column to start assigning."
                  : "Add an activity as a row to start assigning."}
              </p>
            ) : (
              <RaciMatrixView
                doc={doc}
                flagged={flagged}
                onTeam={onTeam}
                onCell={setCell}
                onRenameRole={renameRole}
                onRenameActivity={renameActivity}
                onDescribeRole={(r, d) =>
                  write((x) => ({
                    ...x,
                    roles: x.roles.map((y) => (y.id === r.id ? described(y, d) : y)),
                  }))
                }
                onDescribeActivity={(a, d) =>
                  write((x) => ({
                    ...x,
                    activities: x.activities.map((y) => (y.id === a.id ? described(y, d) : y)),
                  }))
                }
                onRemoveRole={removeRole}
                onRemoveActivity={removeActivity}
              />
            )}
          </SectionCard>

          {assigned && doc.roles.length > 0 && (
            <SectionCard title="Letters per role" icon={Scale}>
              <DataTable<RoleCounts>
                rows={counts}
                rowKey={(c) => c.roleId}
                columns={[
                  { key: "name", header: "Role", cell: (c) => c.name, primary: true },
                  ...RACI_LETTERS.map((l) => ({
                    key: l,
                    header: RACI_LETTER_NAME[l],
                    align: "right" as const,
                    cell: (c: RoleCounts) => c[l],
                    sortValue: (c: RoleCounts) => c[l],
                  })),
                ]}
              />
            </SectionCard>
          )}
        </div>
      )}

      <SectionCard title="Add to the matrix" icon={Plus}>
        <div className="space-y-6">
          <div className="space-y-2">
            <AddColumnForm roles={doc.roles} offerAddToRoster={!preview} onAdd={addColumn} />
            {missingFromMatrix.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={addEveryone}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Add everyone on the team ({missingFromMatrix.length})
              </Button>
            )}
          </div>
          <AddActivityForm activities={doc.activities} onAdd={addActivity} />
        </div>
      </SectionCard>

      {!empty && !preview && (
        <div className="flex justify-end">
          <ResetButton
            label="Clear the matrix"
            title="Clear the whole RACI matrix?"
            description={`All ${doc.roles.length} columns, ${doc.activities.length} activities and what each one is assigned.`}
            confirmLabel="Clear matrix"
            doneLabel="Cleared the RACI matrix"
            onReset={() => {
              resetSnapshot.current = doc;
              writeStore(() => emptyRaci());
              log(RACI_ACTIONS.RACI_RESET, {
                roles: doc.roles.length,
                activities: doc.activities.length,
              });
            }}
            onUndo={() => {
              const snapshot = resetSnapshot.current;
              if (snapshot) writeStore(() => snapshot);
            }}
          />
        </div>
      )}
    </div>
  );
}
