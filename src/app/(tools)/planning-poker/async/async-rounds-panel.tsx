"use client";

/**
 * "Estimate without a meeting" on Planning Poker's lobby (loaded on demand
 * from lobby-screen.tsx): a new-round form and the rounds this browser's
 * workspace holds.
 *
 * A round's stories are ticked from the queue (only those are stamped, with
 * takeQueuedStoriesById, so their estimate can be written back) or typed.
 * The form checks that the link will fit before it stamps anything.
 */

import { useMemo, useState } from "react";
import { Hourglass, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PeoplePicker } from "@/components/team/person-picker";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { POKER_ASYNC_MAX, type PokerAsyncRound } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import { pendingQueueItems, takeQueuedStoriesById } from "@/lib/handoffs/poker-writeback";
import { todayIso } from "@/lib/sprints/series";
import {
  DUE_MAX_DAYS,
  encodePack,
  heldStoryIds,
  latestDueDay,
  newAsyncRound,
  newAsyncRoundId,
  packFor,
  readAsyncRound,
  readAsyncRounds,
  typedLine,
  type AsyncRoundInput,
} from "@/lib/estimation/async-pack";
import { SCALE_LABELS, type ScaleType } from "../types";
import { useCardReferences } from "../use-card-references";
import { AsyncRoundCard, type AsyncLiveStart } from "./async-round-card";
import {
  INITIAL_ASYNC_ROUND,
  validateAsyncRound,
  type AsyncRoundDraft,
  type AsyncRoundField,
  type AsyncRoundValues,
} from "./round-form";
import { saveRound } from "./round-actions";

const EMPTY: PokerAsyncRound[] = [];
const ORDER: Record<PokerAsyncRound["status"], number> = { open: 0, revealed: 1, closed: 2 };

