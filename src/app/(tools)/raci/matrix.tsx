"use client";

import { Trash2, User, Users } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { BlurInput } from "@/components/shared/blur-fields";
import { EditableName } from "@/components/shared/editable-name";
import type { RaciActivity, RaciLetter, RaciMatrix, RaciRole } from "@/lib/stores/workspace-types";
import { RACI_DESCRIPTION_MAX, cellOf } from "@/lib/raci/model";
import { cn } from "@/lib/utils";
import { CellChips } from "./cell-chips";

export interface MatrixHandlers {
  onCell: (activity: RaciActivity, role: RaciRole, letters: RaciLetter[]) => void;
  onRenameRole: (role: RaciRole, name: string) => void;
  onRenameActivity: (activity: RaciActivity, name: string) => void;
  onDescribeRole: (role: RaciRole, description: string) => void;
  onDescribeActivity: (activity: RaciActivity, description: string) => void;
  onRemoveRole: (role: RaciRole) => void;
  onRemoveActivity: (activity: RaciActivity) => void;
}

interface MatrixProps extends MatrixHandlers {
  doc: RaciMatrix;
  /** Activities with an issue, outlined in the danger colour. */
  flagged: ReadonlySet<string>;
  /** Whether a column's person is still on the team. */
  onTeam: (memberId: string) => boolean;
}

/** "Person · on the team", "Group role", or a person who has left the roster. */
function RoleKind({ role, onTeam }: { role: RaciRole; onTeam: (memberId: string) => boolean }) {
  if (!role.memberId) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-sub">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Group role
      </span>
    );
  }
  const here = onTeam(role.memberId);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", here ? "text-sub" : "text-warning")}
    >
      <User className="h-3.5 w-3.5" aria-hidden="true" />
      {here ? "On the team" : "No longer on the team"}
    </span>
  );
}

/**
 * The matrix: a table from md up (columns are people or roles, rows the
 * activities, each cell four chips), and on a phone one card per activity
 * with a row per role, so nothing scrolls sideways. Names are edited in
 * place (an emptied name reverts), descriptions on blur, and a row or
 * column is deleted with Undo.
 */
