"use client";

/**
 * One release: its dates and description (edited in place), its gates and
 * how each reads, the flags shipping behind it, and what can happen next.
 * A release in planning ticks its gates (an auto gate whose check can tell
 * is decided by it) and ships through a dated dialog; a shipped one can be
 * marked rolled back on a day; a rolled-back one reopens for planning, its
 * ship kept, or goes to the retro as a topic. Delete offers Undo.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Pencil, RotateCcw, Rocket, Trash2, Undo2 } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { FeatureFlag, HandoffLink, Release } from "@/lib/stores/workspace-types";
import type { GateResult } from "@/lib/releases/auto-gates";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { PURPOSE_LABEL, STATUS_LABEL as FLAG_STATUS_LABEL } from "@/lib/flags/model";
import { cn } from "@/lib/utils";
import {
  draftFrom,
  validateRelease,
  type ReleaseDraft,
  type ReleaseField,
  type ReleaseValues,
} from "./form";
import { ReleaseFields } from "./release-fields";
import { RollbackDialog, ShipDialog } from "./ship-dialog";
import { STATUS_LABEL, dayLabel, nameOf, plannedWhen, shipTiming } from "./text";

const STATUS_BADGE: Record<Release["status"], string> = {
  planning: "bg-warning/10 text-warning border-warning/30",
  shipped: "bg-success/10 text-success border-success/30",
  rolled_back: "bg-danger/10 text-danger border-danger/30",
};

const AUTO_SOURCE: Record<"flags" | "dod", string> = {
  flags: "Feature Flag Tracker",
  dod: "Definition of Done",
};

export interface ReleaseCardProps {
  release: Release;
  results: readonly GateResult[];
  verdict: string;
  /** Flags in the Feature Flag Tracker that ship behind this release. */
  linkedFlags: readonly FeatureFlag[];
  today: string;
  /** The example is on screen: nothing is sent to another tool. */
  preview: boolean;
  /** Where its rollback went as a retro topic (read from the retro board). */
  retroLinks: readonly HandoffLink[];
  getRetroLinks: () => readonly HandoffLink[];
  onToggleGate: (r: Release, gateId: string, passed: boolean) => void;
  onShip: (r: Release, day: string) => void;
  onRollBack: (r: Release, day: string) => void;
  onReopen: (r: Release) => void;
  onSave: (r: Release, values: ReleaseValues) => void;
  onRemove: (r: Release) => void;
}

type Dialog = "ship" | "rollback" | null;

