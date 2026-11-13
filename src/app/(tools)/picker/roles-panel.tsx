"use client";

/**
 * Standing roles (facilitator, scribe, timekeeper, or the team's own) on a
 * fair rotation: whoever has had the role least, and longest ago, is next,
 * and nobody holds two roles on the same day while someone else is free.
 * Someone away today is skipped without losing their place. Every turn is
 * kept as the fairness history, and each can be taken back with Undo.
 *
 * The roles rotate among the team on the Team page, or a saved list chosen
 * here: never whatever the wheel is spinning.
 */

import { MonitorUp, Plus, Trash2, UserCheck, UserMinus, Users } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  PICKER_LIMITS,
  nextForRole,
  roleStandings,
  timeAgo,
  type PickerRole,
  type PickerRoleTurn,
  type RolePlanRow,
} from "@/lib/picker/model";
import { byId, focusIfLost, focusSoon } from "./focus";
import { validateRoleDraft, type RoleDraft } from "./forms";

export interface RolesPanelProps {
  roles: readonly PickerRole[];
  turns: readonly PickerRoleTurn[];
  /** Who takes the roles: the team, or the list chosen for roles. */
  people: readonly string[];
  /** "Team (8 people)": where the people come from. */
  peopleFrom: string;
  /** The people are the Team page's (else a saved list's). */
  peopleAreTeam: boolean;
  /** TEAM_SOURCE or the id of the list the roles rotate among. */
  roleSource: string;
  /** Team plus each saved list; empty when there are no lists to choose. */
  roleSourceOptions: { value: string; label: string }[];
  onRoleSource: (source: string) => void;
  /** Name keys away today. */
  away: readonly string[];
  /** The local day, YYYY-MM-DD. */
  today: string;
  /** Each role nobody has had today, and who would get it. */
  plan: readonly RolePlanRow[];
  now: Date;
  roomLive: boolean;
  onGiveOut: () => void;
  onAssign: (role: PickerRole, person: string) => void;
  onAway: (name: string, away: boolean) => void;
  onRemoveTurn: (turn: PickerRoleTurn) => void;
  onAddRole: (name: string) => void;
  onRemoveRole: (role: PickerRole) => void;
  onShow: (title: string, body: string) => void;
}

const HEADING_ID = "picker-roles-heading";
const roleHeadingId = (roleId: string) => `picker-role-${roleId}`;
const turnButtonId = (turnId: string) => `picker-turn-${turnId}`;
const turnsSummaryId = (roleId: string) => `picker-turns-${roleId}`;
const awayButtonId = (roleId: string, key: string) =>
  `picker-away-${roleId}-${encodeURIComponent(key)}`;

