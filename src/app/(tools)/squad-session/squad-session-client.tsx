"use client";

import { useEffect, useState } from "react";
import Link from "@/components/motion/transition-link";
import { useRouter } from "next/navigation";
import { BookOpenText, ListChecks, Play, Send, Trash2, Users } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EpisodeNotes } from "@/app/(tools)/comics/components/episode-notes";
import { RightsNotice } from "@/app/(tools)/comics/components/rights-notice";
import { durationText } from "@/app/(tools)/ceremony-timer/agenda";
import { StepTimerPanel } from "@/app/(tools)/liberating-structures/components/step-timer-panel";
import { useReturnFocus } from "@/hooks/use-return-focus";
import type { BookEpisode } from "@/lib/comics/book-episodes";
import { liveLink } from "@/lib/handoffs/registry";
import { sendHandoffBatch } from "@/lib/handoffs/send";
import type { HandoffLink, HandoffSource } from "@/lib/handoffs/types";
import { useDockTimer } from "@/lib/timer/dock-timer";
import { currentStep, runSeconds } from "@/lib/timer/step-timer";
import { removeWithUndo } from "@/lib/utils/undoable";
import { EXAMPLE_EP, buildExample } from "./example";
import { toMarkdown, type SessionEpisode } from "./markdown";
import {
  SESSION_STEPS,
  SQUAD_SESSION_PATH,
  advanceSession,
  runIsLive,
  startSession,
  stopSession,
  useSquadRun,
} from "./session";
import {
  EMPTY_ACTION,
  normalizeActions,
  setActions,
  useSquadSessionStore,
  validateAction,
  type ActionDraft,
  type SquadAction,
} from "./store";

/** The retro-action hand-off, as every tool sends it. */
function handoffSource(action: SquadAction): HandoffSource {
  return {
    title: action.title,
    owner: action.owner || undefined,
    sourceRef: { tool: "squad-session", id: action.id, doc: String(action.ep) },
  };
}

function updateLinks(
  id: string,
  fn: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): void {
  setActions((list) => list.map((a) => (a.id === id ? { ...a, sentTo: fn(a.sentTo) } : a)));
}

const linksOf = (id: string): HandoffLink[] | undefined =>
  normalizeActions(useSquadSessionStore.getState().actions).find((a) => a.id === id)?.sentTo;

/**
 * A timed 15-minute team session on one episode of the book: read the story in
 * the book, discuss its question, agree actions, and send those to Retro
 * Actions. The book's episodes are never put online, so it runs on their
 * printed text.
 */
