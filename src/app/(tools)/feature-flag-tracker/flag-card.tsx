"use client";

/**
 * One flag: its name, purpose, status and why it is or isn't stale, who
 * owns it, its days and the release it ships behind. A live flag is On or
 * Off and retires on a day (today unless moved back); a retired one can be
 * brought back. A stale flag can go to the backlog as a removal story.
 * Edit opens the add form's fields in place; Delete offers Undo.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "@/components/motion/transition-link";
import { Archive, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import type { FeatureFlag, HandoffLink } from "@/lib/stores/workspace-types";
import { ENV_LABEL, PURPOSE_LABEL, STATUS_LABEL, flagStaleness } from "@/lib/flags/model";
import { cn } from "@/lib/utils";
import {
  draftFrom,
  validateFlag,
  validateRetiredDay,
  type FlagDraft,
  type FlagField,
  type FlagValues,
  type ReleaseOption,
} from "./form";
import { FlagFields } from "./flag-fields";
import { ageText, dayLabel, livedText, stalenessText } from "./text";

type Mode = "view" | "edit" | "retire";

export interface FlagCardProps {
  flag: FeatureFlag;
  today: string;
  releases: readonly ReleaseOption[];
  /** The linked release's name, if it still exists. */
  releaseName?: string;
  /** The example is on screen: nothing is sent to another tool or added to the team. */
  preview: boolean;
  onStatus: (f: FeatureFlag, status: "on" | "off") => void;
  onRetire: (f: FeatureFlag, day: string) => void;
  onSave: (f: FeatureFlag, values: FlagValues) => void;
  onRemove: (f: FeatureFlag) => void;
  onLinksChange: (
    f: FeatureFlag,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
}