export function RaciMatrixView({ doc, flagged, onTeam, ...h }: MatrixProps) {
  const { roles, activities } = doc;
  return (
    <>
      {/* ── Phone: a card per activity ─────────────────────────────── */}
      <div className="space-y-3 md:hidden">
        <ul className="space-y-3" aria-label="Activities">
          {activities.map((a) => (
            <li
              key={a.id}
              className={cn(
                "space-y-2 rounded-lg border bg-surface-deep p-3",
                flagged.has(a.id) ? "border-danger/50" : "border-border"
              )}
            >
              <div className="flex items-center gap-2">
                <EditableName
                  value={a.name}
                  onChange={(name) => h.onRenameActivity(a, name)}
                  className="min-w-0 flex-1 font-medium text-text"
                  ariaLabel={`Rename activity ${a.name}`}
                />
                <IconButton
                  label={`Delete activity ${a.name}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  className="h-9 w-9 shrink-0 text-sub hover:text-danger"
                  onClick={() => h.onRemoveActivity(a)}
                />
              </div>
              <BlurInput
                value={a.description ?? ""}
                onCommit={(d) => h.onDescribeActivity(a, d)}
                placeholder="Description (optional)"
                maxLength={RACI_DESCRIPTION_MAX}
                className="h-8 text-xs"
                aria-label={`Description of activity ${a.name}`}
              />
              <ul className="space-y-1.5" aria-label={`Roles for ${a.name}`}>
                {roles.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                  >
                    <span className="min-w-0 truncate text-xs font-medium text-text">{r.name}</span>
                    <CellChips
                      letters={cellOf(doc, a.id, r.id)}
                      label={`${a.name}, ${r.name}`}
                      onChange={(l) => h.onCell(a, r, l)}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {roles.length > 0 && (
          <details className="rounded-lg border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm text-text">
              Columns ({roles.length})
            </summary>
            <ul className="space-y-2 border-t border-border p-3">
              {roles.map((r) => (
                <li key={r.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <EditableName
                      value={r.name}
                      onChange={(name) => h.onRenameRole(r, name)}
                      className="min-w-0 flex-1 font-medium text-text"
                      ariaLabel={`Rename role ${r.name}`}
                    />
                    <IconButton
                      label={`Delete role ${r.name}`}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="h-9 w-9 shrink-0 text-sub hover:text-danger"
                      onClick={() => h.onRemoveRole(r)}
                    />
                  </div>
                  <RoleKind role={r} onTeam={onTeam} />
                  <BlurInput
                    value={r.description ?? ""}
                    onCommit={(d) => h.onDescribeRole(r, d)}
                    placeholder="Description (optional)"
                    maxLength={RACI_DESCRIPTION_MAX}
                    className="h-8 text-xs"
                    aria-label={`Description of role ${r.name}`}
                  />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* ── md and up: the table, scrolling inside its own box ─────── */}
      <div className="table-wrap-responsive relative hidden md:block">
        <table className="w-full min-w-[40rem] border-collapse" aria-label="RACI matrix">
          <thead>
            <tr>
              <th
                scope="col"
                className="min-w-[11rem] border border-border bg-surface-deep p-2 text-left text-xs font-medium uppercase tracking-wider text-sub"
              >
                Activity / Role
              </th>
              {roles.map((r) => (
                <th
                  key={r.id}
                  scope="col"
                  className="min-w-[9.5rem] border border-border bg-surface-deep p-2 text-left align-top"
                >
                  <div className="flex items-center gap-1">
                    <EditableName
                      value={r.name}
                      onChange={(name) => h.onRenameRole(r, name)}
                      className="min-w-0 flex-1 font-bold text-text"
                      ariaLabel={`Rename role ${r.name}`}
                    />
                    <IconButton
                      label={`Delete role ${r.name}`}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      className="h-7 w-7 shrink-0 text-sub hover:text-danger"
                      onClick={() => h.onRemoveRole(r)}
                    />
                  </div>
                  <RoleKind role={r} onTeam={onTeam} />
                  <BlurInput
                    value={r.description ?? ""}
                    onCommit={(d) => h.onDescribeRole(r, d)}
                    placeholder="Description (optional)"
                    maxLength={RACI_DESCRIPTION_MAX}
                    className="mt-1 h-7 text-xs font-normal"
                    aria-label={`Description of role ${r.name}`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activities.map((a) => (
              <tr key={a.id}>
                <th
                  scope="row"
                  className={cn(
                    "border bg-surface-deep p-2 text-left align-top font-normal",
                    flagged.has(a.id) ? "border-danger/50" : "border-border"
                  )}
                >
                  <div className="flex items-center gap-1">
                    <EditableName
                      value={a.name}
                      onChange={(name) => h.onRenameActivity(a, name)}
                      className="min-w-0 flex-1 font-medium text-text"
                      ariaLabel={`Rename activity ${a.name}`}
                    />
                    <IconButton
                      label={`Delete activity ${a.name}`}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      className="h-7 w-7 shrink-0 text-sub hover:text-danger"
                      onClick={() => h.onRemoveActivity(a)}
                    />
                  </div>
                  <BlurInput
                    value={a.description ?? ""}
                    onCommit={(d) => h.onDescribeActivity(a, d)}
                    placeholder="Description (optional)"
                    maxLength={RACI_DESCRIPTION_MAX}
                    className="mt-1 h-7 text-xs"
                    aria-label={`Description of activity ${a.name}`}
                  />
                </th>
                {roles.map((r) => (
                  <td
                    key={r.id}
                    className={cn(
                      "border p-1.5 align-middle",
                      flagged.has(a.id) ? "border-danger/50" : "border-border"
                    )}
                  >
                    <CellChips
                      letters={cellOf(doc, a.id, r.id)}
                      label={`${a.name}, ${r.name}`}
                      onChange={(l) => h.onCell(a, r, l)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
