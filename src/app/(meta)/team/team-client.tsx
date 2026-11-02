"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Link from "next/link";
import { Pencil, Share2, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { getToolById } from "@/lib/constants/tools";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { nameKey, useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { ROSTER_TOOLS } from "./roster-tools";
import { TeamCharter } from "./charter";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** What the form produces: a member without its id. */
type MemberValues = Pick<TeamMember, "name" | "role" | "capacityPct" | "skills">;

interface Draft {
  name: string;
  role: string;
  capacity: string;
  skills: string;
}

const EMPTY_DRAFT: Draft = { name: "", role: "", capacity: "", skills: "" };

function toDraft(m: TeamMember): Draft {
  return {
    name: m.name,
    role: m.role ?? "",
    capacity: typeof m.capacityPct === "number" ? String(m.capacityPct) : "",
    skills: (m.skills ?? []).join(", "),
  };
}

function parseSkills(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const skill = part.trim();
    if (skill && !seen.has(skill.toLowerCase())) {
      seen.add(skill.toLowerCase());
      out.push(skill);
    }
  }
  return out;
}

function validate(draft: Draft, takenNames: ReadonlySet<string>) {
  const key = nameKey(draft.name);
  const name = !key
    ? "Enter a name."
    : takenNames.has(key)
      ? `${draft.name.trim()} is already on the team.`
      : undefined;
  const raw = draft.capacity.trim();
  const n = Number(raw);
  const capacity =
    raw && (!Number.isFinite(n) || n < 0 || n > 100) ? "Use a number from 0 to 100." : undefined;
  return { name, capacity };
}

function fromDraft(draft: Draft): MemberValues {
  const role = draft.role.trim();
  const capacity = draft.capacity.trim();
  const skills = parseSkills(draft.skills);
  return {
    name: draft.name.trim(),
    role: role || undefined,
    capacityPct: capacity ? Number(capacity) : undefined,
    skills: skills.length > 0 ? skills : undefined,
  };
}

/** The member with the form's values; cleared optional fields are dropped. */
function withValues(member: TeamMember, values: MemberValues): TeamMember {
  const next: TeamMember = { ...member, ...values };
  if (values.role === undefined) delete next.role;
  if (values.capacityPct === undefined) delete next.capacityPct;
  if (values.skills === undefined) delete next.skills;
  return next;
}

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** Whether removing the member clears an owner or assignee link somewhere. */
function ownsItems(id: string): boolean {
  const s = useWorkspaceStore.getState();
  return (
    (s.stories ?? []).some((st) => st.owner === id) ||
    (s.okrs ?? []).some((o) => o.owner === id) ||
    (s.impediments ?? []).some((i) => i.owner === id) ||
    (s.whiteboardObjects ?? []).some((o) => o.type === "card" && o.assignee === id)
  );
}

/* -------------------------------------------------------------------------- */
/*  Member form (add and edit)                                                */
/* -------------------------------------------------------------------------- */

function MemberForm({
  initial,
  takenNames,
  submitLabel,
  standupUpdates = 0,
  onSubmit,
  onCancel,
}: {
  /** The member being edited; absent when adding. */
  initial?: TeamMember;
  /** Name keys already used by other members. */
  takenNames: ReadonlySet<string>;
  submitLabel: string;
  /** Standup updates filed under the edited member's current name. */
  standupUpdates?: number;
  onSubmit: (values: MemberValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (initial ? toDraft(initial) : EMPTY_DRAFT));
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const capacityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const errors = validate(draft, takenNames);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errors.name) return nameRef.current?.focus();
    if (errors.capacity) return capacityRef.current?.focus();
    onSubmit(fromDraft(draft));
  };

  // Standup files updates by name, so a rename leaves the old ones behind.
  const renamed = !!initial && draft.name.trim() !== initial.name.trim();
  const nameHint =
    renamed && standupUpdates > 0
      ? `${standupUpdates} past standup ${
          standupUpdates === 1 ? "update stays" : "updates stay"
        } under “${shortName(initial.name)}”.`
      : undefined;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={initial ? `Edit ${initial.name || "member"}` : "Add a team member"}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-deep p-3 sm:p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required hint={nameHint} error={submitted ? errors.name : undefined}>
          {(props) => (
            <Input
              {...props}
              ref={nameRef}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              onKeyDown={onEscape}
              autoComplete="off"
              maxLength={80}
            />
          )}
        </Field>
        <Field label="Role" hint="For example: Developer, Product Owner">
          {(props) => (
            <Input
              {...props}
              value={draft.role}
              onChange={(e) => set({ role: e.target.value })}
              onKeyDown={onEscape}
              autoComplete="off"
              maxLength={80}
            />
          )}
        </Field>
        <Field
          label="Capacity %"
          hint="Share of their time on this team. Leave blank for full time."
          error={submitted ? errors.capacity : undefined}
        >
          {(props) => (
            <Input
              {...props}
              ref={capacityRef}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={draft.capacity}
              onChange={(e) => set({ capacity: e.target.value })}
              onKeyDown={onEscape}
              className="font-data"
            />
          )}
        </Field>
        <Field label="Skills" hint="Separate with commas.">
          {(props) => (
            <Input
              {...props}
              value={draft.skills}
              onChange={(e) => set({ skills: e.target.value })}
              onKeyDown={onEscape}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="toolkit" size="sm">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Member row                                                                */
/* -------------------------------------------------------------------------- */

function MemberRow({
  member,
  focusEdit,
  onEdit,
  onRemove,
}: {
  member: TeamMember;
  /** Focus the Edit button on mount: the row just replaced its edit form. */
  focusEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const editRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusEdit) editRef.current?.focus();
  }, [focusEdit]);
  const name = member.name.trim() || "Unnamed member";
  const details = [
    member.role?.trim(),
    typeof member.capacityPct === "number" ? `${member.capacityPct}% capacity` : undefined,
  ].filter(Boolean);
  return (
    <div className="flex items-start gap-3">
      <div
        aria-hidden="true"
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-xs font-semibold text-accent"
      >
        {initials(member.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{name}</p>
        {details.length > 0 && <p className="text-xs text-sub">{details.join(" · ")}</p>}
        {member.skills && member.skills.length > 0 && (
          <ul aria-label={`${name}'s skills`} className="mt-1.5 flex flex-wrap gap-1">
            {member.skills.map((skill) => (
              <li
                key={skill}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-sub"
              >
                {skill}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* Plain Buttons, not IconButton: the a11y lint rule can't see
            IconButton's `label` prop as an accessible name. */}
        <Button
          ref={editRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Edit ${name}`}
          title="Edit"
          onClick={onEdit}
          className="min-h-6 min-w-6 min-touch-coarse"
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="danger-ghost"
          size="icon"
          aria-label={`Remove ${name}`}
          title="Remove"
          onClick={onRemove}
          className="min-h-6 min-w-6 min-touch-coarse"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export function TeamClient() {
  const members = useTeamRoster();
  const hydrated = useWorkspaceHydrated();
  const standupEntries = useWorkspaceStore((s) => s.standupEntries);
  const upsertTeamMember = useWorkspaceStore((s) => s.upsertTeamMember);
  const removeTeamMember = useWorkspaceStore((s) => s.removeTeamMember);

  const [adding, setAdding] = useState(false);
  // Remounts the add form after each add: cleared and focused for the next.
  const [addKey, setAddKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The member whose edit form just closed: focus goes back to their Edit button.
  const [closedEditId, setClosedEditId] = useState<string | null>(null);
  const startEdit = (id: string) => {
    setClosedEditId(null);
    setEditingId(id);
  };
  const closeEdit = (id: string) => {
    setEditingId(null);
    setClosedEditId(id);
  };

  const namesExcept = (id?: string) =>
    new Set(members.filter((m) => m.id !== id).map((m) => nameKey(m.name)));

  const addMember = (values: MemberValues) => {
    upsertTeamMember(withValues({ id: `member_${crypto.randomUUID()}`, name: "" }, values));
    setAddKey((k) => k + 1);
  };

  const saveMember = (member: TeamMember, values: MemberValues) => {
    upsertTeamMember(withValues(member, values));
    closeEdit(member.id);
  };

  const removeMember = (member: TeamMember) => {
    const clearsLinks = ownsItems(member.id);
    undoable({
      label: `Removed “${shortName(member.name) || "Unnamed member"}”`,
      description: clearsLinks
        ? "Undo adds them back, but the items they owned stay unassigned."
        : undefined,
      apply: () => removeTeamMember(member.id),
      // Undo restores the member with the same id, so mood entries and kudos
      // that point at that id link up again. It does NOT restore the owner
      // references removeTeamMember cleared (stories, OKRs and impediments
      // owned by them, canvas cards assigned to them): those stay unassigned.
      // The member comes back at the end of the list, since upsert appends.
      revert: () => {
        const back = (useWorkspaceStore.getState().teamMembers ?? []).some(
          (m) => m.id === member.id
        );
        if (!back) upsertTeamMember(member);
      },
    });
  };

  const standupUpdatesFor = (name: string) =>
    (standupEntries ?? []).filter((e) => e.member === name).length;

  const showEmpty = hydrated && members.length === 0 && !adding;

  return (
    <div className="container-meta">
      <div className="panel mb-4 flex items-start gap-3 px-4 py-4 sm:mb-6 sm:px-6 sm:py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
          <Users className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-fluid-h2 font-display font-bold leading-tight text-text">Team</h1>
          <p className="mt-1 text-fluid-body text-sub">
            The people on your team and the agreements you work by. Tools that need names read them
            from here; the charter below gathers the working agreement, Definition of Ready and
            Done, the estimation baseline and the ceremony times.
          </p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {!hydrated ? (
          <p className="p-4 text-sm text-sub" aria-busy="true">
            Loading your team…
          </p>
        ) : showEmpty ? (
          <EmptyState
            icon={Users}
            padding="xl"
            action={
              <Button variant="toolkit" onClick={() => setAdding(true)} className="gap-1.5">
                <UserPlus aria-hidden="true" />
                Add your first member
              </Button>
            }
          >
            <p className="text-sm font-medium text-text">No one on your team yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm">
              Add the people you work with once. Standup, Mood Tracker, Kudos, Capacity Planner and
              Ceremony Timer then use the same list, so you don&apos;t type names again in each
              tool.
            </p>
          </EmptyState>
        ) : (
          <SectionCard
            title="Members"
            icon={Users}
            titleSuffix={`(${members.length})`}
            contentClassName="space-y-3"
            actions={
              !adding && (
                <Button
                  size="sm"
                  variant="toolkit"
                  onClick={() => setAdding(true)}
                  className="gap-1.5"
                >
                  <UserPlus aria-hidden="true" />
                  Add member
                </Button>
              )
            }
          >
            {adding && (
              <MemberForm
                key={addKey}
                takenNames={namesExcept()}
                submitLabel="Add member"
                onSubmit={addMember}
                onCancel={() => setAdding(false)}
              />
            )}
            {members.length > 0 && (
              <ul aria-label="Team members" className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                    {editingId === m.id ? (
                      <MemberForm
                        initial={m}
                        takenNames={namesExcept(m.id)}
                        submitLabel="Save"
                        standupUpdates={standupUpdatesFor(m.name)}
                        onSubmit={(values) => saveMember(m, values)}
                        onCancel={() => closeEdit(m.id)}
                      />
                    ) : (
                      <MemberRow
                        member={m}
                        focusEdit={closedEditId === m.id}
                        onEdit={() => startEdit(m.id)}
                        onRemove={() => removeMember(m)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        <SectionCard title="Where the team list is used" icon={Share2}>
          <ul className="space-y-3">
            {ROSTER_TOOLS.map(({ toolId, use }) => {
              const tool = getToolById(toolId);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <li key={toolId} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <div className="min-w-0">
                    <Link
                      href={tool.path}
                      className="text-sm font-medium text-text underline-offset-4 hover:text-accent hover:underline"
                    >
                      {tool.name}
                    </Link>
                    <p className="text-xs text-sub">{use}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      </div>

      {hydrated && (
        <div className="mt-4">
          <TeamCharter />
        </div>
      )}
    </div>
  );
}
