"use client";

/**
 * "Log impediment": a button that opens the form. Nothing is saved until
 * the title and severity are set and the dates make sense; a failed save
 * shows what's missing and focuses it. Enter saves, Escape closes.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import {
  emptyDraft,
  validateImpediment,
  type ImpedimentDraft,
  type ImpedimentField,
  type ImpedimentValues,
} from "../form";
import { ImpedimentFields } from "./impediment-fields";

export function LogForm({
  today,
  typicalDays,
  onAdd,
}: {
  today: string;
  /** The team's average days to resolve, offered as a due date. */
  typicalDays: number | null;
  onAdd: (values: ImpedimentValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const reopenFocus = useRef(false);
  const form = useItemForm<ImpedimentDraft, ImpedimentValues, ImpedimentField>({
    initial: () => emptyDraft(today),
    validate: (d) => validateImpediment(d, today),
    onSave: (values) => {
      onAdd(values);
      close();
    },
  });
  const { formRef, reset } = form;

  function close() {
    setOpen(false);
    reset();
    reopenFocus.current = true;
  }

  // Open on the title; closed, back to the button that opened it.
  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLElement>("input")?.focus();
    else if (reopenFocus.current) {
      reopenFocus.current = false;
      openerRef.current?.focus();
    }
  }, [open, formRef]);

  if (!open) {
    return (
      <Button ref={openerRef} variant="toolkit" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Log impediment
      </Button>
    );
  }

  return (
    <SectionCard
      title="Log an impediment"
      icon={AlertTriangle}
      iconClassName="text-warning"
      className="w-full"
    >
      <ItemForm
        form={form}
        submitLabel="Log impediment"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={close}
      >
        <ImpedimentFields form={form} today={today} typicalDays={typicalDays} />
      </ItemForm>
    </SectionCard>
  );
}
