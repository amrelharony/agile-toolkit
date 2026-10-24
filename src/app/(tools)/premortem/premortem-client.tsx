"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { ArrowRight, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { generatePremortemPrompts } from "@/lib/ai-prompts/premortem";
import { plural } from "@/lib/charts/chart-text";
import { liveLink } from "@/lib/handoffs/registry";
import { sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { PREMORTEM_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { emit as sonify } from "@/lib/sonification/emit";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { dockOwnedBy, useDockTimer } from "@/lib/timer/dock-timer";
import { undoable } from "@/lib/utils/undoable";
import { PhaseStepper } from "./components/phase-stepper";
import {
  ActPanel,
  GroupPanel,
  VotePanel,
  WritePanel,
  type CauseActions,
} from "./components/phase-panels";
import { PremortemForm, type PremortemValues } from "./components/premortem-form";
import { EXAMPLE_PREMORTEM_ID, buildExample, withoutExample } from "./example";
import { linkOptions, linkText, resolveLink } from "./links";
import { toMarkdown } from "./markdown";
import {
  PHASE_HINT,
  PHASE_LABEL,
  PREMORTEM_PATH,
  PREMORTEM_PHASES,
  causeScore,
  mergeCause,
  patchCause,
  rankCauses,
  setVotes,
  splitCause,
  unmergeCause,
  updatePremortem,
  votesById,
  votesOf,
  withVotes,
  type Premortem,
  type PremortemCause,
  type PremortemPhase,
} from "./model";
import { usePremortems } from "./use-premortems";
import { premortemVerdict, quoteCause } from "./verdict";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm";

export function PremortemClient() {
  const { state, update, selected, select } = usePremortems();
  const { log } = useHistoryLogger("premortem");
  const announce = useAnnounce();
  const [creating, setCreating] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  // Read fresh by hand-off callbacks that run after a later render (Undo).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Which causes are in the Risk Register now (their risk wasn't deleted
  // since). Checked once per change: the rows, the verdict, the Send button
  // and the exports all ask, and each check reads the register's blob.
  const sentIds = useMemo(
    () =>
      new Set((selected?.causes ?? []).filter((c) => liveLink(c.sentTo, "risk")).map((c) => c.id)),
    [selected]
  );
  const isSent = useCallback((c: PremortemCause) => sentIds.has(c.id), [sentIds]);

  const releaseDocs = useWorkspaceStore((s) => s.releaseReadinesses);
  const epicDocs = useWorkspaceStore((s) => s.epicRoadmaps);
  const options = useMemo(() => linkOptions(releaseDocs, epicDocs), [releaseDocs, epicDocs]);

  // Which causes have already logged PREVENTION_ADDED, so the history
  // records the milestone once (empty → written), not on every blur. Seeded
  // from what is stored once it loads (usePersisted hydrates after mount),
  // so a reload doesn't log saved actions again.
  const preventionLoggedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || state.premortems.length === 0) return;
    for (const p of state.premortems) {
      for (const c of p.causes) {
        if (c.preventiveAction?.trim()) preventionLoggedRef.current.add(c.id);
      }
    }
    seededRef.current = true;
  }, [state.premortems]);

  const pid = selected?.id;
  const change = (id: string, fn: (p: Premortem) => Premortem) =>
    update((s) => updatePremortem(s, id, fn));
  const changeSelected = (fn: (p: Premortem) => Premortem) => {
    if (pid) change(pid, fn);
  };

  /* ── Premortems ──────────────────────────────────────────────────── */

  const startPremortem = (values: PremortemValues) => {
    const premortem: Premortem = {
      id: nanoid(10),
      title: values.title,
      scenario: values.scenario,
      ...(values.link ? { link: values.link } : {}),
      phase: "write",
      causes: [],
      createdAt: new Date().toISOString(),
    };
    update((s) => ({ ...s, premortems: [premortem, ...s.premortems] }));
    select(premortem.id);
    setCreating(false);
    log(PREMORTEM_ACTIONS.PREMORTEM_STARTED, {
      premortemId: premortem.id,
      title: premortem.title,
      linkedTo: premortem.link?.kind,
    });
    announce(`Started “${premortem.title}”. Phase 1 of 4: Write.`);
  };

  const saveDetails = (values: PremortemValues) => {
    changeSelected((p) => {
      const next: Premortem = { ...p, title: values.title, scenario: values.scenario };
      if (values.link) next.link = values.link;
      else delete next.link;
      return next;
    });
    setEditingDetails(false);
  };

  const removePremortem = (p: Premortem) => {
    const index = state.premortems.findIndex((x) => x.id === p.id);
    undoable({
      label: `Deleted the premortem “${p.title}”`,
      description: p.causes.length > 0 ? `${plural(p.causes.length, "cause")} with it.` : undefined,
      apply: () => {
        update((s) => ({ ...s, premortems: s.premortems.filter((x) => x.id !== p.id) }));
        setEditingDetails(false);
      },
      // Back in its slot (unless something already put it back).
      revert: () =>
        update((s) => {
          if (s.premortems.some((x) => x.id === p.id)) return s;
          const premortems = [...s.premortems];
          premortems.splice(Math.min(index, premortems.length), 0, p);
          return { ...s, premortems };
        }),
    });
  };

  const setPhase = (phase: PremortemPhase) => {
    if (!selected || selected.phase === phase) return;
    const from = selected.phase;
    changeSelected((p) => ({ ...p, phase }));
    log(PREMORTEM_ACTIONS.PHASE_ADVANCED, { premortemId: selected.id, from, to: phase });
    // The silent-writing clock has nothing left to time once writing is over.
    if (from === "write" && dockOwnedBy(PREMORTEM_PATH)) useDockTimer.getState().stop();
    const step = PREMORTEM_PHASES.indexOf(phase) + 1;
    announce(
      `Phase ${step} of ${PREMORTEM_PHASES.length}: ${PHASE_LABEL[phase]}. ${PHASE_HINT[phase]}`
    );
  };

  // The example is a premortem of its own, so it never mixes with the
  // user's. Loading isn't logged: it isn't the user's work.
  const loadExample = () => {
    const example = buildExample();
    for (const c of example.causes) {
      if (c.preventiveAction?.trim()) preventionLoggedRef.current.add(c.id);
    }
    update((s) => ({
      ...s,
      premortems: [example, ...s.premortems.filter((p) => p.id !== EXAMPLE_PREMORTEM_ID)],
    }));
    select(EXAMPLE_PREMORTEM_ID);
    setCreating(false);
  };

  const clearExample = () => {
    const removed = state.premortems
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => isExampleId(p.id));
    const keptId = nanoid(10);
    const { keptId: kept } = withoutExample(state, keptId);
    undoable({
      label: "Cleared the example",
      apply: () => {
        update((s) => withoutExample(s, keptId).state);
        if (kept && selected && isExampleId(selected.id)) select(kept);
      },
      // Each back in its slot, with the user's own causes back inside it
      // (unless something already put it back).
      revert: () => {
        update((s) => {
          const premortems = s.premortems.filter((p) => p.id !== kept);
          for (const { p, index } of removed) {
            if (!premortems.some((x) => x.id === p.id)) {
              premortems.splice(Math.min(index, premortems.length), 0, p);
            }
          }
          return { ...s, premortems };
        });
        if (kept) select(removed[0]?.p.id ?? kept);
      },
    });
  };

  /* ── Causes ──────────────────────────────────────────────────────── */

  const addCause = (text: string) => {
    if (!pid) return;
    const cause: PremortemCause = { id: nanoid(8), text, createdAt: new Date().toISOString() };
    change(pid, (p) => ({ ...p, causes: [...p.causes, cause] }));
    log(PREMORTEM_ACTIONS.CAUSE_ADDED, { premortemId: pid, causeId: cause.id });
    sonify("premortem", "cause-added");
  };

  /** The cause's links, read fresh and written back, for a hand-off and its Undo. */
  const linksOf = (premortemId: string, causeId: string): HandoffLinkStore => ({
    getLinks: (): readonly HandoffLink[] | undefined =>
      stateRef.current.premortems
        .find((p) => p.id === premortemId)
        ?.causes.find((c) => c.id === causeId)?.sentTo,
    setLinks: (change) =>
      update((s) =>
        updatePremortem(s, premortemId, (p) => ({
          ...p,
          causes: p.causes.map((c) => (c.id === causeId ? { ...c, sentTo: change(c.sentTo) } : c)),
        }))
      ),
  });

  const actions: CauseActions = {
    // A description only changes when the editor showed it; "" removes it.
    edit: (id, next) =>
      changeSelected((p) =>
        patchCause(
          p,
          id,
          next.description === undefined
            ? { text: next.text }
            : { text: next.text, description: next.description || undefined }
        )
      ),
    remove: (id) => {
      if (!selected) return;
      const premortemId = selected.id;
      const index = selected.causes.findIndex((c) => c.id === id);
      const cause = selected.causes[index];
      if (!cause) return;
      const preventionLogged = preventionLoggedRef.current.has(id);
      undoable({
        label: `Removed ${quoteCause(cause, 40)}`,
        apply: () => {
          preventionLoggedRef.current.delete(id);
          change(premortemId, (p) => ({ ...p, causes: p.causes.filter((c) => c.id !== id) }));
          log(PREMORTEM_ACTIONS.CAUSE_REMOVED, { premortemId, causeId: id, text: cause.text });
        },
        // Back in its slot (unless something already put it back).
        revert: () => {
          if (preventionLogged) preventionLoggedRef.current.add(id);
          change(premortemId, (p) => {
            if (p.causes.some((c) => c.id === id)) return p;
            const causes = [...p.causes];
            causes.splice(Math.min(index, causes.length), 0, cause);
            return { ...p, causes };
          });
        },
      });
    },
    merge: (sourceId, targetId) => {
      if (!selected) return;
      const premortemId = selected.id;
      const index = selected.causes.findIndex((c) => c.id === sourceId);
      const source = selected.causes[index];
      const target = selected.causes.find((c) => c.id === targetId);
      if (!source || !target) return;
      undoable({
        label: `Grouped ${quoteCause(source, 30)} with ${quoteCause(target, 30)}`,
        apply: () => change(premortemId, (p) => mergeCause(p, sourceId, targetId)),
        revert: () => change(premortemId, (p) => unmergeCause(p, source, targetId, index)),
      });
    },
    split: (id) => {
      const cause = selected?.causes.find((c) => c.id === id);
      if (!cause?.merged?.length) return;
      changeSelected((p) => splitCause(p, id));
      announce(
        `Split ${quoteCause(cause, 40)}: ${plural(cause.merged.length, "cause")} back on the list.`
      );
    },
    vote: (id, votes) => {
      const cause = selected?.causes.find((c) => c.id === id);
      if (!selected || !cause) return;
      const next = Math.max(0, votes);
      if (next === votesOf(cause)) return;
      changeSelected((p) => setVotes(p, id, next));
      log(PREMORTEM_ACTIONS.CAUSE_VOTED, { premortemId: selected.id, causeId: id, votes: next });
      announce(`${quoteCause(cause, 40)}: ${plural(next, "vote")}.`);
    },
    rate: (id, patch) =>
      changeSelected((p) =>
        patchCause(p, id, {
          ...("likelihood" in patch ? { likelihood: patch.likelihood ?? undefined } : {}),
          ...("impact" in patch ? { impact: patch.impact ?? undefined } : {}),
        })
      ),
    setPrevention: (id, text) => {
      if (!selected) return;
      changeSelected((p) =>
        patchCause(p, id, { preventiveAction: text.trim() ? text : undefined })
      );
      if (!text.trim() || preventionLoggedRef.current.has(id)) return;
      preventionLoggedRef.current.add(id);
      const cause = selected.causes.find((c) => c.id === id);
      log(PREMORTEM_ACTIONS.PREVENTION_ADDED, {
        premortemId: selected.id,
        causeId: id,
        owner: cause?.owner,
      });
    },
    setOwner: (id, owner) =>
      changeSelected((p) => patchCause(p, id, { owner: owner || undefined })),
    links: (id) => linksOf(pid ?? "", id),
    isSent,
  };

  /** One toast and one Undo for the lot; each cause records its risk. */
  const sendTop = (causes: PremortemCause[]) => {
    if (!selected) return;
    const premortemId = selected.id;
    const sent = sendHandoffBatch(
      "risk",
      causes.map((c) => ({
        src: {
          title: c.text,
          description: c.description,
          owner: c.owner,
          likelihood: c.likelihood,
          impact: c.impact,
          mitigation: c.preventiveAction,
          sourceRef: { tool: "premortem", id: c.id, doc: premortemId },
        },
        links: linksOf(premortemId, c.id),
      })),
      causes.length === 1
        ? "Added 1 risk to the Risk Register"
        : `Added ${causes.length} risks to the Risk Register`
    );
    if (sent.length === 0) return;
    log(PREMORTEM_ACTIONS.RISKS_SENT, {
      premortemId,
      count: sent.length,
      causeIds: causes.map((c) => c.id),
    });
    // The "premortem complete" achievement listens for this.
    sonify("premortem", "completed");
    announce(`${plural(sent.length, "risk")} added to the Risk Register.`);
  };

  /* ── Results ─────────────────────────────────────────────────────── */

  // The votes as this render shows them. "Clear votes" confirms from this
  // render, so its Undo puts back the votes as they were before the clear.
  const votesBefore = selected ? votesById(selected) : new Map<string, number>();

  const link = selected ? resolveLink(selected.link, options) : null;
  const ranked = useMemo(() => (selected ? rankCauses(selected.causes) : []), [selected]);
  const markdown = selected ? toMarkdown(selected, { link, isSent }) : "";

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  // The prompts need numbers: unrated causes would read as 0 × 0, so only
  // the rated ones go in.
  const promptConfig = useMemo(
    () => ({
      toolName: "Premortem Facilitator",
      prompts: generatePremortemPrompts(
        {
          scenario: selected?.scenario ?? "",
          causes: ranked
            .filter((c) => causeScore(c) !== null)
            .map((c) => ({
              text: c.text,
              description: c.description,
              likelihood: c.likelihood as number,
              impact: c.impact as number,
              preventiveAction: c.preventiveAction,
              owner: c.owner,
            })),
        },
        workspace
      ),
    }),
    [selected, ranked, workspace]
  );

  const none = state.premortems.length === 0;
  const showNewForm = creating || none;

  return (
    <ToolPageWrapper
      toolId="premortem"
      title="Premortem Facilitator"
      description="Imagine this project failed — what would have caused it? Write silently, group, vote, and turn the top causes into risks with preventive actions."
      category="Risk & Governance"
    >
      {hasExampleItems(state.premortems) && <ExampleNotice onClear={clearExample} />}

      {none && (
        <EmptyState
          icon={ScrollText}
          className="mb-4"
          action={<LoadExampleButton onLoad={loadExample} />}
        >
          No premortem yet. Start one for a release or epic: imagine it has failed, then find out
          why while there is still time.
        </EmptyState>
      )}

      {!none && selected && (
        <ActionRow
          left={
            <Field label="Premortem" className="min-w-0 sm:w-80">
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={selected.id}
                  onChange={(e) => {
                    select(e.target.value);
                    setEditingDetails(false);
                  }}
                >
                  {state.premortems.map((p) => {
                    const l = resolveLink(p.link, options);
                    return (
                      <option key={p.id} value={p.id}>
                        {l ? `${p.title} · ${linkText(l)}` : p.title}
                      </option>
                    );
                  })}
                </select>
              )}
            </Field>
          }
        >
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="premortem"
            csvData={{
              headers: [
                "Rank",
                "Cause",
                "Description",
                "Grouped duplicates",
                "Votes",
                "Likelihood",
                "Impact",
                "Score",
                "Preventive Action",
                "Owner",
                "Risk Register",
              ],
              rows: ranked.map((c, i) => [
                i + 1,
                c.text,
                c.description ?? "",
                (c.merged ?? []).map((m) => m.text).join("; "),
                votesOf(c),
                c.likelihood ?? "",
                c.impact ?? "",
                causeScore(c) ?? "",
                c.preventiveAction ?? "",
                c.owner ?? "",
                isSent(c) ? "Added" : "",
              ]),
            }}
            jsonData={selected}
            markdown={markdown}
          />
          {!creating && (
            <Button
              type="button"
              variant="outline"
              className="gap-1"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New premortem
            </Button>
          )}
        </ActionRow>
      )}

      {showNewForm && (
        <SectionCard title="New premortem" icon={Plus} className="mb-4">
          <PremortemForm
            options={options}
            onSave={startPremortem}
            onCancel={none ? undefined : () => setCreating(false)}
          />
        </SectionCard>
      )}

      {selected && (
        <>
          <SectionCard
            title={selected.title}
            icon={ScrollText}
            titleSuffix={link ? linkText(link) : undefined}
            className="mb-4"
            actions={
              !editingDetails && (
                <>
                  <IconButton
                    label={`Edit the details of “${selected.title}”`}
                    icon={<Pencil className="h-4 w-4" />}
                    className="text-sub hover:text-text"
                    onClick={() => setEditingDetails(true)}
                  />
                  <IconButton
                    label={`Delete the premortem “${selected.title}”`}
                    icon={<Trash2 className="h-4 w-4" />}
                    className="text-sub hover:text-danger"
                    onClick={() => removePremortem(selected)}
                  />
                </>
              )
            }
          >
            {editingDetails ? (
              <PremortemForm
                key={selected.id}
                options={options}
                premortem={selected}
                onSave={saveDetails}
                onCancel={() => setEditingDetails(false)}
              />
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-sub">
                  Imagined failure
                </p>
                <p className="whitespace-pre-line break-words text-sm text-text">
                  {selected.scenario.trim() || "Not described yet. Edit the details to add it."}
                </p>
              </div>
            )}
          </SectionCard>

          <PhaseStepper phase={selected.phase} onChange={setPhase} />

          <SectionCard
            title={`${PREMORTEM_PHASES.indexOf(selected.phase) + 1}. ${PHASE_LABEL[selected.phase]}`}
            className="mb-4"
          >
            <p className="mb-4 text-sm font-medium text-text">
              {premortemVerdict(selected, isSent)}
            </p>
            {selected.causes.length === 0 && selected.phase !== "write" ? (
              <EmptyState
                icon={ScrollText}
                padding="md"
                action={
                  hasExampleItems(state.premortems) ? undefined : (
                    <LoadExampleButton onLoad={loadExample} label="See an example premortem" />
                  )
                }
              >
                No causes yet. Go back to Write and add the reasons it failed.
              </EmptyState>
            ) : (
              <PhasePanel
                key={`${selected.id}:${selected.phase}`}
                premortem={selected}
                actions={actions}
                onAdd={addCause}
                onSendTop={sendTop}
                onDots={(dots) =>
                  changeSelected((p) => {
                    const next = { ...p, dotsPerPerson: dots };
                    if (dots === undefined) delete next.dotsPerPerson;
                    return next;
                  })
                }
                onClearVotes={() => changeSelected((p) => withVotes(p, new Map()))}
                onRestoreVotes={() => changeSelected((p) => withVotes(p, votesBefore))}
              />
            )}
            <NextPhase phase={selected.phase} onNext={setPhase} />
          </SectionCard>
        </>
      )}
    </ToolPageWrapper>
  );
}

