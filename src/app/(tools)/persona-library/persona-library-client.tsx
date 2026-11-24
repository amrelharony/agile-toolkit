"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { Contact, Plus } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { useItemForm } from "@/components/shared/item-form";
import {
  OnSearchParams,
  dropSearchParam,
  dropSearchParams,
} from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { focusAfterClearingExample } from "@/components/tool-frame/after-clear-example";
import { generatePersonaLibraryPrompts } from "@/lib/ai-prompts/persona-library";
import type { PersonaFromNotesOutput } from "@/lib/ai/tasks/persona-library.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { PERSONA_LIBRARY_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { UI_ID } from "@/lib/interviews/model";
import { nameAwayFromParticipants } from "@/lib/personas/interviews";
import {
  EVIDENCE_LABEL,
  LIST_ONE,
  NO_FILTERS,
  PERSONA_ID_PREFIX,
  PERSONA_POINTS_MAX,
  PERSONA_ROLE_MAX,
  TIER_LABEL,
  allTags,
  defaultTier,
  duplicateOf,
  linkedInterviews,
  matchesFilters,
  readPersonas,
  usedOnMaps,
  type PersonaFilters,
  type PersonaList,
} from "@/lib/personas/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Interview,
  Persona,
  StrategyMap,
  UserInterviewLog,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import {
  emptyFields,
  fieldsOf,
  hasTyped,
  personaFromValues,
  sameFields,
  validatePersona,
  withDraft,
  type PersonaField,
  type PersonaFields,
  type PersonaValues,
} from "./form";
import { personasMarkdown } from "./markdown";
import { PersonaCard } from "./persona-card";
import { PersonaFiltersBar } from "./persona-filters";
import { PersonaForm } from "./persona-form";
import { currentPersonas, findPersona, removePersona, savePersona } from "./store";

export const TOOL_ID = "persona-library";

const NO_MAPS: StrategyMap[] = [];
const NO_LOGS: UserInterviewLog[] = [];
const NO_INTERVIEWS: Interview[] = [];

const nowIso = () => new Date().toISOString();
const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Focus the element `find` returns once React has re-rendered. */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const el = find();
    el?.scrollIntoView?.({ block: "nearest" });
    el?.focus();
  });
}
const byData = (attr: string, value: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
    (e) => e.getAttribute(attr) === value
  );
const nameInput = () =>
  document.querySelector<HTMLElement>("[data-persona-form] form input:not([type=checkbox])");

/** A fresh add form, read from the store as it is now. */
const freshFields = () => emptyFields(defaultTier(readPersonas(currentPersonas())));

/**
 * Persona Library: the people a team builds for, as personas with goals,
 * frustrations and habits, a tier (main, also served, not for us) and how
 * much of it is researched. A persona can be drafted from pasted notes or
 * from picked interviews of the User Interview Log (Amr, or keyword rules
 * without AI), with the contact details redactPii spots and the participant
 * names taken out first (best effort: the page says what can get through);
 * the draft only fills the form, and nothing is saved until Save. Each card
 * says which Impact Maps use it and how many interviews it is based on.
 * Everything lives in workspace.personas, which Amr's verbs and the next
 * step read too. No history payload carries a persona's text.
 */
