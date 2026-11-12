"use client";

/**
 * Standing roles (facilitator, scribe, timekeeper, or the team's own) on a
 * fair rotation: whoever has had the role least, and longest ago, is next.
 * Someone away today is skipped without losing their place. Every turn is
 * kept as the fairness history, and each can be taken back with Undo.
 */

import { MonitorUp, Plus, Trash2, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  PICKER_LIMITS,
  nextForRole,
  roleStandings,
  timeAgo,
  type PickerRole,
  type PickerRoleTurn,
} from "@/lib/picker/model";
import { validateRoleDraft, type RoleDraft } from "./forms";

export interface RolesPanelProps {
  roles: readonly PickerRole[];
  turns: readonly PickerRoleTurn[];
  /** Who rotates: the wheel's people. */
  people: readonly string[];
  /** "Team (8 people)": where the people come from. */
  peopleFrom: string;
  /** Name keys away today. */
  away: readonly string[];
  now: Date;
  roomLive: boolean;
  onAssign: (role: PickerRole, person: string) => void;
  onAway: (name: string, away: boolean) => void;
  onRemoveTurn: (turn: PickerRoleTurn) => void;
  onAddRole: (name: string) => void;
  onRemoveRole: (role: PickerRole) => void;
  onShow: (title: string, body: string) => void;
}

export function RolesPanel({
  roles,
  turns,
  people,
  peopleFrom,
  away,
  now,
  roomLive,
  onAssign,
  onAway,
  onRemoveTurn,
  onAddRole,
  onRemoveRole,
  onShow,
}: RolesPanelProps) {
  const form = useItemForm<RoleDraft, { name: string }, "name">({
    initial: { name: "" },
    validate: (d) => validateRoleDraft(d, roles),
    onSave: ({ name }) => onAddRole(name),
  });

  return (
    <section aria-labelledby="picker-roles-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="picker-roles-heading" className="text-base font-semibold text-text">
          Rotating roles
        </h2>
        <p className="text-sm text-sub">
          {people.length > 0
            ? `From ${peopleFrom}. The fewest turns go first, then whoever had it longest ago.`
            : "Add people to the wheel first: your team, or a saved list."}
        </p>
      </div>

      {people.length > 0 &&
        roles.map((role) => {
          const next = nextForRole(people, turns, role.id, away);
          const rows = roleStandings(people, turns, role.id, away);
          const history = turns
            .filter((t) => t.roleId === role.id)
            .slice(-5)
            .reverse();
          const latest = history[0];
          return (
            <article
              key={role.id}
              aria-labelledby={`picker-role-${role.id}`}
              className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`picker-role-${role.id}`} className="text-sm font-semibold text-text">
                  {role.name}
                </h3>
                <Button
                  type="button"
                  size="icon"
                  variant="danger-ghost"
                  aria-label={`Remove the ${role.name} role`}
                  onClick={() => onRemoveRole(role)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>

              {next ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 basis-40 text-sm text-text">
                    Next up: <span className="font-display text-lg font-bold">{next}</span>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="toolkit"
                    className="gap-1.5"
                    onClick={() => onAssign(role, next)}
                  >
                    <UserCheck aria-hidden="true" />
                    Give {next} the role
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => onAway(next, true)}
                  >
                    <UserMinus aria-hidden="true" />
                    Skip {next}, away today
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-text">Everyone is away today.</p>
              )}

              {latest && roomLive && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => onShow(latest.person, `${role.name} today`)}
                >
                  <MonitorUp aria-hidden="true" />
                  Show {latest.person} on everyone&apos;s screen
                </Button>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{`Turns as ${role.name}, fairest first`}</caption>
                  <thead>
                    <tr className="text-xs text-sub">
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Person
                      </th>
                      <th scope="col" className="py-1 pr-2 text-right font-medium">
                        Turns
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Last turn
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        <span className="sr-only">Today</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <th
                          scope="row"
                          className="max-w-32 truncate py-1 pr-2 font-normal text-text"
                        >
                          {r.name}
                          {r.away && <span className="ml-1 text-xs text-sub">(away)</span>}
                        </th>
                        <td className="py-1 pr-2 text-right font-data text-text">{r.turns}</td>
                        <td className="py-1 pr-2 text-sub">
                          {r.lastAt ? timeAgo(r.lastAt, now) : "never"}
                        </td>
                        <td className="py-1 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={
                              r.away ? `${r.name} is back today` : `${r.name} is away today`
                            }
                            onClick={() => onAway(r.name, !r.away)}
                          >
                            {r.away ? (
                              <UserPlus aria-hidden="true" />
                            ) : (
                              <UserMinus aria-hidden="true" />
                            )}
                            <span className="hidden sm:inline">{r.away ? "Back" : "Away"}</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {history.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-sub">Recent turns</summary>
                  <ul className="mt-1 space-y-1">
                    {history.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-text">
                          {t.person} <span className="text-sub">· {timeAgo(t.at, now)}</span>
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="danger-ghost"
                          aria-label={`Remove ${t.person}'s turn from ${timeAgo(t.at, now)}`}
                          onClick={() => onRemoveTurn(t)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}

      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <ItemForm form={form} submitLabel="Add role" submitIcon={<Plus aria-hidden="true" />}>
          <Field
            label="Another role"
            hint={`Up to ${PICKER_LIMITS.maxRoles} roles, such as Note taker or Demo driver.`}
            error={form.errors.name}
          >
            {(p) => (
              <Input
                {...p}
                value={form.draft.name}
                maxLength={PICKER_LIMITS.maxRoleNameChars + 10}
                onChange={(e) => form.update({ name: e.target.value })}
              />
            )}
          </Field>
        </ItemForm>
      </div>
    </section>
  );
}