/** The panel for the phase the premortem is in. */
function PhasePanel({
  premortem,
  actions,
  onAdd,
  onSendTop,
  onDots,
  onClearVotes,
  onRestoreVotes,
}: {
  premortem: Premortem;
  actions: CauseActions;
  onAdd: (text: string) => void;
  onSendTop: (causes: PremortemCause[]) => void;
  onDots: (dots: number | undefined) => void;
  onClearVotes: () => void;
  onRestoreVotes: () => void;
}) {
  switch (premortem.phase) {
    case "write":
      return <WritePanel premortem={premortem} onAdd={onAdd} actions={actions} />;
    case "group":
      return <GroupPanel premortem={premortem} actions={actions} />;
    case "vote":
      return (
        <VotePanel
          premortem={premortem}
          actions={actions}
          onDots={onDots}
          onClearVotes={onClearVotes}
          onRestoreVotes={onRestoreVotes}
        />
      );
    case "act":
      return <ActPanel premortem={premortem} actions={actions} onSendTop={onSendTop} />;
  }
}

/** "Next: Group", at the end of every phase but the last. */
function NextPhase({
  phase,
  onNext,
}: {
  phase: PremortemPhase;
  onNext: (phase: PremortemPhase) => void;
}) {
  const next = PREMORTEM_PHASES[PREMORTEM_PHASES.indexOf(phase) + 1];
  if (!next) return null;
  return (
    <div className="mt-4 flex justify-end border-t border-border pt-4">
      <Button type="button" variant="toolkit" className="gap-2" onClick={() => onNext(next)}>
        {`Next: ${PHASE_LABEL[next]}`}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}
