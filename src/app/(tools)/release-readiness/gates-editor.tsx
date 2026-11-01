"use client";

/**
 * The team's gate list: the nine built-ins until the team changes it, then
 * its own. Gates can be added, renamed and described in place, moved up or
 * down, and archived (with Undo); an archived gate leaves the releases
 * being planned but stays named on the releases that shipped with it, and
 * can be restored. "Add the Definition of Done gate" offers the gate the
 * DoD Builder checks. Shipped releases never change: they keep the gates
 * frozen on them when they shipped.
 *
 * Focus follows the gate being changed: a moved gate keeps it on the same
 * button (or its other move button, once it reaches an end), a rename hands
 * it back to the gate's Rename, and an archived or restored gate passes it
 * to the next one in its list (or the Add gate field).
 */

import { useEffect, useRef, useState } from "react";
import { Archive, ArrowDown, ArrowUp, ListChecks, Pencil, Plus, RotateCcw } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { ReleaseGateDef } from "@/lib/stores/workspace-types";
import { DOD_GATE } from "@/lib/releases/gates";
import { newGateId } from "@/lib/releases/auto-gates";
import { undoable } from "@/lib/utils/undoable";
import { EMPTY_GATE, validateGate, type GateDraft, type GateField, type GateValues } from "./form";

const AUTO_BADGE: Record<"flags" | "dod", string> = {
  flags: "Auto: feature flags",
  dod: "Auto: Definition of Done",
};

/** Where focus goes after a change: the first of these still on screen and enabled. */
type FocusTry = [gateId: string | null, selector: string];

export interface GatesEditorProps {
  /** The stored list in order, archived gates included. */
  gates: readonly ReleaseGateDef[];
  /** Change the list (from the stored one, the built-ins until the team edits it). */
  setGates: (fn: (list: ReleaseGateDef[]) => ReleaseGateDef[]) => void;
  /** Log and announce a change: "Added “Smoke test”". */
  onChanged: (what: string) => void;
}

