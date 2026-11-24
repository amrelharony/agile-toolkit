"use client";

/**
 * The open charter template's form. The Templates row loads this module
 * with next/dynamic when a template opens (or a pointer or focus reaches its
 * button), so the four forms, Team Time's fields and its people reader stay
 * out of the page's first load. Here Team Time's rows become the people the
 * forms read, and focus goes to the form's first field.
 */

import { useMemo, useRef } from "react";
import type { CharterTemplateId, TeamMember, WorkingAgreement } from "@/lib/stores/workspace-types";
import { personName } from "@/lib/team-time/format";
import { readPeople } from "@/lib/team-time/model";
import { isExampleId } from "@/lib/utils/example-id";
import {
  appliedValues,
  templateDefaults,
  type TemplateValuesById,
} from "@/lib/working-agreement/templates";
import {
  AiUseForm,
  CoreHoursForm,
  FocusTimeForm,
  UrgencyLadderForm,
  useFocusOnOpen,
  type TeamTimeView,
} from "./template-forms";

/** What the page passes of Team Time: its rows as stored, the roster that names them, now and this browser's zone. */
export interface TeamTimeSource {
  people: readonly unknown[];
  roster: readonly Pick<TeamMember, "id" | "name">[];
  now: Date;
  zone: string;
}

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

/** Team Time's people as the forms read them (never its example), each under the roster's name. */
export function teamTimeView(source: TeamTimeSource): TeamTimeView {
  return {
    people: readPeople(source.people)
      .filter((p) => !isExampleId(p.id))
      .map((p) => ({ ...p, name: personName(p, source.roster) })),
    now: source.now,
    zone: source.zone,
  };
}

export function TemplateForm({
  doc,
  open,
  openKey,
  fillOnOpen,
  teamTime: source,
  onApply,
  onCancel,
}: {
  doc: WorkingAgreement;
  open: CharterTemplateId;
  /** Changes each time a form is opened, so it starts again from its answers. */
  openKey: number;
  /** The form came from a link that asks to fill core hours from Team Time. */
  fillOnOpen: boolean;
  teamTime: TeamTimeSource;
  onApply: <Id extends CharterTemplateId>(id: Id, values: TemplateValuesById[Id]) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Runs once the module has loaded and the form is drawn, and again for each new opening.
  useFocusOnOpen(ref, `${open}:${openKey}`);
  const teamTime = useMemo(() => teamTimeView(source), [source]);

  return (
    <div ref={ref}>
      {open === "urgency-ladder" && (
        <UrgencyLadderForm
          key={openKey}
          doc={doc}
          initial={startingValues(doc, "urgency-ladder", teamTime.zone)}
          teamTime={teamTime}
          onApply={(v) => onApply("urgency-ladder", v)}
          onCancel={onCancel}
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
          onCancel={onCancel}
        />
      )}
      {open === "focus-time" && (
        <FocusTimeForm
          key={openKey}
          doc={doc}
          initial={startingValues(doc, "focus-time", teamTime.zone)}
          teamTime={teamTime}
          onApply={(v) => onApply("focus-time", v)}
          onCancel={onCancel}
        />
      )}
      {open === "ai-use" && (
        <AiUseForm
          key={openKey}
          doc={doc}
          initial={startingValues(doc, "ai-use", teamTime.zone)}
          teamTime={teamTime}
          onApply={(v) => onApply("ai-use", v)}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}
