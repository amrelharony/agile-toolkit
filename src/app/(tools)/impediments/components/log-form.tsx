"use client";

/**
 * Collapsible "Log New Impediment" form. Collapsed it's a single button;
 * expanded it captures title/description/category/severity/owners plus a
 * predicted "expected resolution days" via SmartInput. Submitting writes to
 * the store, sonifies, logs IMPEDIMENT_RAISED, and resets.
 */

import { useId, useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SmartInput } from "@/components/shared/smart-input";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { IMPEDIMENT_ACTIONS } from "@/lib/history/event-actions";
import type { Category, Severity } from "../types";
import { useImpedimentStore } from "../use-impediment-store";

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "Technical" as Category,
  severity: "Medium" as Severity,
  raisedBy: "",
  assignedTo: "",
  expectedResolutionDays: undefined as number | undefined,
};

export function LogForm() {
  const { addImpediment } = useImpedimentStore();
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const uid = useId();
  const { log } = useHistoryLogger("impediments");
  const expectedResolutionPrediction = usePredictedDefault<number>(
    "impediments",
    "expectedResolutionDays",
    3
  );

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    sonify("impediments", "impediment-raised");
    // Stored trimmed, like the check above and the history entry below.
    addImpediment({
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      raisedBy: form.raisedBy.trim(),
      assignedTo: form.assignedTo.trim(),
    });
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_RAISED, {
      title: form.title.trim(),
      category: form.category,
      severity: form.severity,
      assignedTo: form.assignedTo || null,
    });
    setForm(EMPTY_FORM);
    setOpen(false);
  };

  if (!open) {
    return (
      <Button variant="toolkit" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        Log Impediment
      </Button>
    );
  }

  return (
    <SectionCard
      title="Log New Impediment"
      icon={AlertTriangle}
      iconClassName="text-accent-amber"
      actions={
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          aria-label="Close form"
          className="min-touch-coarse h-7 w-7 text-sub hover:text-text"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </Button>
      }
      contentClassName="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-title`} className="text-sub text-xs">
          Title *
        </Label>
        <Input
          id={`${uid}-title`}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Short description of the impediment"
          className="input-toolkit"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-description`} className="text-sub text-xs">
          Description
        </Label>
        <Textarea
          id={`${uid}-description`}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Provide context and impact details..."
          rows={3}
          className="bg-surface-deep border-border text-text resize-none focus:border-accent/50"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-category`} className="text-sub text-xs">
            Category
          </Label>
          <Select
            value={form.category}
            onValueChange={(v) => setForm({ ...form, category: v as Category })}
          >
            <SelectTrigger
              id={`${uid}-category`}
              className="bg-surface-deep border-border text-text"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              {(["Technical", "Organizational", "External", "Process"] as Category[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-severity`} className="text-sub text-xs">
            Severity
          </Label>
          <Select
            value={form.severity}
            onValueChange={(v) => setForm({ ...form, severity: v as Severity })}
          >
            <SelectTrigger
              id={`${uid}-severity`}
              className="bg-surface-deep border-border text-text"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              {(["Low", "Medium", "High", "Critical"] as Severity[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-raisedBy`} className="text-sub text-xs">
            Raised By
          </Label>
          <Input
            id={`${uid}-raisedBy`}
            value={form.raisedBy}
            onChange={(e) => setForm({ ...form, raisedBy: e.target.value })}
            placeholder="Name / Role"
            className="input-toolkit"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-assignedTo`} className="text-sub text-xs">
            Assigned To
          </Label>
          <Input
            id={`${uid}-assignedTo`}
            value={form.assignedTo}
            onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
            placeholder="Name / Role"
            className="input-toolkit"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-days`} className="text-sub text-xs">
            Expected Resolution (days)
          </Label>
          <SmartInput<number>
            predicted={expectedResolutionPrediction}
            onAccept={(value) => setForm((f) => ({ ...f, expectedResolutionDays: value }))}
            render={({ ghost, accept, chip }) => (
              <div className="flex flex-col gap-1">
                <Input
                  id={`${uid}-days`}
                  type="number"
                  min={1}
                  value={form.expectedResolutionDays ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const n = Number(v);
                    // Cap at 3650 days (~10 years) so a stray keystroke
                    // (e.g. typing 99999999) doesn't bloat the persisted
                    // store or break downstream forecasting helpers that
                    // assume "reasonable" lead times.
                    setForm((f) => ({
                      ...f,
                      expectedResolutionDays:
                        v === ""
                          ? undefined
                          : Number.isFinite(n)
                            ? Math.min(3650, Math.max(1, n))
                            : f.expectedResolutionDays,
                    }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && form.expectedResolutionDays === undefined && ghost) {
                      e.preventDefault();
                      accept();
                    }
                  }}
                  placeholder={ghost ?? "e.g. 3"}
                  className="input-toolkit"
                />
                {form.expectedResolutionDays === undefined && chip}
              </div>
            )}
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          variant="toolkit"
          onClick={handleSubmit}
          disabled={!form.title.trim()}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          Log Impediment
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setForm(EMPTY_FORM);
            setOpen(false);
          }}
          className="text-sub hover:text-text hover:bg-cardH"
        >
          Cancel
        </Button>
      </div>
    </SectionCard>
  );
}