export function AsyncRoundsPanel({
  hostName,
  sessionOpen = false,
  onTalkLive,
}: {
  /** The lobby's display name. */
  hostName: string;
  sessionOpen?: boolean;
  onTalkLive?: (start: AsyncLiveStart) => void;
}) {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.pokerAsyncRounds ?? EMPTY);
  const queue = useWorkspaceStore(
    useShallow((s) => (s.pokerEstimationLogs ?? []).find((d) => d.id === POKER_LOG_ID)?.queue)
  );
  const { log } = useHistoryLogger("planning-poker");
  const [creating, setCreating] = useState(false);

  // Each stored row read into shape first: a malformed one is repaired or left out.
  const rounds = useMemo(
    () =>
      readAsyncRounds(stored)
        .map((r) => readAsyncRound(r))
        .sort(
          (a, b) => ORDER[a.status] - ORDER[b.status] || b.createdAt.localeCompare(a.createdAt)
        ),
    [stored]
  );
  // The queue stories the form may offer: pending, not held by a round.
  const offered = useMemo(
    () => pendingQueueItems(queue, [], heldStoryIds(rounds)),
    [queue, rounds]
  );

  return (
    <SectionCard
      title="Estimate without a meeting"
      icon={Hourglass}
      className="border-border bg-surface"
      headerClassName="pb-3"
      contentClassName="flex flex-col gap-4"
      actions={
        !creating && (
          <Button
            type="button"
            variant="toolkit"
            size="sm"
            className="gap-1.5"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" />
            New round
          </Button>
        )
      }
    >
      <p className="text-sm text-sub">
        No live room needed: send the team a link. Each person picks a card per story by the due day
        and sends you a short reply code to paste here.
      </p>
      {creating && (
        <NewRoundForm
          hostName={hostName}
          offered={offered}
          onCreated={(round) => {
            log(PLANNING_POKER_ACTIONS.ASYNC_ROUND_CREATED, {
              roundId: round.id,
              stories: round.stories.length,
            });
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {!hydrated ? (
        <p role="status" className="text-sm text-sub">
          Loading your rounds…
        </p>
      ) : rounds.length === 0 ? (
        !creating && (
          <EmptyState>
            No rounds yet. Start one when the team can&apos;t meet, or for stories they can size on
            their own time.
          </EmptyState>
        )
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Rounds without a meeting">
          {rounds.map((round) => (
            <li key={round.id}>
              <AsyncRoundCard
                round={round}
                hostName={hostName}
                log={log}
                sessionOpen={sessionOpen}
                onTalkLive={onTalkLive}
              />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function NewRoundForm({
  hostName,
  offered,
  onCreated,
  onCancel,
}: {
  hostName: string;
  offered: { id: string; title: string }[];
  onCreated: (round: PokerAsyncRound) => void;
  onCancel: () => void;
}) {
  const today = todayIso();
  const offeredIds = useMemo(() => offered.map((q) => q.id), [offered]);
  const [draftScale, setDraftScale] = useState<ScaleType>(INITIAL_ASYNC_ROUND.scaleType);
  const [draftDeck, setDraftDeck] = useState<string[]>([]);
  const references = useCardReferences(draftScale, draftDeck);
  // The round's real id from the start: the link-size check packs the same
  // id the saved round's link will carry, so a round that passes it fits.
  const [roundId] = useState(newAsyncRoundId);

  /** The round the values would make, with stand-in story ids (the pack holds titles only). */
  const provisional = (v: AsyncRoundValues): AsyncRoundInput => ({
    title: v.title,
    scaleType: v.scaleType,
    deck: v.deck,
    stories: [
      ...offered.filter((q) => v.queueIds.includes(q.id)),
      ...v.typedTitles.map((title, i) => ({ id: `typed-${i}`, title })),
    ].map((s) => ({ id: s.id, title: typedLine(s.title, POKER_ASYNC_MAX.storyTitle) ?? "" })),
    expected: v.expected,
    dueDate: v.dueDate,
    withMeanings: v.withMeanings,
  });
  const meaningsFor = (deck: readonly string[]) =>
    deck.map((c) => references(c)?.description ?? "");

  const form = useItemForm<AsyncRoundDraft, AsyncRoundValues, AsyncRoundField>({
    initial: INITIAL_ASYNC_ROUND,
    validate: (d) => {
      const checked = validateAsyncRound(d, { today, queueIds: offeredIds });
      if (!checked.ok) return checked;
      // The link must fit before any queue story is stamped.
      const round = newAsyncRound(provisional(checked.values), roundId, "");
      const packed = encodePack(
        packFor(round, { host: hostName, meanings: meaningsFor(checked.values.deck) })
      );
      return packed.ok ? checked : { ok: false, errors: { stories: packed.problem } };
    },
    onSave: (values) => {
      // Stamp only the ticked queue items: their ids become the stories' ids.
      const fromQueue = takeQueuedStoriesById(values.queueIds).map((s) => ({
        id: s.id,
        title: s.title,
      }));
      const typed = values.typedTitles.map((title) => ({ id: crypto.randomUUID(), title }));
      const now = new Date().toISOString();
      const round = newAsyncRound(
        { ...provisional(values), stories: [...fromQueue, ...typed] },
        roundId,
        now
      );
      if (saveRound(round) === null) onCreated(round);
    },
  });
  const { draft, update, errors } = form;
  const setDraft = (patch: Partial<AsyncRoundDraft>) => {
    update(patch);
    const scale = patch.scaleType ?? draft.scaleType;
    const custom = patch.customInput ?? draft.customInput;
    setDraftScale(scale);
    setDraftDeck(scale === "custom" ? custom.split(",").map((c) => c.trim()) : []);
  };
  const toggleQueued = (id: string, on: boolean) =>
    update({
      queueIds: on ? [...draft.queueIds, id] : draft.queueIds.filter((x) => x !== id),
    });

  return (
    <ItemForm
      form={form}
      submitLabel="Make the link"
      onCancel={onCancel}
      className="flex flex-col gap-4 space-y-0 rounded-md border border-border bg-surface-deep p-3"
    >
      <Field label="Round name" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={POKER_ASYNC_MAX.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. Checkout stories for Sprint 15"
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-text" aria-hidden="true">
          Deck
        </span>
        <ToggleGroup
          label="Deck"
          options={(["fibonacci", "tshirt", "custom"] as ScaleType[]).map((s) => ({
            value: s,
            label: SCALE_LABELS[s],
          }))}
          value={draft.scaleType}
          onValueChange={(s) => setDraft({ scaleType: s })}
          className="pointer-coarse:[&>button]:min-h-11"
        />
        {draft.scaleType === "custom" && (
          <Field
            label="Card values"
            hint={`Comma-separated, lowest first, up to ${POKER_ASYNC_MAX.deck}. Add ? for “can't estimate”.`}
            error={errors.customInput}
          >
            {(props) => (
              <Input
                {...props}
                value={draft.customInput}
                onChange={(e) => setDraft({ customInput: e.target.value })}
                placeholder="e.g. 1, 2, 4, 8"
              />
            )}
          </Field>
        )}
        {draft.scaleType !== "custom" && errors.customInput && (
          <p className="text-xs text-danger" role="alert">
            {errors.customInput}
          </p>
        )}
      </div>

      {offered.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1 text-sm text-text">From the queue</legend>
          {offered.map((q) => (
            <label
              key={q.id}
              className="flex min-w-0 items-center gap-2 text-sm text-text pointer-coarse:min-h-11"
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-accent"
                checked={draft.queueIds.includes(q.id)}
                onChange={(e) => toggleQueued(q.id, e.target.checked)}
              />
              <span className="min-w-0 break-words">{q.title}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Field
        label={offered.length > 0 ? "Or type stories, one per line" : "Stories, one per line"}
        hint={`Up to ${POKER_ASYNC_MAX.stories} stories in a round, ${POKER_ASYNC_MAX.storyTitle} characters each.`}
        error={errors.stories}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            value={draft.typed}
            onChange={(e) => update({ typed: e.target.value })}
            placeholder={"Pay by phone\nRefund a payment"}
          />
        )}
      </Field>

      <PeoplePicker
        label="Who should reply"
        values={draft.expected}
        onChange={(expected) => update({ expected })}
        hint="Optional. The round shows who hasn't replied yet."
        error={errors.expected}
        offerAddToRoster={false}
      />

      <Field
        label="Due day"
        hint={`Optional. Up to ${DUE_MAX_DAYS} days ahead.`}
        error={errors.dueDate}
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            min={today}
            max={latestDueDay(today)}
            value={draft.dueDate}
            onChange={(e) => update({ dueDate: e.target.value })}
            className="sm:max-w-48"
          />
        )}
      </Field>

      <label className="flex items-start gap-2 text-sm text-text pointer-coarse:min-h-11">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          checked={draft.withMeanings}
          onChange={(e) => update({ withMeanings: e.target.checked })}
        />
        <span>
          Add what each card means
          <span className="block text-xs text-sub">
            From your Estimation Guide. It makes the link longer.
          </span>
        </span>
      </label>
    </ItemForm>
  );
}