export function SquadSessionClient({
  episodes,
  ep,
}: {
  episodes: readonly BookEpisode[];
  /** The episode in the address, if any. */
  ep: number | null;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const { refFor, returnTo } = useReturnFocus();

  // ── Saved actions ─────────────────────────────────────────
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void Promise.resolve(useSquadSessionStore.persist.rehydrate()).finally(() => setHydrated(true));
  }, []);
  const stored = useSquadSessionStore((s) => s.actions);
  const allActions = hydrated ? normalizeActions(stored) : [];
  const actions = allActions.filter((a) => a.ep === ep);

  // ── The clock ─────────────────────────────────────────────
  const run = useSquadRun((s) => s.run);
  const runEp = useSquadRun((s) => s.ep);
  const dock = useDockTimer((s) => s.timer);
  const ownTimer = dock?.href === SQUAD_SESSION_PATH ? dock : null;
  const live = runIsLive(run, dock);
  const liveRun = live ? run : null;
  // A run belongs to one episode. The page can show another (the picker, or a link
  // back from Retro Actions), and that episode's story and actions stay its own: the
  // clock stays with its episode, and this page says where it is, because the shell
  // hides its pill here.
  const runHere = liveRun && runEp === ep ? liveRun : null;
  const runElsewhere = liveRun && !liveRun.finished && runEp !== ep ? liveRun : null;

  // Another page's timer has the dock and stopped this one. The live region only
  // reaches a screen reader, so the page says it too, for as long as that's true.
  const [clockNotice, setClockNotice] = useState<string | null>(null);
  const otherTimer = dock !== null && dock.href !== SQUAD_SESSION_PATH;
  useEffect(() => {
    if (!otherTimer) setClockNotice(null);
  }, [otherTimer]);
  const clockBusy = (message: string) => {
    setClockNotice(message);
    announce(message);
  };

  const [runReady, setRunReady] = useState(false);
  useEffect(() => {
    const persist = useSquadRun.persist;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).finally(() =>
      setRunReady(true)
    );
  }, []);

  // Stopped from the pill on another page: the run is over.
  useEffect(() => {
    if (runReady && run && !live) useSquadRun.setState({ ep: null, run: null });
  }, [runReady, run, live]);

  // The pill links here without a query: back to the episode that's running.
  useEffect(() => {
    if (runReady && live && ep === null && runEp !== null) {
      router.replace(`${SQUAD_SESSION_PATH}?ep=${runEp}`);
    }
  }, [runReady, live, ep, runEp, router]);

  const pick = (next: string) => router.push(`${SQUAD_SESSION_PATH}?ep=${next}`);

  const book = episodes.find((e) => e.ep === ep) ?? null;
  const episode: SessionEpisode | null = book
    ? {
        ep: book.ep,
        title: book.title,
        lesson: book.lesson,
        question: book.question,
      }
    : null;

  const start = () => {
    if (!episode) return;
    const claim = startSession(episode.ep, episode.title);
    if (!claim.ok) {
      clockBusy(`The ${claim.holder.label} timer is running. Stop it before starting this one.`);
      return;
    }
    const step = currentStep(claim.run);
    announce(`Session started. Step 1 of 3: ${step?.label}, ${durationText(step?.seconds ?? 0)}.`);
    returnTo("timer:controls");
  };

  const next = () => {
    const claim = advanceSession();
    if (!claim) return;
    if (!claim.ok) {
      clockBusy(`The ${claim.holder.label} timer took the clock. Stop it to carry on.`);
      return;
    }
    const step = currentStep(claim.run);
    if (claim.run.finished || !step) {
      announce("All three steps done.");
      returnTo("timer:close");
    } else {
      announce(`Step ${claim.run.index + 1} of 3: ${step.label}, ${durationText(step.seconds)}.`);
    }
  };

  const stop = () => {
    const wasLive = Boolean(run && !run.finished);
    stopSession();
    if (wasLive) announce("Session stopped.");
  };

  // ── Example ───────────────────────────────────────────────
  const loadExample = () => {
    setActions((list) => [...list.filter((a) => !isExampleId(a.id)), ...buildExample()]);
    router.push(`${SQUAD_SESSION_PATH}?ep=${EXAMPLE_EP}`);
  };
  const clearExample = () => setActions((list) => list.filter((a) => !isExampleId(a.id)));

  // ── Actions ───────────────────────────────────────────────
  const form = useItemForm<ActionDraft, ActionDraft, keyof ActionDraft>({
    initial: EMPTY_ACTION,
    validate: validateAction,
    onSave: (values) => {
      if (ep === null) return;
      setActions((list) => [...list, { id: crypto.randomUUID(), ep, ...values }]);
    },
  });

  const removeAction = (action: SquadAction) =>
    removeWithUndo<SquadAction>({
      label: "Action removed",
      description: action.title,
      update: setActions,
      match: (a) => a.id === action.id,
    });

  const unsent = actions.filter((a) => !isExampleId(a.id) && !liveLink(a.sentTo, "retro-action"));
  const sendAll = () => {
    sendHandoffBatch(
      "retro-action",
      unsent.map((action) => ({
        src: handoffSource(action),
        links: {
          getLinks: () => linksOf(action.id),
          setLinks: (fn) => updateLinks(action.id, fn),
        },
      })),
      "Added to Retro Actions"
    );
  };

  return (
    <ToolPageWrapper
      toolId="squad-session"
      title="Squad Session Kit"
      description="Fifteen minutes on one episode of the book: read the story, discuss its question and agree what to do about it."
      showInsights={false}
      showHistory={false}
    >
      <ActionRow>
        <ExportButton
          filename="squad-session"
          markdown={toMarkdown({
            episode,
            steps: SESSION_STEPS,
            actions,
            sent: (a) => Boolean(liveLink(a.sentTo, "retro-action")),
          })}
        />
      </ActionRow>

      {hasExampleItems(allActions) && <ExampleNotice onClear={clearExample} />}

      <div className="space-y-4">
        <Field label="Episode" className="max-w-md">
          {(control) => (
            <Select value={ep === null ? undefined : String(ep)} onValueChange={pick}>
              <SelectTrigger {...control}>
                <SelectValue placeholder="Pick an episode" />
              </SelectTrigger>
              <SelectContent>
                {episodes.map((e) => (
                  <SelectItem key={e.ep} value={String(e.ep)}>
                    {e.ep}. {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        {!episode ? (
          <EmptyState
            icon={BookOpenText}
            padding="xl"
            action={<LoadExampleButton onLoad={loadExample} label="Load an example session" />}
          >
            <p className="font-semibold text-text">Pick an episode to start</p>
            <p className="mt-1">
              Any of the 26 episodes in the book works, and the session takes{" "}
              {durationText(runSeconds({ steps: [...SESSION_STEPS] }))}.
            </p>
          </EmptyState>
        ) : (
          <>
            {clockNotice ? (
              <p className="rounded-lg border border-border p-3 text-sm text-text">{clockNotice}</p>
            ) : null}
            {runHere ? (
              <StepTimerPanel
                run={runHere}
                timer={ownTimer}
                refFor={refFor}
                onPause={() => useDockTimer.getState().pause()}
                onResume={() => useDockTimer.getState().resume()}
                onNext={next}
                onStop={stop}
              />
            ) : runElsewhere ? (
              <SectionCard title="The session" icon={Users}>
                <p className="text-sm text-text">
                  A session is running on episode {runEp}: {runElsewhere.title}.
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href={`${SQUAD_SESSION_PATH}?ep=${runEp}`} prefetch={false}>
                    Back to that session
                  </Link>
                </Button>
              </SectionCard>
            ) : (
              <SectionCard title="The session" icon={Users}>
                <ol className="list-none space-y-1 text-sm text-text">
                  {SESSION_STEPS.map((s, i) => (
                    <li key={s.id} className="flex items-baseline justify-between gap-3">
                      <span>
                        {i + 1}. {s.label}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-sub">
                        {durationText(s.seconds)}
                      </span>
                    </li>
                  ))}
                </ol>
                <Button type="button" className="mt-4 gap-1" onClick={start}>
                  <Play aria-hidden="true" />
                  Start the session
                </Button>
              </SectionCard>
            )}

            <EpisodeNotes
              lesson={episode.lesson}
              question={episode.question}
              bookPage={book?.bookPage}
            />
            <RightsNotice />

            <SectionCard
              title="Agreed actions"
              icon={ListChecks}
              actions={
                unsent.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={sendAll}
                  >
                    <Send aria-hidden="true" />
                    Send all to Retro Actions
                  </Button>
                ) : null
              }
            >
              <ItemForm form={form} submitLabel="Add action">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <Field label="What will the team do?" error={form.errors.title} required>
                    {(control) => (
                      <Input
                        {...control}
                        value={form.draft.title}
                        onChange={(e) => form.update({ title: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Who owns it?" error={form.errors.owner}>
                    {(control) => (
                      <Input
                        {...control}
                        value={form.draft.owner}
                        onChange={(e) => form.update({ owner: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              </ItemForm>

              {actions.length === 0 ? (
                <p className="mt-4 text-sm text-sub">
                  Nothing agreed yet. Add what the team decides in the last step.
                </p>
              ) : (
                <ul className="mt-4 list-none space-y-2">
                  {actions.map((action) => (
                    <li
                      key={action.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
                    >
                      <span className="min-w-0 flex-1 text-sm text-text">
                        {action.title}
                        {action.owner ? (
                          <span className="block text-xs text-sub">{action.owner}</span>
                        ) : null}
                      </span>
                      <SendToMenu
                        routes={["retro-action"]}
                        disabled={isExampleId(action.id)}
                        item={handoffSource(action)}
                        sentTo={action.sentTo}
                        getLinks={() => linksOf(action.id)}
                        onLinksChange={(fn) => updateLinks(action.id, fn)}
                      />
                      <IconButton
                        label={`Remove ${action.title}`}
                        icon={<Trash2 aria-hidden="true" />}
                        onClick={() => removeAction(action)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
