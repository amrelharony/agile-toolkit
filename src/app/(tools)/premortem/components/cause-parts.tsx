"use client";

import { useEffect, useState } from "react";
import Link from "@/components/motion/transition-link";
import { Pencil, ShieldAlert, Trash2 } from "lucide-react";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { PersonPicker } from "@/components/team/person-picker";
import { IconButton } from "@/components/ui/icon-button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { findRosterMember } from "@/lib/team/use-team-roster";
import type { PremortemCause } from "../model";

/** Who a cause is, in a control's name: "“Scope creep”". */
export const causeName = (c: Pick<PremortemCause, "text">): string =>
  `“${c.text.trim() || "(untitled)"}”`;

/**
 * A cause's text and description, edited in place: the Edit button turns
 * them into a small form (Enter saves, Escape cancels), and focus comes
 * back to the button afterwards.
 */
export function CauseText({
  cause,
  onEdit,
  withDescription = true,
}: {
  cause: PremortemCause;
  onEdit: (next: { text: string; description?: string }) => void;
  withDescription?: boolean;
}) {
  const edit = useInlineEdit();
  if (edit.editing) {
    return (
      <InlineItemEditor
        label={`Edit cause ${causeName(cause)}`}
        title={cause.text}
        description={cause.description}
        withDescription={withDescription}
        titleLabel="Cause"
        descriptionLabel="Description (optional)"
        titleMaxLength={300}
        descriptionMaxLength={1000}
        onDone={(next, opts) => {
          if (next) onEdit({ text: next.title, description: next.description });
          edit.stop(opts);
        }}
        className="min-w-0 flex-1"
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-text">{cause.text || "(untitled)"}</p>
        {cause.description && (
          <p className="mt-0.5 break-words text-xs text-sub">{cause.description}</p>
        )}
      </div>
      <IconButton
        ref={edit.triggerRef}
        label={`Edit ${causeName(cause)}`}
        icon={<Pencil className="h-4 w-4" />}
        className="shrink-0 text-sub hover:text-text"
        onClick={edit.start}
      />
    </div>
  );
}

/** Delete, with the cause named for screen readers. */
export function RemoveCauseButton({
  cause,
  onRemove,
}: {
  cause: PremortemCause;
  onRemove: () => void;
}) {
  return (
    <IconButton
      label={`Delete ${causeName(cause)}`}
      icon={<Trash2 className="h-4 w-4" />}
      className="shrink-0 text-sub hover:text-danger"
      onClick={onRemove}
    />
  );
}

/** "Top 3", on the causes that go to the Risk Register. */
export function TopBadge({ rank }: { rank: number }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
      Top 3<span className="sr-only">{`, rank ${rank}`}</span>
    </span>
  );
}

/** Shown on a cause that is already a risk: where to find it. */
export function RiskLink() {
  return (
    <Link
      href="/risk-register"
      className="inline-flex shrink-0 items-center gap-1 rounded text-xs text-success underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
      In the Risk Register
    </Link>
  );
}

/**
 * The cause's owner, from the team roster. The name is saved when the
 * field is left or Enter is pressed (not on every keystroke, which wrote
 * the synced blob per character); a name picked from the team, or just
 * added to it, is saved at once, since no blur follows that click.
 */
export function OwnerField({
  cause,
  onChange,
}: {
  cause: PremortemCause;
  onChange: (owner: string) => void;
}) {
  const [draft, setDraft] = useState(cause.owner ?? "");
  useEffect(() => setDraft(cause.owner ?? ""), [cause.owner]);
  const commit = (name: string) => {
    if (name.trim() !== (cause.owner ?? "").trim()) onChange(name.trim());
  };
  return (
    // PersonPicker has no onBlur of its own: the wrapper hears its input's
    // blur and Enter as they bubble. It adds no role of its own.
    <div
      role="presentation"
      className="min-w-0"
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          commit(draft);
        }
      }}
    >
      <PersonPicker
        label={`Owner of ${causeName(cause)}`}
        hideLabel
        value={draft}
        placeholder="Owner"
        onChange={(name) => {
          setDraft(name);
          // Read the roster now: "Add to the team" has just added this name.
          if (findRosterMember(useWorkspaceStore.getState().teamMembers ?? [], name)) commit(name);
        }}
      />
    </div>
  );
}