export function GatesEditor({ gates, setGates, onChanged }: GatesEditorProps) {
  const active = gates.filter((g) => !g.archived);
  const archived = gates.filter((g) => g.archived);
  const [editing, setEditing] = useState<string | null>(null);
  const hasDod = gates.find((g) => g.id === DOD_GATE.id);
  const rootRef = useRef<HTMLDivElement>(null);

  // A move re-orders the focused row and can disable the button pressed;
  // a rename unmounts it; an archive or restore removes the row. Each
  // change says where focus goes next, and it lands once React re-renders.
  const follow = useRef<FocusTry[] | null>(null);
  useEffect(() => {
    const tries = follow.current;
    if (!tries) return;
    follow.current = null;
    const root = rootRef.current;
    for (const [id, selector] of tries) {
      const scope =
        id === null
          ? root
          : Array.from(root?.querySelectorAll<HTMLElement>("[data-gate]") ?? []).find(
              (el) => el.getAttribute("data-gate") === id
            );
      const el = scope?.querySelector<HTMLElement>(`${selector}:not(:disabled)`);
      if (el) {
        el.focus();
        return;
      }
    }
  });

  const patch = (id: string, change: Partial<ReleaseGateDef>) =>
    setGates((list) => list.map((g) => (g.id === id ? { ...g, ...change } : g)));

  /** The gate after `g` in `list`, else the one before it. */
  const neighbour = (list: readonly ReleaseGateDef[], g: ReleaseGateDef) => {
    const at = list.findIndex((x) => x.id === g.id);
    return list[at + 1] ?? list[at - 1];
  };

  /** Swap a gate with its neighbour among the active ones. */
  const move = (id: string, by: -1 | 1) => {
    const [dir, other] = by < 0 ? ["up", "down"] : ["down", "up"];
    follow.current = [
      [id, `[data-move="${dir}"]`],
      [id, `[data-move="${other}"]`],
    ];
    setGates((list) => {
      const shown = list.filter((g) => !g.archived);
      const at = shown.findIndex((g) => g.id === id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= shown.length) return list;
      const a = list.indexOf(shown[at]);
      const b = list.indexOf(shown[to]);
      const next = [...list];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    const g = active.find((x) => x.id === id);
    if (g) onChanged(`Moved “${g.label}” ${by < 0 ? "up" : "down"}`);
  };

  const archive = (g: ReleaseGateDef) => {
    const near = neighbour(active, g);
    follow.current = [
      ...(near ? ([[near.id, "[data-archive]"]] as FocusTry[]) : []),
      [null, "[data-add-gate]"],
    ];
    undoable({
      label: `Archived “${g.label}”`,
      description: "Releases being planned no longer check it; shipped ones keep it.",
      apply: () => patch(g.id, { archived: true }),
      revert: () => patch(g.id, { archived: undefined }),
    });
    onChanged(`Archived “${g.label}”`);
  };

  const restore = (g: ReleaseGateDef) => {
    const near = neighbour(archived, g);
    follow.current = [
      ...(near ? ([[near.id, "[data-restore]"]] as FocusTry[]) : []),
      [g.id, "[data-rename]"],
    ];
    patch(g.id, { archived: undefined });
    onChanged(`Restored “${g.label}”`);
  };

  const rename = (g: ReleaseGateDef, v: GateValues | null) => {
    follow.current = [[g.id, "[data-rename]"]];
    setEditing(null);
    if (!v || (v.label === g.label && (v.description ?? "") === (g.description ?? ""))) return;
    patch(g.id, { label: v.label, description: v.description });
    onChanged(`Renamed the gate “${v.label}”`);
  };

  const add = (v: GateValues) => {
    const gate: ReleaseGateDef = {
      id: newGateId(
        v.label,
        gates.map((g) => g.id)
      ),
      label: v.label,
      ...(v.description ? { description: v.description } : {}),
    };
    setGates((list) => [...list, gate]);
    onChanged(`Added the gate “${gate.label}”`);
  };

  const addDod = () => {
    if (hasDod) restore(hasDod);
    else {
      // The button goes once the gate is on the list: focus moves to the gate.
      follow.current = [[DOD_GATE.id, "[data-rename]"]];
      setGates((list) => [...list, { ...DOD_GATE }]);
      onChanged(`Added the gate “${DOD_GATE.label}”`);
    }
  };

  const form = useItemForm<GateDraft, GateValues, GateField>({
    initial: EMPTY_GATE,
    validate: (d) =>
      validateGate(
        d,
        active.map((g) => g.label)
      ),
    onSave: add,
  });

  return (
    <div ref={rootRef} className="space-y-4">
      <p className="text-sm text-sub">
        Releases being planned check these, in this order. A shipped release keeps the gates it
        shipped with, so changing the list never rewrites history.
      </p>
      <ol
        className="divide-y divide-border rounded-lg border border-border bg-card"
        aria-label="Gates, in order"
      >
        {active.map((g, i) => (
          <li key={g.id} data-gate={g.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
            <span className="mt-1 w-5 shrink-0 text-right font-data text-xs text-sub">
              {i + 1}.
            </span>
            <div className="min-w-0 flex-1 basis-48">
              {editing === g.id ? (
                <GateEditor
                  gate={g}
                  // The add form's rule: no two gates on the list share a name.
                  taken={active.filter((x) => x.id !== g.id).map((x) => x.label)}
                  onSave={(v) => rename(g, v)}
                  onCancel={() => rename(g, null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text">{g.label}</span>
                    {g.auto && (
                      <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                        {AUTO_BADGE[g.auto]}
                      </Badge>
                    )}
                  </div>
                  {g.description && <p className="text-xs text-sub">{g.description}</p>}
                </>
              )}
            </div>
            {editing !== g.id && (
              <div className="flex shrink-0 items-center">
                <IconButton
                  label={`Move ${g.label} up`}
                  icon={<ArrowUp className="h-4 w-4" />}
                  data-move="up"
                  disabled={i === 0}
                  onClick={() => move(g.id, -1)}
                />
                <IconButton
                  label={`Move ${g.label} down`}
                  icon={<ArrowDown className="h-4 w-4" />}
                  data-move="down"
                  disabled={i === active.length - 1}
                  onClick={() => move(g.id, 1)}
                />
                <IconButton
                  label={`Rename ${g.label}`}
                  icon={<Pencil className="h-4 w-4" />}
                  data-rename
                  onClick={() => setEditing(g.id)}
                />
                <IconButton
                  label={`Archive ${g.label}`}
                  icon={<Archive className="h-4 w-4" />}
                  className="text-sub hover:text-danger"
                  data-archive
                  onClick={() => archive(g)}
                />
              </div>
            )}
          </li>
        ))}
        {active.length === 0 && (
          <li className="px-3 py-4 text-sm text-sub">
            No gates. Add one below, or restore an archived one.
          </li>
        )}
      </ol>

      <ItemForm
        form={form}
        submitLabel="Add gate"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        footer={
          !hasDod || hasDod.archived ? (
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addDod}>
              <ListChecks aria-hidden="true" />
              Add the Definition of Done gate
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="New gate" error={form.errors.label} required>
            {(props) => (
              <Input
                {...props}
                data-add-gate
                value={form.draft.label}
                onChange={(e) => form.update({ label: e.target.value })}
                placeholder="e.g. Smoke test in staging"
              />
            )}
          </Field>
          <Field label="What passing means" error={form.errors.description}>
            {(props) => (
              <Input
                {...props}
                value={form.draft.description}
                onChange={(e) => form.update({ description: e.target.value })}
                placeholder="e.g. The checkout journey passes end to end"
              />
            )}
          </Field>
        </div>
      </ItemForm>

      {archived.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text">Archived ({archived.length})</h3>
          <ul className="space-y-1">
            {archived.map((g) => (
              <li
                key={g.id}
                data-gate={g.id}
                className="flex flex-wrap items-center gap-2 text-sm text-sub"
              >
                <span className="min-w-0 flex-1">{g.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  aria-label={`Restore ${g.label}`}
                  data-restore
                  onClick={() => restore(g)}
                >
                  <RotateCcw aria-hidden="true" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Rename or re-describe a gate in place, with the add form's checks: a name,
 * not one another gate on the list has, errors inline. Enter saves, Escape
 * cancels.
 */
function GateEditor({
  gate,
  taken,
  onSave,
  onCancel,
}: {
  gate: ReleaseGateDef;
  taken: readonly string[];
  onSave: (values: GateValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<GateDraft, GateValues, GateField>({
    initial: () => ({ label: gate.label, description: gate.description ?? "" }),
    validate: (d) => validateGate(d, taken),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    const name = formRef.current?.querySelector<HTMLInputElement>("input");
    name?.focus();
    name?.select();
  }, [formRef]);
  return (
    <div role="group" aria-label={`Edit gate ${gate.label}`}>
      <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Gate name" error={form.errors.label} required>
            {(props) => (
              <Input
                {...props}
                value={form.draft.label}
                onChange={(e) => form.update({ label: e.target.value })}
              />
            )}
          </Field>
          <Field label="What passing means" error={form.errors.description}>
            {(props) => (
              <Input
                {...props}
                value={form.draft.description}
                onChange={(e) => form.update({ description: e.target.value })}
              />
            )}
          </Field>
        </div>
      </ItemForm>
    </div>
  );
}