export function PersonaLibraryClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.personas);
  const maps = useWorkspaceStore((s) => s.strategyMaps) ?? NO_MAPS;
  const logs = useWorkspaceStore((s) => s.userInterviewLogs) ?? NO_LOGS;
  const interviews = logs.find((d) => d.id === UI_ID)?.interviews ?? NO_INTERVIEWS;
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();

  const personas = useMemo(() => readPersonas(raw), [raw]);
  const [filters, setFilters] = useState<PersonaFilters>(NO_FILTERS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftedBy, setDraftedBy] = useState<AiSource | null>(null);
  /** The Impact Map a `?fromMap=&actor=` link came from: its actor, and after Save the way back. */
  const [fromMap, setFromMap] = useState<{ mapId: string; actor: string; map: string } | null>(
    null
  );
  const [savedFor, setSavedFor] = useState<{ mapId: string; name: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<URLSearchParams | null>(null);
  /** Bumped on every reset, so an Undo of a removed point can't land in another persona's form. */
  const session = useRef(0);

  const visible = personas.filter((p) => matchesFilters(p, filters));
  const tags = useMemo(() => allTags(personas), [personas]);
  const editing = editingId ? (personas.find((p) => p.id === editingId) ?? null) : null;

  // The example's changes aren't the team's history.
  const record = (personaId: string, action: string, payload: Record<string, unknown> = {}) => {
    if (!isExampleId(personaId)) log(action, { personaId, ...payload });
  };

  const save = (values: PersonaValues) => {
    const at = nowIso();
    const prev = editingId ? (findPersona(editingId) ?? null) : null;
    const persona = personaFromValues(values, prev, `${PERSONA_ID_PREFIX}${nanoid(8)}`, at);
    savePersona(persona);
    if (prev) {
      record(persona.id, PERSONA_LIBRARY_ACTIONS.PERSONA_UPDATED);
      announce(`Saved “${short(persona.name)}”.`);
    } else {
      record(persona.id, PERSONA_LIBRARY_ACTIONS.PERSONA_CREATED, {
        tier: persona.tier,
        evidence: persona.evidence,
      });
      announce(`Added “${short(persona.name)}” to the library.`);
    }
    setSavedFor(fromMap && !prev ? { mapId: fromMap.mapId, name: persona.name } : null);
    setFromMap(null);
    setEditingId(null);
    setDraftedBy(null);
    session.current++;
    if (filters !== NO_FILTERS && !matchesFilters(persona, filters)) setFilters(NO_FILTERS);
    setOpenId(persona.id);
    focusSoon(() => byData("data-persona-card", persona.id));
  };

  const form = useItemForm<PersonaFields, PersonaValues, PersonaField>({
    initial: freshFields,
    validate: validatePersona,
    onSave: save,
  });
  // The form as it is now, for an Undo that lands after more typing.
  const draftRef = useRef(form.draft);
  draftRef.current = form.draft;

  // Which persona the form edits now, for an Undo that comes after a later change.
  const editingRef = useRef(editingId);
  editingRef.current = editingId;

  const resetForm = (next?: PersonaFields) => {
    session.current++;
    setDraftedBy(null);
    form.reset(next ?? freshFields());
  };

  /**
   * Replaces the form (Edit on a card, a `?fromMap=` link) by running
   * `change`. When the form held something not saved, what was typed in a
   * new persona or the changes to the one being edited, Undo puts it back:
   * over the form `change` opened, or a blank add form, never over other
   * work in progress.
   */
  const replaceForm = (change: () => void) => {
    const draft = draftRef.current;
    const was = { editingId, fromMap, draftedBy };
    const unsaved = editing ? !sameFields(draft, fieldsOf(editing)) : hasTyped(draft);
    if (!unsaved) {
      change();
      return;
    }
    const name = draft.name.trim();
    let opened = -1;
    undoable({
      label: editing
        ? `Left your changes to “${short(editing.name)}” unsaved`
        : name
          ? `Left “${short(name)}” unsaved`
          : "Left a new persona unsaved",
      apply: () => {
        change();
        opened = session.current;
      },
      revert: () => {
        const blank = editingRef.current === null && !hasTyped(draftRef.current);
        if (session.current !== opened && !blank) return;
        setEditingId(was.editingId && findPersona(was.editingId) ? was.editingId : null);
        setFromMap(was.fromMap);
        setSavedFor(null);
        session.current++;
        form.reset(draft);
        setDraftedBy(was.draftedBy);
        focusSoon(nameInput);
      },
    });
  };

  const startEdit = (p: Persona) =>
    replaceForm(() => {
      setEditingId(p.id);
      setFromMap(null);
      setSavedFor(null);
      resetForm(fieldsOf(p));
      focusSoon(nameInput);
    });

  const cancelEdit = () => {
    const id = editingId;
    setEditingId(null);
    setFromMap(null);
    resetForm();
    if (id) focusSoon(() => byData("data-focus-key", `edit:${id}`));
  };

  const remove = (p: Persona) => {
    const used = usedOnMaps(p, maps).length;
    if (editingId === p.id) {
      setEditingId(null);
      resetForm();
    }
    const ids = visible.map((x) => x.id);
    const at = ids.indexOf(p.id);
    const next = ids[at + 1] ?? ids[at - 1];
    let removed: Persona | null = null;
    undoable({
      label: `Deleted “${short(p.name)}”`,
      description:
        used > 0
          ? `The Impact Map actor${used === 1 ? " keeps its" : "s keep their"} own words.`
          : undefined,
      apply: () => {
        removed = removePersona(p.id);
        if (removed) record(p.id, PERSONA_LIBRARY_ACTIONS.PERSONA_REMOVED);
      },
      revert: () => {
        if (removed && !findPersona(removed.id)) savePersona(removed);
      },
    });
    focusSoon(() =>
      next ? byData("data-focus-key", `edit:${next}`) : byData("data-persona-add", "1")
    );
  };

  const addPoint = (list: PersonaList, point: string): string | null => {
    const items = draftRef.current[list];
    if (items.length >= PERSONA_POINTS_MAX) return `Full: ${PERSONA_POINTS_MAX} is the most.`;
    if (items.some((x) => x.toLowerCase() === point.toLowerCase())) return "Already on the list.";
    const s = session.current;
    undoable({
      label: `Added ${LIST_ONE[list]} “${short(point)}”`,
      kind: "success",
      apply: () =>
        form.update({ [list]: [...draftRef.current[list], point] } as Partial<PersonaFields>),
      // Only from the form it was added to, and only while it is still there.
      revert: () => {
        if (session.current !== s) return;
        const cur = draftRef.current[list];
        if (!cur.includes(point)) return;
        form.update({
          [list]: cur.filter((x) => x !== point),
        } as Partial<PersonaFields>);
      },
    });
    return null;
  };

  const removePoint = (list: PersonaList, index: number) => {
    const item = draftRef.current[list][index];
    if (item === undefined) return;
    const s = session.current;
    undoable({
      label: `Removed ${LIST_ONE[list]} “${short(item)}”`,
      apply: () =>
        form.update({
          [list]: draftRef.current[list].filter((_, i) => i !== index),
        } as Partial<PersonaFields>),
      revert: () => {
        if (session.current !== s) return;
        const cur = draftRef.current[list];
        if (cur.length >= PERSONA_POINTS_MAX || cur.some((x) => x === item)) return;
        const at = Math.min(index, cur.length);
        form.update({
          [list]: [...cur.slice(0, at), item, ...cur.slice(at)],
        } as Partial<PersonaFields>);
      },
    });
  };

  const takeDraft = (data: PersonaFromNotesOutput, source: AiSource, interviewIds: string[]) => {
    // The interviewees' real names never go to Amr, so a draft can land on
    // one by chance: it gets a made-up name instead.
    const name = nameAwayFromParticipants(
      data.name,
      interviews,
      personas.map((p) => p.name)
    );
    const before = draftRef.current;
    const draftedBefore = draftedBy;
    const { fields } = withDraft(before, { ...data, name }, { interviewIds });
    const s = session.current;
    undoable({
      label:
        source === "ai" ? "Amr drafted a persona into the form" : "Drafted a persona into the form",
      kind: "success",
      apply: () => {
        form.update(fields);
        setDraftedBy(source);
      },
      // The form as it was before the draft, unless it has been reset since.
      revert: () => {
        if (session.current !== s) return;
        form.reset(before);
        setDraftedBy(draftedBefore);
        focusSoon(nameInput);
      },
    });
    log(PERSONA_LIBRARY_ACTIONS.PERSONA_DRAFTED, {
      source: source === "ai" ? "ai" : "rules",
      interviews: interviewIds.length,
    });
    announce(
      `${source === "ai" ? "Amr drafted" : "Drafted without AI"} a persona into the form. Check it, then save.`
    );
    focusSoon(nameInput);
  };

  /* ── Links: ?persona=<id>, ?fromMap=<map>&actor=<node> ──────────────── */

  const onParams = (params: URLSearchParams) => {
    if (params.has("persona") || (params.has("fromMap") && params.has("actor"))) {
      setPending(new URLSearchParams(params.toString()));
    }
  };

  useEffect(() => {
    if (!pending || !hydrated) return;
    setPending(null);
    const personaId = pending.get("persona");
    const mapId = pending.get("fromMap");
    const actorId = pending.get("actor");
    if (personaId) {
      dropSearchParam("persona");
      if (personas.some((p) => p.id === personaId)) {
        setFilters(NO_FILTERS);
        setOpenId(personaId);
        focusSoon(() => byData("data-persona-card", personaId));
      } else {
        announce("That persona isn't in the library any more.");
      }
      return;
    }
    if (mapId && actorId) {
      dropSearchParams(["fromMap", "actor"]);
      const map = maps.find((m) => m.id === mapId);
      const actor = map?.nodes.find((n) => n.id === actorId);
      if (!map || !actor) {
        announce("That Impact Map actor isn't there any more. Add the persona here.");
        return;
      }
      replaceForm(() => {
        setEditingId(null);
        setSavedFor(null);
        setFromMap({ mapId, actor: actor.text, map: map.title });
        resetForm({ ...freshFields(), role: actor.text.slice(0, PERSONA_ROLE_MAX) });
        focusSoon(nameInput);
      });
    }
    // personas and maps are read as they are when the link is acted on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, hydrated]);

  /* ── Example ────────────────────────────────────────────────────────── */

  const loadExample = () => {
    for (const p of buildExample(new Date())) savePersona(p);
  };
  const clearExample = () => {
    let removed: Persona[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentPersonas()
          .filter((p) => isExampleId(p.id))
          .map((p) => removePersona(p.id))
          .filter((p): p is Persona => p !== null);
      },
      revert: () => {
        for (const p of removed) if (!findPersona(p.id)) savePersona(p);
      },
    });
    if (editingId && isExampleId(editingId)) cancelEdit();
    focusAfterClearingExample();
  };

  const markdown = useMemo(
    () => personasMarkdown(personas, interviews, new Date()),
    [personas, interviews]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Persona Library",
      prompts: generatePersonaLibraryPrompts({
        personas: personas.map((p) => ({
          name: p.name,
          role: p.role,
          tier: TIER_LABEL[p.tier],
          evidence: EVIDENCE_LABEL[p.evidence],
          goals: p.goals,
          pains: p.pains,
          behaviours: p.behaviours,
        })),
      }),
    }),
    [personas]
  );

  const PAGE = {
    title: "Persona Library",
    description:
      "Keep the people you build for as personas: goals, frustrations and habits, drafted from interviews, used on Impact Maps.",
    category: "Design Thinking & UX",
  } as const;

  const duplicate = duplicateOf(form.draft.name, personas, editingId ?? undefined);

  return (
    <ToolPageWrapper toolId="persona-library" {...PAGE}>
      <OnSearchParams onChange={onParams} />
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading your personas…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExampleItems(personas) && <ExampleNotice onClear={clearExample} />}

          {personas.length === 0 ? (
            <EmptyState icon={Contact} action={<LoadExampleButton onLoad={loadExample} />}>
              No personas yet. Add the people you build for below, draft one from your interview
              notes, or load an example library.
            </EmptyState>
          ) : (
            <SectionCard
              title={`Personas (${personas.length})`}
              icon={Contact}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="personas"
                    markdown={markdown}
                    clipboardText={markdown}
                    jsonData={personas}
                  />
                </>
              }
            >
              <div className="space-y-4">
                <PersonaFiltersBar
                  filters={filters}
                  onChange={setFilters}
                  tags={tags}
                  shown={visible.length}
                  total={personas.length}
                />
                {visible.length === 0 ? (
                  <p className="text-sm text-sub">No persona matches these filters.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {visible.map((p) => (
                      <PersonaCard
                        key={p.id}
                        persona={p}
                        usedOn={usedOnMaps(p, maps)}
                        basedOn={linkedInterviews(p, interviews).length}
                        highlighted={openId === p.id}
                        onEdit={() => startEdit(p)}
                        onRemove={() => remove(p)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          )}

          {savedFor && (
            <p
              role="status"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-text"
            >
              Saved “{savedFor.name}”. Pick it for the actor on the map.
              <Link
                href={`/impact-map?map=${encodeURIComponent(savedFor.mapId)}`}
                className="font-medium text-accent underline-offset-2 hover:underline"
              >
                Back to the Impact Map
              </Link>
            </p>
          )}

          <section data-persona-add="1" tabIndex={-1} className="outline-none">
            <SectionCard
              title={editing ? `Edit “${short(editing.name)}”` : "Add a persona"}
              icon={Plus}
            >
              <PersonaForm
                key={editingId ?? "add"}
                form={form}
                submitLabel={editing ? "Save persona" : "Add persona"}
                onCancel={editing ? cancelEdit : undefined}
                duplicateName={duplicate?.name}
                interviews={interviews}
                names={personas.map((p) => p.name)}
                draftedBy={draftedBy}
                forActor={fromMap ? { actor: fromMap.actor, map: fromMap.map } : null}
                onDraft={takeDraft}
                onAddPoint={addPoint}
                onRemovePoint={removePoint}
              />
            </SectionCard>
          </section>
        </div>
      )}
    </ToolPageWrapper>
  );
}
