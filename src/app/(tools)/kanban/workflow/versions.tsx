"use client";

import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { KanbanColumnId, WorkflowVersion } from "@/lib/stores/workspace-types";
import {
  COMPARE_WEEKS,
  WORKFLOW_TEXT_MAX,
  WORKFLOW_VERSIONS_MAX,
  compareVersion,
  versionChanges,
  withSavedVersion,
  type CompareSide,
  type CompareWeeks,
} from "@/lib/kanban/workflow";
import type { FlowItem } from "@/lib/flow/types";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import { cheer } from "@/lib/celebrate/cheer";
import { todayIso } from "@/lib/sprints/series";
import type { Validation } from "@/lib/utils/form";
import { TextField } from "./fields";
import type { WorkflowController } from "./use-workflow";

interface VersionDraft {
  note: string;
  expect: string;
}

const EMPTY: VersionDraft = { note: "", expect: "" };
const TOO_LONG = `Keep it under ${WORKFLOW_TEXT_MAX + 1} characters.`;

export function validateVersion(
  d: VersionDraft
): Validation<{ note?: string; expect?: string }, "note" | "expect"> {
  const note = d.note.trim();
  const expect = d.expect.trim();
  const errors: Partial<Record<"note" | "expect", string>> = {};
  if (note.length > WORKFLOW_TEXT_MAX) errors.note = TOO_LONG;
  if (expect.length > WORKFLOW_TEXT_MAX) errors.expect = TOO_LONG;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { ...(note ? { note } : {}), ...(expect ? { expect } : {}) } };
}

/** "12 Nov 2026" */
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const WEEK_OPTIONS = COMPARE_WEEKS.map((w) => ({
  value: String(w),
  label: `${w} weeks`,
}));

/**
 * Versions: save the workflow as a numbered version (with what changed and
 * what the team expects), then compare the described board's flow before
 * and after any version was saved.
 */
