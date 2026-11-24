"use client";

/**
 * One scope under the hill: its number (the dot's), title and position (a
 * box that moves it, the keyboard and screen-reader path), the side it is
 * on, the story it follows with that story's status (or an epic with its
 * roll-up), its note, when it last moved, and the words "Stuck" or "Check".
 * A stuck scope offers "Raise as an impediment". Edit in place; delete has
 * Undo (the page's).
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import type { HillScope } from "@/lib/stores/workspace-types";
import {
  MISMATCH_TEXT,
  SIDE_LABEL,
  SIDE_WORD,
  movedAgoText,
  sideOf,
  type ScopeMismatch,
  type ScopeValues,
} from "@/lib/hill-chart/model";
import { ScopeFields, type LinkOption } from "./fields";
import {
  positionError,
  scopeDraftFrom,
  validateScope,
  type ScopeDraft,
  type ScopeField,
} from "./form";

const SIDE_BADGE: Record<ReturnType<typeof sideOf>, string> = {
  uphill: "border-accent/30 bg-accent/10 text-text",
  downhill: "border-success/30 bg-success/10 text-text",
  done: "border-success/30 bg-success/10 text-success",
};

export interface ScopeRowProps {
  scope: HillScope;
  /** Its number on the hill (1-based). */
  number: number;
  daysSinceMove: number;
  stuck: boolean;
  mismatch: ScopeMismatch | null;
  /** The story it follows: its title, status and link. */
  story?: { title: string; status: string; href: string };
  /** The epic it follows: its title and roll-up. */
  epic?: { title: string; progress: string; href: string };
  /** How it moved since the check-in compared against ("forward 20"). */
  since?: string;
  stories: readonly LinkOption[];
  epics: readonly LinkOption[];
  editing: boolean;
  /** Why it can't be sent (the example), or null. */
  sendBlocked: string | null;
  source: HandoffSource;
  getLinks: () => readonly HandoffLink[] | undefined;
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  onMove: (position: number) => void;
  onEdit: (editing: boolean) => void;
  onSave: (values: ScopeValues) => void;
  onRemove: () => void;
}

export function ScopeRow(props: ScopeRowProps) {
  const { scope, editing } = props;
  if (editing) return <ScopeEditor {...props} />;
  return <ScopeView {...props} key={`${scope.id}:${scope.position}`} />;
}

function ScopeView({
  scope,
  number,
  daysSinceMove,
  stuck,
  mismatch,
  story,
  epic,
  since,
  sendBlocked,
  source,
  getLinks,
  onLinksChange,
  onMove,
  onEdit,
  onRemove,
}: ScopeRowProps) {
  const [typed, setTyped] = useState(String(scope.position));
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const side = sideOf(scope.position);

  const save = () => {
    const problem = positionError(typed);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const n = Number(typed.trim());
    if (n !== scope.position) onMove(n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      setTyped(String(scope.position));
      setError(null);
    }
  };

  return (
    <li
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3",
        stuck ? "border-warning/30" : "border-border"
      )}
      data-scope-row={scope.id}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg text-xs font-semibold text-text"
          aria-hidden="true"
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-text" data-scope-title={scope.id}>
            {scope.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="outline" className={SIDE_BADGE[side]}>
              {SIDE_LABEL[side]}
            </Badge>
            {stuck && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-text">
                Stuck
              </Badge>
            )}
            {mismatch && (
              <Badge
                variant="outline"
                className="border-info/30 bg-info/10 text-text"
                title={MISMATCH_TEXT[mismatch]}
              >
                Check
              </Badge>
            )}
            <span className="text-sub">
              Moved {movedAgoText(daysSinceMove)}
              {since ? `; ${since}` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Edit ${scope.title}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={() => onEdit(true)}
          />
          <IconButton
            label={`Delete ${scope.title}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            data-scope-delete={scope.id}
            onClick={onRemove}
          />
        </div>
      </div>

      {mismatch && <p className="text-xs text-text">{MISMATCH_TEXT[mismatch]}</p>}

      {/* The label on its own line, so the readout sits right beside the box
          on every scope, however long the scope's name. */}
      <div className="space-y-1">
        <label htmlFor={inputId} className="block text-xs text-sub">
          Position of {scope.title}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id={inputId}
            inputMode="numeric"
            className="w-24"
            value={typed}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={save}
            onKeyDown={onKeyDown}
          />
          <span className="text-xs text-sub" aria-hidden="true">
            {scope.position}, {SIDE_WORD[side]}
          </span>
          {stuck && (
            <SendToMenu
              routes={["impediment"]}
              disabled={Boolean(sendBlocked)}
              item={source}
              sentTo={scope.sentTo}
              getLinks={getLinks}
              onLinksChange={onLinksChange}
              itemLabels={{ impediment: "Raise as an impediment" }}
              className="h-8"
            />
          )}
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {stuck && sendBlocked && <p className="text-xs text-sub">{sendBlocked}</p>}

      {(story || epic || scope.note) && (
        <div className="space-y-1 text-xs text-sub">
          {story && (
            <p>
              Story:{" "}
              <Link href={story.href} className="text-accent underline-offset-2 hover:underline">
                {story.title}
              </Link>{" "}
              <span className="text-text">({story.status})</span>
            </p>
          )}
          {epic && (
            <p>
              Epic:{" "}
              <Link href={epic.href} className="text-accent underline-offset-2 hover:underline">
                {epic.title}
              </Link>{" "}
              <span className="text-text">({epic.progress})</span>
            </p>
          )}
          {scope.note && <p className="whitespace-pre-wrap break-words">{scope.note}</p>}
        </div>
      )}
    </li>
  );
}

function ScopeEditor({ scope, stories, epics, onSave, onEdit }: ScopeRowProps) {
  const form = useItemForm<ScopeDraft, ScopeValues, ScopeField>({
    initial: () => scopeDraftFrom(scope),
    validate: validateScope,
    onSave: (values) => {
      onSave(values);
      onEdit(false);
    },
    resetOnSave: false,
  });
  const { formRef } = form;
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    focused.current = true;
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <li className="rounded-lg border border-accent/40 bg-card p-3">
      <ItemForm form={form} submitLabel="Save scope" onCancel={() => onEdit(false)}>
        <ScopeFields form={form} stories={stories} epics={epics} />
      </ItemForm>
    </li>
  );
}