export function RolesPanel({
  roles,
  turns,
  people,
  peopleFrom,
  peopleAreTeam,
  roleSource,
  roleSourceOptions,
  onRoleSource,
  away,
  today,
  plan,
  now,
  roomLive,
  onGiveOut,
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
  const options = { away, today };
  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? null;
  const giving = plan.filter((p) => p.person);

  const removeRole = (role: PickerRole) => {
    const at = roles.findIndex((r) => r.id === role.id);
    const neighbour = roles[at + 1] ?? roles[at - 1];
    onRemoveRole(role);
    focusSoon(...(neighbour ? [byId(roleHeadingId(neighbour.id))] : []), byId(HEADING_ID));
  };

  const removeTurn = (
    role: PickerRole,
    history: readonly PickerRoleTurn[],
    turn: PickerRoleTurn
  ) => {
    const at = history.findIndex((t) => t.id === turn.id);
    const neighbour = history[at + 1] ?? history[at - 1];
    onRemoveTurn(turn);
    focusSoon(
      ...(neighbour ? [byId(turnButtonId(neighbour.id))] : []),
      byId(turnsSummaryId(role.id)),
      byId(roleHeadingId(role.id))
    );
  };

  return (
    <section aria-labelledby={HEADING_ID} className="space-y-4">
      <div className="space-y-1">
        <h2 id={HEADING_ID} tabIndex={-1} className="text-base font-semibold text-text">
          Rotating roles
        </h2>
        <p className="text-sm text-sub">
          {people.length > 0
            ? `From ${peopleFrom}. The fewest turns go first, then whoever had it longest ago, and nobody gets two roles in a day while someone else is free.`
            : peopleAreTeam
              ? "Add your team on the Team page first, or choose one of your lists below."
              : "This list has no names yet."}
        </p>
      </div>

      {roleSourceOptions.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-sm text-text" aria-hidden="true">
            Who takes the roles
          </p>
          <ToggleGroup
            label="Who takes the roles"
            options={roleSourceOptions}
            value={roleSource}
            onValueChange={onRoleSource}
            size="sm"
          />
        </div>
      )}

      {people.length > 0 && giving.length > 1 && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4">
          <p className="text-sm text-text">
            Not given out today:{" "}
            {giving.map((p, i) => (
              <span key={p.role.id}>
                {i > 0 && ", "}
                <span className="font-semibold">{p.person}</span> as {p.role.name}
              </span>
            ))}
            .
          </p>
          <Button
            type="button"
            size="sm"
            variant="toolkit"
            className="gap-1.5"
            onClick={() => {
              onGiveOut();
              focusIfLost(byId(HEADING_ID));
            }}
          >
            <Users aria-hidden="true" />
            Give out {giving.length} roles
          </Button>
        </div>
      )}

      {people.length > 0 &&
        roles.map((role) => {
          const next = nextForRole(people, turns, role.id, options);
          const rows = roleStandings(people, turns, role.id, options);
          const history = turns
            .filter((t) => t.roleId === role.id)
            .slice(-5)
            .reverse();
          const latest = history[0];
          const keepFocus = () => focusIfLost(byId(roleHeadingId(role.id)));
          return (
            <article
              key={role.id}
              aria-labelledby={roleHeadingId(role.id)}
              className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3
                  id={roleHeadingId(role.id)}
                  tabIndex={-1}
                  className="text-sm font-semibold text-text"
                >
                  {role.name}
                </h3>
                <Button
                  type="button"
                  size="icon"
                  variant="danger-ghost"
                  aria-label={`Remove the ${role.name} role`}
                  onClick={() => removeRole(role)}
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
                    onClick={() => {
                      onAssign(role, next);
                      keepFocus();
                    }}
                  >
                    <UserCheck aria-hidden="true" />
                    Give {next} the role
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      onAway(next, true);
                      keepFocus();
                    }}
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
                        <span className="sr-only">Away today</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {rows.map((r) => {
                      const held = roleName(r.busyWith);
                      return (
                        <tr key={r.key}>
                          <th scope="row" className="py-1 pr-2 font-normal text-text">
                            {/* A cell ignores max-width: the span cuts a long name. */}
                            <span className="block max-w-32 truncate">{r.name}</span>
                            {r.away && <span className="block text-xs text-sub">(away)</span>}
                            {!r.away && held && (
                              <span className="block text-xs text-sub">({held} today)</span>
                            )}
                          </th>
                          <td className="py-1 pr-2 text-right font-data text-text">{r.turns}</td>
                          <td className="py-1 pr-2 text-sub">
                            {r.lastAt ? timeAgo(r.lastAt, now) : "never"}
                          </td>
                          <td className="py-1 text-right">
                            <Button
                              id={awayButtonId(role.id, r.key)}
                              type="button"
                              size="sm"
                              variant={r.away ? "secondary" : "ghost"}
                              aria-pressed={r.away}
                              aria-label={`Away today: ${r.name}`}
                              onClick={() => {
                                onAway(r.name, !r.away);
                                // The row moves (away sorts last): keep focus on its button.
                                focusIfLost(byId(awayButtonId(role.id, r.key)));
                              }}
                            >
                              <UserMinus aria-hidden="true" />
                              <span className="hidden sm:inline">Away</span>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {history.length > 0 && (
                <details>
                  <summary
                    id={turnsSummaryId(role.id)}
                    className="min-h-11 cursor-pointer py-3 text-sm text-text"
                  >
                    Recent turns
                  </summary>
                  <ul className="space-y-1">
                    {history.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-text">
                          {t.person} <span className="text-sub">· {timeAgo(t.at, now)}</span>
                        </span>
                        <Button
                          id={turnButtonId(t.id)}
                          type="button"
                          size="icon"
                          variant="danger-ghost"
                          aria-label={`Remove ${t.person}'s turn from ${timeAgo(t.at, now)}`}
                          onClick={() => removeTurn(role, history, t)}
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
