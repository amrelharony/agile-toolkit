"use client";

import { useRef } from "react";
import { CheckCircle2, LayoutTemplate } from "lucide-react";
import type { CharterTemplateId, WorkingAgreement } from "@/lib/stores/workspace-types";
import {
  CHARTER_TEMPLATES,
  appliedValues,
  templateDefaults,
  templateRuleIds,
  type TemplateValuesById,
} from "@/lib/working-agreement/templates";
import { dayLabel } from "@/lib/working-agreement/model";
import { cn } from "@/lib/utils";
import {
  AiUseForm,
  CoreHoursForm,
  FocusTimeForm,
  UrgencyLadderForm,
  useFocusOnOpen,
  type TeamTimeView,
} from "./template-forms";

/** The answers a template's form opens with: what it was applied with, else its defaults. */
export function startingValues<Id extends CharterTemplateId>(
  doc: WorkingAgreement,
  id: Id,
  zone: string
): TemplateValuesById[Id] {
  const stored = appliedValues(doc, id);
  if (!stored) return templateDefaults(id, { timeZone: zone });
  const { appliedAt, ...values } = stored;
  void appliedAt;
  return values as unknown as TemplateValuesById[Id];
}

/** The id the Templates row gives each template's button, so a rule card's "Edit in template" can come back to it. */
export const templateButtonId = (id: CharterTemplateId) => `wa-template-${id}`;

/**
 * The Templates row of "Add a rule": the four charter templates, each with
 * whether the charter has it, and the open one's form (one at a time). A
 * template's form shows the rules it writes before anything is saved.
 */
export function TemplatesPanel({
  doc,
  open,
  openKey,
  fillOnOpen,
  teamTime,
  onOpen,
  onApply,
}: {
  doc: WorkingAgreement;
  open: CharterTemplateId | null;
  /** Changes each time a form is opened, so it starts again from its answers. */
  openKey: number;
  /** The open form came from a link that asks to fill core hours from Team Time. */
  fillOnOpen: boolean;
  teamTime: TeamTimeView;
  onOpen: (id: CharterTemplateId | null) => void;
  onApply: <Id extends CharterTemplateId>(id: Id, values: TemplateValuesById[Id]) => void;
}) {
  const formRef = useRef<HTMLDivElement>(null);
  useFocusOnOpen(formRef, open ? `${open}:${openKey}` : null);
  const close = () => {
    const id = open;
    onOpen(null);
    if (id) requestAnimationFrame(() => document.getElementById(templateButtonId(id))?.focus());
  };

  return (
    <section aria-labelledby="wa-templates" className="mt-4 space-y-3">
      <div>
        <h3 id="wa-templates" className="flex items-center gap-2 text-sm font-medium text-text">
          <LayoutTemplate className="h-4 w-4 text-sub" aria-hidden="true" />
          Templates
        </h3>
        <p className="text-xs text-sub">
          Answer a few questions and the rules are written for you. Apply again to change them.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {CHARTER_TEMPLATES.map((t) => {
          const stored = appliedValues(doc, t.id);
          const rules = templateRuleIds(doc, t.id).length;
          const isOpen = open === t.id;
          return (
            <li key={t.id}>
              <button
                id={templateButtonId(t.id)}
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? "wa-template-form" : undefined}
                onClick={() => (isOpen ? close() : onOpen(t.id))}
                className={cn(
                  "flex min-h-11 w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  isOpen
                    ? "border-accent/60 bg-accent/10"
                    : "border-border bg-bg hover:border-accent/40 hover:bg-accent/5"
                )}
              >
                <span className="flex w-full items-center gap-2 text-sm font-medium text-text">
                  <span className="flex-1">{t.name}</span>
                  {stored && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      In the charter
                    </span>
                  )}
                </span>
                <span className="text-xs text-sub">
                  {stored
                    ? `${rules === 1 ? "1 rule" : `${rules} rules`}${
                        stored.appliedAt ? `, applied ${dayLabel(stored.appliedAt)}` : ""
                      }`
                    : t.summary}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <div id="wa-template-form" ref={formRef}>
          {open === "urgency-ladder" && (
            <UrgencyLadderForm
              key={openKey}
              doc={doc}
              initial={startingValues(doc, "urgency-ladder", teamTime.zone)}
              teamTime={teamTime}
              onApply={(v) => onApply("urgency-ladder", v)}
              onCancel={close}
            />
          )}
          {open === "core-hours" && (
            <CoreHoursForm
              key={openKey}
              doc={doc}
              initial={startingValues(doc, "core-hours", teamTime.zone)}
              teamTime={teamTime}
              fillOnOpen={fillOnOpen}
              onApply={(v) => onApply("core-hours", v)}
              onCancel={close}
            />
          )}
          {open === "focus-time" && (
            <FocusTimeForm
              key={openKey}
              doc={doc}
              initial={startingValues(doc, "focus-time", teamTime.zone)}
              teamTime={teamTime}
              onApply={(v) => onApply("focus-time", v)}
              onCancel={close}
            />
          )}
          {open === "ai-use" && (
            <AiUseForm
              key={openKey}
              doc={doc}
              initial={startingValues(doc, "ai-use", teamTime.zone)}
              teamTime={teamTime}
              onApply={(v) => onApply("ai-use", v)}
              onCancel={close}
            />
          )}
        </div>
      )}
    </section>
  );
}