/** A live flag's two states; retiring is its own action, with a day. */
const LIVE_OPTIONS: ToggleOption<"on" | "off">[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const STATUS_BADGE: Record<FeatureFlag["status"], string> = {
  on: "border-success/30 bg-success/10 text-success",
  off: "border-border bg-bg text-sub",
  retired: "border-border bg-bg text-sub",
};

export function FlagCard({
  flag: f,
  today,
  releases,
  releaseName,
  preview,
  onStatus,
  onRetire,
  onSave,
  onRemove,
  onLinksChange,
}: FlagCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the editor or the retire form closes.
  const returnTo = useRef<"edit" | "action" | null>(null);
  const st = flagStaleness(f, today);
  const retired = f.status === "retired";
  const name = f.name || "Unnamed flag";

  const switchMode = (next: Mode, focus: "edit" | "action" | null = null) => {
    returnTo.current = focus;
    setMode(next);
  };

  useEffect(() => {
    if (mode !== "view" || !returnTo.current) return;
    (returnTo.current === "edit" ? editRef : actionRef).current?.focus();
    returnTo.current = null;
  }, [mode, f.status]);

  if (mode === "edit") {
    return (
      <FlagEditor
        flag={f}
        today={today}
        releases={releases}
        preview={preview}
        onSave={(values) => {
          onSave(f, values);
          switchMode("view", "edit");
        }}
        onCancel={() => switchMode("view", "edit")}
      />
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "space-y-3 rounded-lg border p-3 sm:p-4",
        retired
          ? "bg-surface border-border"
          : st.stale
            ? "bg-warning/5 border-warning/40"
            : "bg-card border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="break-all font-data text-sm text-text">
            {name}
          </h3>
          {f.description && (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-sub">
              {f.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            ref={editRef}
            label={`Edit ${name}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            data-flag-edit={f.id}
            onClick={() => switchMode("edit")}
          />
          <IconButton
            label={`Delete ${name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(f)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={STATUS_BADGE[f.status]}>
          {STATUS_LABEL[f.status]}
        </Badge>
        <Badge variant="outline" className="border-border text-sub">
          {PURPOSE_LABEL[f.purpose]}
        </Badge>
        {!retired && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
              st.stale
                ? "border-warning/40 bg-warning/10 text-warning"
                : st.exempt
                  ? "border-info/30 bg-info/10 text-info"
                  : "border-border text-sub"
            )}
          >
            {stalenessText(st, f.purpose)}
          </span>
        )}
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
        <Meta term="Owner">{f.owner || "Nobody yet"}</Meta>
        {f.environment && <Meta term="Environment">{ENV_LABEL[f.environment]}</Meta>}
        <Meta term="Created">
          {dayLabel(f.createdAt, true)}
          {!retired && <span className="text-sub"> ({ageText(st.ageDays)})</span>}
        </Meta>
        {f.removeBy && <Meta term="Remove by">{dayLabel(f.removeBy, true)}</Meta>}
        {retired && (
          <Meta term="Retired">
            {f.retiredAt
              ? `${dayLabel(f.retiredAt, true)}${livedText(st.ageDays)}`
              : "Day not recorded"}
          </Meta>
        )}
        {f.releaseId && (
          <Meta term="Ships with">
            {releaseName ? (
              <Link
                href="/release-readiness"
                className="text-accent underline-offset-2 hover:underline"
              >
                {releaseName}
              </Link>
            ) : (
              "A release no longer listed"
            )}
          </Meta>
        )}
      </dl>

      {mode === "retire" ? (
        <RetireForm
          flag={f}
          today={today}
          onRetire={(day) => {
            onRetire(f, day);
            switchMode("view", "action");
          }}
          onCancel={() => switchMode("view", "action")}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          {retired ? (
            <Button
              ref={actionRef}
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              aria-label={`Bring back ${name}`}
              onClick={() => {
                returnTo.current = "action";
                onStatus(f, "on");
              }}
            >
              <RotateCcw aria-hidden="true" />
              Bring back
            </Button>
          ) : (
            <>
              <ToggleGroup
                label={`Status of ${name}`}
                size="sm"
                options={LIVE_OPTIONS}
                value={f.status as "on" | "off"}
                onValueChange={(status) => onStatus(f, status)}
              />
              <Button
                ref={actionRef}
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1"
                aria-label={`Retire ${name}`}
                onClick={() => switchMode("retire")}
              >
                <Archive aria-hidden="true" />
                Retire
              </Button>
              {st.stale && (
                <SendToMenu
                  routes={["backlog-story"]}
                  disabled={preview}
                  item={{
                    title: `Remove flag ${name}`,
                    description: `${stalenessText(st, f.purpose)}. ${f.description ?? ""}`.trim(),
                    owner: f.owner,
                    sourceRef: { tool: "feature-flag-tracker", id: f.id },
                  }}
                  sentTo={f.sentTo}
                  onLinksChange={(update) => onLinksChange(f, update)}
                  itemLabels={{ "backlog-story": "Plan its removal (backlog story)" }}
                  className="h-8"
                />
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Meta({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt>{term}:</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

/** "Retired on [today]": the day can be moved back to when it left the code. */
function RetireForm({
  flag,
  today,
  onRetire,
  onCancel,
}: {
  flag: FeatureFlag;
  today: string;
  onRetire: (day: string) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<{ retiredAt: string }, string, "retiredAt">({
    initial: { retiredAt: today },
    validate: (d) => validateRetiredDay(d.retiredAt, flag.createdAt, today),
    onSave: onRetire,
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm
      form={form}
      submitLabel="Retire flag"
      submitIcon={<Archive className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className="border-t border-border pt-3"
    >
      <Field
        label="Retired on"
        error={errors.retiredAt}
        required
        hint="The day it left the code."
        className="max-w-xs"
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            min={flag.createdAt || undefined}
            max={today}
            value={draft.retiredAt}
            onChange={(e) => update({ retiredAt: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/** Edit in place: the add form's fields with this flag's values. Enter saves, Escape cancels. */
function FlagEditor({
  flag,
  today,
  releases,
  preview,
  onSave,
  onCancel,
}: {
  flag: FeatureFlag;
  today: string;
  releases: readonly ReleaseOption[];
  preview: boolean;
  onSave: (values: FlagValues) => void;
  onCancel: () => void;
}) {
  const retired = flag.status === "retired";
  // What the editor opened with: dates still holding it aren't judged again.
  const [stored] = useState(() => draftFrom(flag));
  const form = useItemForm<FlagDraft, FlagValues, FlagField>({
    initial: stored,
    validate: (d) => validateFlag(d, today, { retired, stored }),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <div className="rounded-lg border border-accent/40 bg-card p-3 sm:p-4">
      <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
        <FlagFields
          form={form}
          today={today}
          releases={releases}
          retired={retired}
          offerAddToRoster={!preview}
          label={`Edit ${flag.name || "Unnamed flag"}`}
        />
      </ItemForm>
    </div>
  );
}