export function Versions({
  controller,
  wipLimits,
  items,
  log,
}: {
  controller: WorkflowController;
  wipLimits: Record<KanbanColumnId, number>;
  /** The described board's items. */
  items: readonly FlowItem[];
  log: (action: string, payload: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const def = controller.def;
  const versions = def?.versions ?? [];
  const [comparing, setComparing] = useState<number | null>(null);

  const form = useItemForm<VersionDraft, { note?: string; expect?: string }, "note" | "expect">({
    initial: EMPTY,
    validate: validateVersion,
    onSave: (values) => {
      const cur = controller.current();
      if (!cur) return;
      const number = (cur.versions ?? []).reduce((m, v) => Math.max(m, v.version), 0) + 1;
      const saved = controller.save(
        (c) => (c ? withSavedVersion(c, values, wipLimits).def : null),
        `Saved version ${number}`
      );
      if (!saved) return;
      if (!controller.example) {
        log(KANBAN_ACTIONS.WORKFLOW_VERSION_SAVED, { version: number });
        cheer("kanban", "milestone");
      }
      announce(`Saved version ${number} of the workflow.`);
    },
  });

  return (
    <div className="space-y-4">
      {def ? (
        <ItemForm form={form} submitLabel="Save as version">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="What changed"
              placeholder="e.g. Review WIP down to 2"
              value={form.draft.note}
              max={WORKFLOW_TEXT_MAX}
              error={form.errors.note}
              onChange={(v) => form.update({ note: v })}
            />
            <TextField
              label="What we expect to change"
              placeholder="e.g. Shorter cycle time"
              value={form.draft.expect}
              max={WORKFLOW_TEXT_MAX}
              error={form.errors.expect}
              onChange={(v) => form.update({ expect: v })}
            />
          </div>
          <p className="text-xs text-sub">
            A version keeps the workflow and the board&apos;s WIP limits as they are now (the latest{" "}
            {WORKFLOW_VERSIONS_MAX} are kept).
          </p>
        </ItemForm>
      ) : (
        <p className="text-sm text-sub">
          Save the Definition of Workflow first, then save versions of it as it changes.
        </p>
      )}

      {versions.length > 0 && (
        <ol className="space-y-3" aria-label="Saved versions">
          {[...versions].reverse().map((v) => {
            const i = versions.indexOf(v);
            const changes = versionChanges(versions[i - 1]?.snapshot, v.snapshot);
            return (
              <li key={v.version} className="rounded-lg border border-border p-3">
                <VersionRow
                  version={v}
                  changes={changes}
                  open={comparing === v.version}
                  onToggle={() => setComparing((c) => (c === v.version ? null : v.version))}
                />
                {comparing === v.version && (
                  <Compare controller={controller} version={v.version} items={items} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function VersionRow({
  version: v,
  changes,
  open,
  onToggle,
}: {
  version: WorkflowVersion;
  changes: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <History className="h-4 w-4 text-sub" aria-hidden="true" />
        <span className="font-medium text-text">Version {v.version}</span>
        <span className="text-sub">saved {dayText(v.savedAt)}</span>
      </p>
      {v.note && <p className="break-words text-sm text-text">{v.note}</p>}
      {v.expect && (
        <p className="break-words text-sm text-sub">
          <span className="font-medium text-text">Expected:</span> {v.expect}
        </p>
      )}
      {changes.length > 0 && (
        <p className="break-words text-xs text-sub">Changed: {changes.join(" · ")}</p>
      )}
      <Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={onToggle}>
        Compare before and after
        <span className="sr-only"> version {v.version}</span>
      </Button>
    </div>
  );
}

const days = (n: number | null) => (n === null ? "—" : `${n} ${n === 1 ? "day" : "days"}`);
const num = (n: number | null) => (n === null ? "—" : String(n));

function Compare({
  controller,
  version,
  items,
}: {
  controller: WorkflowController;
  version: number;
  items: readonly FlowItem[];
}) {
  const [weeks, setWeeks] = useState<CompareWeeks>(4);
  const result = useMemo(
    () => compareVersion(controller.def, items, { version, weeks, today: todayIso() }),
    [controller.def, items, version, weeks]
  );
  if (!result) return null;
  const rows: [string, (s: CompareSide) => string][] = [
    ["Median cycle time", (s) => days(s.median)],
    ["85% within", (s) => days(s.p85)],
    ["Finished per week", (s) => num(s.throughputPerWeek)],
    ["Average WIP", (s) => num(s.avgWip)],
  ];
  return (
    <div className="mt-3 space-y-3">
      <ToggleGroup
        label="Weeks either side"
        size="sm"
        value={String(weeks)}
        onValueChange={(v) => setWeeks(Number(v) as CompareWeeks)}
        options={WEEK_OPTIONS}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-sm">
          <caption className="sr-only">
            Flow {weeks} weeks before and after version {version} was saved
          </caption>
          <thead>
            <tr className="text-left text-xs text-sub">
              <th scope="col" className="py-1 pr-2 font-medium">
                Measure
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Before
              </th>
              <th scope="col" className="py-1 font-medium">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label} className="border-t border-border">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-sub">
                  {label}
                </th>
                <td className="py-1.5 pr-2 font-data text-text">{cell(result.before)}</td>
                <td className="py-1.5 font-data text-text">{cell(result.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.cutShort && (
        <p className="text-xs text-sub">
          The after window has {result.after.days} of {weeks * 7} days so far: it ends today.
        </p>
      )}
      {!result.before.enough && (
        <NotEnoughData
          have={result.before.finished}
          need="distribution"
          unit={["finished item", "finished items"]}
          action="Need"
          what="cycle time before the change"
        />
      )}
      {!result.after.enough && (
        <NotEnoughData
          have={result.after.finished}
          need="distribution"
          unit={["finished item", "finished items"]}
          action="Finish"
          what="cycle time after the change"
        />
      )}
    </div>
  );
}
