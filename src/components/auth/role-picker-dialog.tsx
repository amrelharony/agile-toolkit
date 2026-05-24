"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SCRUM_ROLES, SCRUM_ROLE_LABEL, type ScrumRole } from "@/lib/auth/types";
import { ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface RolePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRole: ScrumRole | null;
  onSave: (role: ScrumRole) => Promise<void>;
}

const ROLE_HELP: Record<ScrumRole, string> = {
  scrum_master: "Facilitates ceremonies, removes blockers, coaches the team.",
  product_owner: "Owns the backlog, sets priorities, writes stories.",
  developer: "Builds the product. Estimates, codes, tests, ships.",
  tester: "Quality gate. Test plans, exploratory testing, automation.",
  stakeholder: "Customer or sponsor. Watches metrics, reviews releases.",
};

export function RolePickerDialog({
  open,
  onOpenChange,
  currentRole,
  onSave,
}: RolePickerDialogProps) {
  const [selected, setSelected] = useState<ScrumRole | null>(currentRole);
  const [saving, setSaving] = useState(false);
  // BUG-X1: surface save errors instead of silently closing. The prior
  // implementation called `onOpenChange(false)` unconditionally in the
  // finally, so a Supabase error inside onSave (network blip, RLS
  // failure) closed the dialog and the user thought the role saved.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sync the local selection when the dialog opens with a different
  // currentRole (e.g., parent updated the user's role outside this dialog,
  // then reopened). Without this, the dialog reflects the role the user
  // had when the component was first mounted — stale.
  useEffect(() => {
    if (open) {
      setSelected(currentRole);
      setSaveError(null);
    }
  }, [open, currentRole]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(selected);
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save role.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />
            Welcome to the team
          </DialogTitle>
          <DialogDescription>
            Pick the role that best fits your work. We use this to tailor insights and history
            filters — you can change it anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 my-2">
          {SCRUM_ROLES.map((role) => {
            const isSelected = selected === role;
            return (
              <button
                key={role}
                type="button"
                onClick={() => setSelected(role)}
                aria-pressed={isSelected}
                className={cn(
                  "text-left rounded-lg border p-3 transition-all duration-fast",
                  isSelected
                    ? "border-accent bg-accent/5 ring-1 ring-accent/40"
                    : "border-border hover:border-accent/30 hover:bg-accent/5"
                )}
              >
                <div className="font-medium text-text">{SCRUM_ROLE_LABEL[role]}</div>
                <div className="text-xs text-sub mt-0.5">{ROLE_HELP[role]}</div>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2 text-xs text-sub bg-[var(--card)] border border-border rounded-md p-3">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-accent" aria-hidden="true" />
          <p>
            Signed-in history is stored privately in your Supabase project. Card text, standup
            notes, and impediment titles are saved verbatim. You can delete everything from the user
            menu →<span className="font-medium"> Privacy &amp; data</span>.
          </p>
        </div>

        {saveError && (
          <div
            role="alert"
            className="rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-sm p-2 mt-2"
          >
            {saveError}
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={!selected || saving}>
            {saving ? "Saving…" : "Save role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