export function ReleaseCard({
  release: r,
  results,
  verdict,
  linkedFlags,
  today,
  preview,
  retroLinks,
  getRetroLinks,
  onToggleGate,
  onShip,
  onRollBack,
  onReopen,
  onSave,
  onRemove,
}: ReleaseCardProps) {
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the editor closes or the status changes under it.
  const returnTo = useRef<"edit" | "action" | null>(null);

  const name = nameOf(r);
  const passed = results.filter((g) => g.passed).length;
  const open = results.filter((g) => !g.passed);
  const pct = results.length === 0 ? 0 : (passed / results.length) * 100;
  const planning = r.status === "planning";

  useEffect(() => {
    if (editing || !returnTo.current) return;
    (returnTo.current === "edit" ? editRef : actionRef).current?.focus();
    returnTo.current = null;
  }, [editing, r.status]);

  if (editing) {
    return (
      <ReleaseEditor
        release={r}
        onSave={(values) => {
          onSave(r, values);
          returnTo.current = "edit";
          setEditing(false);
        }}
        onCancel={() => {
          returnTo.current = "edit";
          setEditing(false);
        }}
      />
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "space-y-3 rounded-lg border bg-card p-3 sm:p-4",
        r.status === "rolled_back" ? "border-danger/30" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3
            id={titleId}
            className="min-w-0 break-words text-sm font-semibold text-text sm:text-base"
          >
            {name}
          </h3>
          <Badge variant="outline" className={STATUS_BADGE[r.status]}>
            {STATUS_LABEL[r.status]}
          </Badge>
          <span className="font-data text-xs text-sub">
            {results.length === 0 ? "No gates" : `${passed} / ${results.length} gates`}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            ref={editRef}
            label={`Edit ${name}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={() => setEditing(true)}
          />
          <IconButton
            label={`Delete ${name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            data-release-delete={r.id}
            onClick={() => onRemove(r)}
          />
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
        <Meta term="Planned">
          {dayLabel(r.plannedDate, true)}
          {planning && <span className="text-sub"> ({plannedWhen(r.plannedDate, today)})</span>}
        </Meta>
        {r.shippedDate && (
          <Meta term="Shipped">
            {dayLabel(r.shippedDate, true)}
            <span className="text-sub"> ({shipTiming(r.shippedDate, r.plannedDate)})</span>
          </Meta>
        )}
        {r.status === "rolled_back" && (
          <Meta term="Rolled back">
            {r.rolledBackAt ? dayLabel(r.rolledBackAt, true) : "Day not recorded"}
          </Meta>
        )}
      </dl>
      {(r.previousShips ?? []).length > 0 && (
        <p className="text-xs text-sub">
          Earlier:{" "}
          {(r.previousShips ?? [])
            .map(
              (s) =>
                `shipped ${dayLabel(s.shippedDate)}${s.rolledBackAt ? `, rolled back ${dayLabel(s.rolledBackAt)}` : ""}`
            )
            .join("; ")}
          . Kept in the stats.
        </p>
      )}
      {r.description && (
        <p className="whitespace-pre-wrap break-words text-xs text-sub">{r.description}</p>
      )}

      <div
        className="h-1.5 overflow-hidden rounded-full bg-bg"
        role="progressbar"
        aria-label={`${name}: gates passed`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full transition-all", open.length === 0 ? "bg-success" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-sm text-text">{verdict}</p>

      {results.length > 0 && (
        <fieldset>
          <legend className="sr-only">Gates for {name}</legend>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((g) => (
              <li key={g.id} className="min-w-0">
                {planning ? (
                  <GateTick gate={g} onChange={(value) => onToggleGate(r, g.id, value)} />
                ) : (
                  <FrozenGate gate={g} />
                )}
              </li>
            ))}
          </ul>
          {!planning && (
            <p className="mt-2 text-xs text-sub">
              {r.gateIds
                ? "The gates as they stood when it shipped."
                : "Shipped before gates were kept per release: read against the built-in gates."}
            </p>
          )}
        </fieldset>
      )}

      {linkedFlags.length > 0 && (
        <p className="text-xs text-sub">
          Ships behind{" "}
          {linkedFlags.map((f, i) => (
            <span key={f.id}>
              {i > 0 && ", "}
              <span className="font-data text-text">{f.name || "unnamed flag"}</span> (
              {PURPOSE_LABEL[f.purpose].toLowerCase()}, {FLAG_STATUS_LABEL[f.status].toLowerCase()})
            </span>
          ))}
          .{" "}
          <Link
            href="/feature-flag-tracker"
            className="text-accent underline-offset-2 hover:underline"
          >
            Feature Flag Tracker
          </Link>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {planning && (
          <Button
            ref={actionRef}
            type="button"
            variant="toolkit"
            size="sm"
            className="gap-1"
            aria-label={`Ship ${name}`}
            onClick={() => setDialog("ship")}
          >
            <Rocket aria-hidden="true" />
            Ship
          </Button>
        )}
        {r.status === "shipped" && (
          <Button
            ref={actionRef}
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 text-danger hover:bg-danger/10 hover:text-danger"
            aria-label={`Mark ${name} rolled back`}
            onClick={() => setDialog("rollback")}
          >
            <Undo2 aria-hidden="true" />
            Mark rolled back
          </Button>
        )}
        {r.status === "rolled_back" && (
          <>
            <Button
              ref={actionRef}
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-warning hover:bg-warning/10 hover:text-warning"
              aria-label={`Reopen ${name} for planning`}
              onClick={() => {
                returnTo.current = "action";
                onReopen(r);
              }}
            >
              <RotateCcw aria-hidden="true" />
              Reopen for planning
            </Button>
            <SendToMenu
              routes={["retro-topic"]}
              disabled={preview}
              item={{
                title: `Rollback of ${name}`,
                description: verdict,
                sourceRef: { tool: "release-readiness", id: r.id, doc: RELEASE_DOC_ID },
              }}
              sentTo={retroLinks}
              getLinks={getRetroLinks}
              // The link is read back from the retro board, where the card lands.
              onLinksChange={() => undefined}
              itemLabels={{ "retro-topic": "Talk about it at the retro" }}
              className="h-8"
            />
          </>
        )}
        {planning && open.length > 0 && (
          <span className="text-xs text-sub">
            {open.length} gate{open.length === 1 ? "" : "s"} open
          </span>
        )}
      </div>

      <ShipDialog
        release={r}
        open={dialog === "ship"}
        onOpenChange={(o) => setDialog(o ? "ship" : null)}
        today={today}
        openGates={open}
        onShip={(day) => {
          returnTo.current = "action";
          onShip(r, day);
        }}
      />
      {r.status === "shipped" && (
        <RollbackDialog
          release={r}
          open={dialog === "rollback"}
          onOpenChange={(o) => setDialog(o ? "rollback" : null)}
          today={today}
          onRollBack={(day) => {
            returnTo.current = "action";
            onRollBack(r, day);
          }}
        />
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

/**
 * A gate on a release being planned. An auto gate says what its check
 * found and links to where it's fixed; when the check can tell, it decides
 * the tick, otherwise the gate is ticked by hand. The name and description
 * are the checkbox's label, so the whole tile ticks (a 16 px box alone is
 * too small a target on a phone); the check's line, with its link, sits
 * outside the label.
 */
function GateTick({ gate: g, onChange }: { gate: GateResult; onChange: (value: boolean) => void }) {
  const source = g.auto ? AUTO_SOURCE[g.auto] : null;
  const checkId = useId();
  return (
    <div
      className={cn(
        "h-full rounded-md border bg-bg p-2",
        g.passed ? "border-success/30" : "border-border",
        !g.locked && "hover:border-accent/30"
      )}
    >
      <label
        className={cn("flex items-start gap-2", g.locked ? "cursor-default" : "cursor-pointer")}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-success"
          checked={g.passed}
          disabled={g.locked}
          aria-label={g.label}
          aria-describedby={g.check ? checkId : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-text">{g.label}</span>
          {g.description && <span className="block text-xs text-sub">{g.description}</span>}
        </span>
      </label>
      {g.check && source && (
        <div id={checkId} className="mt-0.5 min-w-0 pl-6 text-xs">
          <span
            className={
              g.check.passed === null
                ? "text-sub"
                : g.check.passed
                  ? "text-success"
                  : "text-warning"
            }
          >
            {g.check.passed === null
              ? `${g.check.detail}: tick it by hand.`
              : `Checked from the ${source}: ${g.check.detail}.`}
          </span>{" "}
          <Link href={g.check.href} className="text-accent underline-offset-2 hover:underline">
            Open
            <span className="sr-only"> the {source}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/** A gate as it stood when the release shipped: read-only, with its result in words. */
function FrozenGate({ gate: g }: { gate: GateResult }) {
  return (
    <div className="flex h-full items-start gap-2 rounded-md border border-border bg-bg p-2">
      {g.passed ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-text">{g.label}</div>
        <div className="text-xs text-sub">{g.passed ? "Passed" : "Open at ship"}</div>
      </div>
    </div>
  );
}

/** Edit in place: the add form's fields with this release's values. Enter saves, Escape cancels. */
function ReleaseEditor({
  release,
  onSave,
  onCancel,
}: {
  release: Release;
  onSave: (values: ReleaseValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<ReleaseDraft, ReleaseValues, ReleaseField>({
    initial: () => draftFrom(release),
    validate: validateRelease,
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
        <ReleaseFields form={form} label={`Edit ${nameOf(release)}`} />
      </ItemForm>
    </div>
  );
}
