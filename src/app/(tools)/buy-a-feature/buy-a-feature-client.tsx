"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { BarChart3, CircleDollarSign, PackageCheck, Plus, Radio, Settings2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ResortChip } from "@/components/shared/resort-chip";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BUY_A_FEATURE_ID,
  type BuyAFeatureGame,
  type PrioritizationItem,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { allocationAmount, type AllocationRoundResult } from "@/lib/realtime/vote-room/allocation";
import { generateBuyAFeaturePrompts } from "@/lib/ai-prompts/buy-a-feature";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BUY_FEATURE_ACTIONS } from "@/lib/history/event-actions";
import { sendHandoffBatch } from "@/lib/handoffs/send";
import { liveLink } from "@/lib/handoffs/registry";
import { useTeamRoster } from "@/lib/team/use-team-roster";
import { todayIso } from "@/lib/sprints/series";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import { allocationRoundFrom, roundDayProblem } from "@/lib/hundred-dollar/allocation";
import {
  applyAllocationRound,
  budgetCheck,
  buyAFeatureVerdict,
  featureLedger,
  featureRows,
  gameCheck,
  gameRounds,
  isFunded,
  isPlayers,
  newFeatureRow,
  nextRound,
  pool as poolOf,
  pricesOf,
  purchaseProblem,
  recordPurchase,
  refundUnfunded,
  remaining,
  roundNumberOf,
  roundOutcomeText,
  roundSaveProblem,
  unitOf,
  withPrice,
  withRaised,
  type FeatureLedger,
} from "@/lib/buy-a-feature/game";
import { DayField } from "../health-check/day-field";
import { useDayPick, useToday } from "../health-check/use-today";
import { buildExample, type BuyAFeatureExample } from "./example";
import { AddFeatureForm, type FeatureValues } from "./feature-form";
import { FeatureRow } from "./feature-row";
import { FundingChart, GameRounds } from "./funding";
import { GameSettings } from "./game-settings";
import { SavedRoundNote, sheetKeyOf, useHeldSheet } from "./held-sheet";
import { toMarkdown } from "./markdown";
import { UndoableReset } from "./undoable-reset";

const keyOf = (x: FeatureLedger) => x.id;
/** Most raised first, as the market always sorted. */
const byRaised = (a: FeatureLedger, b: FeatureLedger) => b.raised - a.raised;

const ws = () => useWorkspaceStore.getState();
const freshRows = () => featureRows(ws().prioritizations);
const freshRow = (id: string) => freshRows().find((x) => x.id === id);
const freshGame = () =>
  (ws().buyAFeatureGames ?? []).find((g) => g.id === BUY_A_FEATURE_ID) ?? null;
const nowIso = () => new Date().toISOString();

/** Whether a funded feature's backlog story still exists. */
const inBacklog = (row: PrioritizationItem | undefined) =>
  Boolean(liveLink(row?.sentTo, "backlog-story"));

/**
 * Buy-a-Feature: players get a budget of play money for priced features,
 * and the pool (budget × players) can't buy everything, so they have to
 * choose. Purchases happen at the table (capped at what a feature still
 * needs, refused above what's left in the pool) or in anonymous rounds
 * through the vote room, where each player splits their share of what's
 * left and only the totals are kept. Short features keep their pledges
 * until "Refund unfunded features"; funded ones go to the backlog as
 * stories. The example is a read-only preview that never reaches the
 * workspace.
 */
export function BuyAFeatureClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const storedGame = useWorkspaceStore(
    useShallow((s) => (s.buyAFeatureGames ?? []).find((g) => g.id === BUY_A_FEATURE_ID) ?? null)
  );
  const storedRounds = useWorkspaceStore((s) => s.allocationRounds);
  // Re-render when a story comes or goes, so "In the backlog" stays true.
  useWorkspaceStore((s) => s.stories);
  const roster = useTeamRoster();
  const [example, setExample] = useState<BuyAFeatureExample | null>(null);
  const preview = example !== null;
  const liveRows = useMemo(() => featureRows(all), [all]);
  const rows = example?.rows ?? liveRows;
  const game = example?.game ?? storedGame;
  const rounds = useMemo(
    () => gameRounds(example?.rounds ?? storedRounds),
    [example, storedRounds]
  );
  const { log } = useHistoryLogger("buy-a-feature");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const [lastRound, setLastRound] = useState<string | null>(null);
  // What each saved round did, worked out when it was saved: the rows it
  // changed would make a fresh preview count its totals twice.
  const [savedOutcomes, setSavedOutcomes] = useState<Record<string, string>>({});
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const today = useToday();
  // The day a round is saved under: today unless picked (a paper round held earlier).
  const [roundDay, setRoundDay] = useDayPick(today);

  const features = useMemo(() => rows.map(featureLedger), [rows]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const unit = unitOf(game);
  const money = (n: number) => allocationAmount(n, unit);
  const pool = poolOf(game, features);
  const check = gameCheck(game, features);
  // Offered once the players are known, before any budget is.
  const suggestedBudget = isPlayers(game?.players)
    ? budgetCheck(pricesOf(features), game.players, game.budgetPerPlayer ?? 0).suggestedBudget
    : null;
  const verdict = buyAFeatureVerdict(features, game);
  const funded = features.filter(isFunded);
  const toSend = funded.filter((f) => !inBacklog(rowById.get(f.id)));
  const short = features.filter((f) => f.raised > 0 && !isFunded(f));
  const priced = features.filter((f) => f.price !== null);
  // What the features hold, capped at each price; "—" until there's a pool or money.
  const spent = features.reduce((s, f) => s + f.raised, 0);
  const { ordered, isStale, resort } = useStableOrder(features, keyOf, byRaised);
  const buyOff = pool
    ? null
    : "Set the players and each one's budget first: purchases come out of the pool.";

  /* ── Writes (never in the preview) ──────────────────────────────────── */

  const upsert = (row: PrioritizationItem) => ws().upsertPrioritization(row);

  const writeGame = (
    patch: Partial<Pick<BuyAFeatureGame, "players" | "budgetPerPlayer" | "unit">>
  ) => {
    if (preview) return;
    const next: BuyAFeatureGame = {
      ...(freshGame() ?? { id: BUY_A_FEATURE_ID }),
      ...patch,
      id: BUY_A_FEATURE_ID,
      updatedAt: nowIso(),
    };
    for (const key of ["players", "budgetPerPlayer", "unit"] as const) {
      if (next[key] === undefined) delete next[key];
    }
    ws().upsertBuyAFeatureGame(next);
  };

  const add = (v: FeatureValues) => {
    if (preview) return;
    const row = newFeatureRow(crypto.randomUUID(), v.title, v.price, nowIso());
    upsert(row);
    log(BUY_FEATURE_ACTIONS.FEATURE_ADDED, { title: row.title, price: v.price });
    announce(`Added ${row.title}, priced ${money(v.price)}`);
  };

  const edit = (f: FeatureLedger, v: FeatureValues) => {
    if (preview) return;
    const prev = freshRow(f.id);
    if (!prev) return;
    const repriced = withPrice({ ...prev, title: v.title }, v.price, nowIso());
    if (repriced.refunded === 0) {
      upsert(repriced.row);
      return;
    }
    // A lower price than it raised: say where the rest went, and offer it back.
    undoable({
      label: `Repriced “${v.title}”`,
      description: `${money(repriced.refunded)} went back to the pool: it had raised more than the new price.`,
      apply: () => upsert(repriced.row),
      revert: () => upsert(prev),
    });
  };

  /** Buy at the table; returns why it couldn't, or null once it bought. */
  const buy = (f: FeatureLedger, amount: number | undefined): string | null => {
    if (preview) return null;
    const row = freshRow(f.id);
    if (!row) return "This feature is no longer in the game.";
    const now = featureLedger(row);
    const problem = purchaseProblem(
      now,
      amount,
      poolOf(freshGame(), freshRows().map(featureLedger)),
      unit
    );
    if (problem || amount === undefined) return problem;
    const { raised, applied, refunded } = recordPurchase(now, amount);
    undoable({
      label: `Bought ${money(applied)} of ${row.title}`,
      description:
        refunded > 0
          ? `${money(refunded)} went back: it only needed ${money(applied)}.`
          : undefined,
      apply: () => upsert(withRaised(row, raised, nowIso())),
      // Take back only this purchase, so a later one survives.
      revert: () => {
        const cur = freshRow(f.id);
        if (cur)
          upsert(withRaised(cur, Math.max(0, featureLedger(cur).raised - applied), nowIso()));
      },
    });
    log(BUY_FEATURE_ACTIONS.PURCHASE_RECORDED, { id: row.id, amount, applied, refunded });
    const left = remaining({ ...now, raised });
    announce(
      left === 0
        ? `Bought ${money(applied)} of ${row.title}: it's funded.`
        : `Bought ${money(applied)} of ${row.title}: ${money(left)} to go.`
    );
    return null;
  };

  const refund = (f: FeatureLedger) => {
    if (preview) return;
    const row = freshRow(f.id);
    if (!row) return;
    const amount = featureLedger(row).raised;
    undoable({
      label: `Refunded ${money(amount)} from ${row.title}`,
      apply: () => upsert(withRaised(row, 0, nowIso())),
      revert: () => {
        const cur = freshRow(f.id);
        if (cur) upsert(withRaised(cur, featureLedger(cur).raised + amount, nowIso()));
      },
    });
    announce(`Refunded ${money(amount)} from ${row.title}`);
  };

  const remove = (f: FeatureLedger) => {
    if (preview) return;
    const row = freshRow(f.id);
    if (!row) return;
    undoable({
      label: `Deleted “${row.title}”`,
      description: row.fields?.raised ? "What it raised went back to the pool." : undefined,
      apply: () => {
        ws().removePrioritization(row.id);
        log(BUY_FEATURE_ACTIONS.FEATURE_REMOVED, { id: row.id });
      },
      revert: () => upsert(row),
    });
    announce(`Deleted ${row.title}`);
  };

  const pushFunded = () => {
    if (preview) return;
    const sendable = freshRows().filter((r) => isFunded(featureLedger(r)) && !inBacklog(r));
    if (sendable.length === 0) return;
    const n = sendable.length;
    const sent = sendHandoffBatch(
      "backlog-story",
      sendable.map((r) => ({
        src: { title: r.title, sourceRef: { tool: "buy-a-feature", id: r.id } },
        links: {
          getLinks: () => freshRow(r.id)?.sentTo,
          setLinks: (update) => {
            const cur = freshRow(r.id);
            if (cur) upsert({ ...cur, sentTo: update(cur.sentTo), updatedAt: nowIso() });
          },
        },
      })),
      `Added ${n} funded ${n === 1 ? "feature" : "features"} to the backlog`
    );
    if (sent.length > 0) {
      announce(
        `Added ${sent.length} funded ${sent.length === 1 ? "feature" : "features"} to the backlog as stories`
      );
    }
  };

  /* ── The round ──────────────────────────────────────────────────────── */

  // One rule for the page and the agent: the round's number, budget and sheet, or why not.
  const next = nextRound(features, game, rounds);
  const sheetKey = sheetKeyOf(next.sheet);
  const sheet = useMemo(
    () => next.sheet,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by what the sheet shows only
    [sheetKey]
  );
  // The count entry's sheet stays put while splits are typed or a saved round shows.
  const held = useHeldSheet(preview ? null : sheet);
  const roundSheet = preview ? sheet : held.sheet;
  const roundNo = roundSheet ? roundNumberOf(roundSheet.id) : null;
  const blockedReason = preview
    ? "Clear the example to run a round with your team."
    : held.isHeld
      ? null
      : next.blocked;
  // Rounds follow each other, so none is dated before the last one.
  const lastRoundDay = rounds[0]?.date ?? null;

  /** Under a round's results: what it did once saved, or what saving it would do, or why it can't. */
  const renderResults = (r: AllocationRoundResult) => {
    const done = savedOutcomes[r.roundId];
    if (done !== undefined) {
      return (
        <SavedRoundNote
          roundId={r.roundId}
          text={done}
          onShown={held.noteShown}
          onGone={held.noteGone}
        />
      );
    }
    const now = freshRows().map(featureLedger);
    const problem = roundSaveProblem(now, freshGame(), gameRounds(ws().allocationRounds), r);
    if (problem) {
      return <p className="text-sm text-warning">This round can&apos;t be saved: {problem}</p>;
    }
    return (
      <p className="text-sm text-text">
        Saving it: {roundOutcomeText(applyAllocationRound(now, r), now, unit)}
      </p>
    );
  };

  const saveRound = (result: AllocationRoundResult) => {
    if (preview) return false;
    const rowsNow = freshRows();
    const ledgers = rowsNow.map(featureLedger);
    const roundsNow = gameRounds(ws().allocationRounds);
    // The preview's rule, checked again on the store as it is now. Refused,
    // the kit keeps Save round available.
    const problem =
      roundSaveProblem(ledgers, freshGame(), roundsNow, result) ??
      roundDayProblem(roundDay, todayIso(), roundsNow[0]?.date ?? null);
    if (problem) {
      toast.error(`${problem} Nothing was saved.`);
      return false;
    }
    const applied = applyAllocationRound(ledgers, result);
    const added = new Map<string, number>();
    const now = nowIso();
    for (const [id, raised] of Array.from(applied.next)) {
      const row = rowsNow.find((x) => x.id === id);
      if (!row) continue;
      added.set(id, raised - featureLedger(row).raised);
      upsert(withRaised(row, raised, now));
    }
    const saved = allocationRoundFrom(result, {
      id: `allocationRound_${nanoid(8)}`,
      date: roundDay,
    });
    ws().upsertAllocationRound(saved);
    // Counts only: a round never says who gave what.
    log(BUY_FEATURE_ACTIONS.PURCHASE_RECORDED, {
      round: true,
      ballots: result.ballots,
      spent: applied.spends,
      refunded: applied.refunded,
      funded: applied.funded.length,
    });
    const text = roundOutcomeText(applied, ledgers, unit);
    setLastRound(text);
    setSavedOutcomes((o) => ({ ...o, [result.roundId]: text }));
    // A round typed in by hand keeps its sheet while it shows; a live room
    // keeps its own, and its New round needs the current one.
    if (result.source === "facilitator") held.keepSaved(result.roundId);
    else held.release();
    announce(text);
    return () => {
      for (const [id, amount] of Array.from(added)) {
        const cur = freshRow(id);
        if (cur) upsert(withRaised(cur, Math.max(0, featureLedger(cur).raised - amount), nowIso()));
      }
      ws().removeAllocationRound(saved.id);
      setLastRound(null);
      setSavedOutcomes((o) => {
        const rest = { ...o };
        delete rest[result.roundId];
        return rest;
      });
      held.unsave(result.roundId);
    };
  };

  /* ── Exports and prompts ────────────────────────────────────────────── */

  const markdown = useMemo(
    () => toMarkdown(rows, game, rounds, { inBacklog: (id) => inBacklog(rowById.get(id)) }),
    [rows, game, rounds, rowById]
  );

  const csvData = useMemo(
    () => ({
      headers: ["Feature", "Price", "Raised", "To go", "% funded"],
      rows: features.map((f) => [
        f.title,
        f.price ?? "",
        f.raised,
        f.price === null ? "" : remaining(f),
        f.price === null ? "—" : `${Math.round(Math.min(1, f.raised / f.price) * 100)}%`,
      ]),
    }),
    [features]
  );

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
        prioritizations: s.prioritizations,
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Buy-a-Feature",
      // The capped numbers the page shows, never an old row's over-funding.
      prompts: generateBuyAFeaturePrompts(
        {
          items: [...features].sort(byRaised).map((f) => ({
            ...(rowById.get(f.id) as PrioritizationItem),
            fields: { price: f.price ?? 0, raised: f.raised },
          })),
        },
        workspace
      ),
    }),
    [features, rowById, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="buy-a-feature"
      title="Buy-a-Feature Game"
      description="Players spend a limited budget of play money on priced features. The pool can't buy everything, so the trade-offs show what they value."
    >
      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: five customer advisers, $100 each, after one anonymous round. It&apos;s a
            read-only preview: nothing is saved or sent.
          </p>
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="buy-a-feature"
          csvData={csvData}
          jsonData={{ features: rows, game, rounds }}
          markdown={markdown}
          targetRef={exportRef}
        />
      </ActionRow>

      <p className="mb-4 text-sm font-medium text-text" data-testid="buy-a-feature-verdict">
        {verdict}
      </p>

      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI label="Pool" value={pool ? money(pool.pool) : "Not set"} />
          <KPI label="Spent" value={spent > 0 || pool ? money(spent) : "—"} />
          <KPI label="Left" value={pool ? money(pool.left) : "—"} />
          <KPI
            label="Funded"
            value={priced.length === 0 ? "—" : `${funded.length} of ${priced.length}`}
          />
        </div>

        <SectionCard title="The game" icon={Settings2}>
          <GameSettings
            game={game}
            unit={unit}
            pool={pool}
            check={check}
            suggestedBudget={suggestedBudget}
            rosterSize={preview ? 0 : roster.length}
            readOnly={preview}
            onChange={writeGame}
          />
        </SectionCard>

        <SectionCard title="Add feature" icon={Plus}>
          <AddFeatureForm disabled={preview} onAdd={add} />
        </SectionCard>

        {features.length === 0 ? (
          <EmptyState
            icon={CircleDollarSign}
            action={<LoadExampleButton onLoad={() => setExample(buildExample())} />}
          >
            No features yet. Add each one with a price, set the players and their budget, then buy
            at the table or run a round. Or load an example to see a game under way.
          </EmptyState>
        ) : (
          <SectionCard
            title="Marketplace"
            icon={CircleDollarSign}
            actions={
              <>
                {/* Each confirm keeps its own snapshot, so two open Undo toasts never mix. */}
                <UndoableReset
                  label="Refund unfunded features"
                  title="Refund the features that fell short?"
                  description={`${short.length} ${short.length === 1 ? "feature gives" : "features give"} back ${money(short.reduce((s, f) => s + f.raised, 0))} to the pool. Funded features keep their money.`}
                  confirmLabel="Refund them"
                  doneLabel={`Refunded ${short.length} unfunded ${short.length === 1 ? "feature" : "features"}`}
                  disabled={preview || short.length === 0}
                  run={() => {
                    const rowsNow = freshRows();
                    const refunds = refundUnfunded(rowsNow.map(featureLedger));
                    const before = rowsNow.filter((r) => refunds.has(r.id));
                    const now = nowIso();
                    for (const r of before) upsert(withRaised(r, 0, now));
                    return () => before.forEach(upsert);
                  }}
                />
                <UndoableReset
                  label="Reset game"
                  title="Reset the game?"
                  description={`Every feature's money goes back to the pool, the budget per player is cleared${rounds.length > 0 ? ` and the ${rounds.length} saved ${rounds.length === 1 ? "round is" : "rounds are"} deleted` : ""}. The features, their prices and the players stay.`}
                  confirmLabel="Reset game"
                  doneLabel="Reset the game"
                  disabled={preview}
                  variant="danger-ghost"
                  run={() => {
                    const rowsNow = freshRows();
                    const before = {
                      rows: rowsNow.filter((r) => featureLedger(r).raised > 0 || r.fields?.raised),
                      game: freshGame(),
                      rounds: gameRounds(ws().allocationRounds),
                    };
                    const now = nowIso();
                    for (const r of before.rows) upsert(withRaised(r, 0, now));
                    if (before.game) writeGame({ budgetPerPlayer: undefined });
                    for (const r of before.rounds) ws().removeAllocationRound(r.id);
                    setLastRound(null);
                    held.release();
                    log(BUY_FEATURE_ACTIONS.GAME_RESET, {
                      features: rowsNow.length,
                      rounds: before.rounds.length,
                    });
                    return () => {
                      before.rows.forEach(upsert);
                      if (before.game) ws().upsertBuyAFeatureGame(before.game);
                      before.rounds.forEach((r) => ws().upsertAllocationRound(r));
                    };
                  }}
                />
              </>
            }
          >
            {buyOff && !preview && <p className="mb-3 text-sm text-sub">{buyOff}</p>}
            <ResortChip isStale={isStale} onResort={resort} what="Amounts" />
            <ul className="space-y-2" aria-label="Features, most raised first">
              {ordered.map((f) => (
                <FeatureRow
                  key={f.id}
                  f={f}
                  unit={unit}
                  inBacklog={inBacklog(rowById.get(f.id))}
                  readOnly={preview}
                  canBuy={buyOff}
                  onBuy={(amount) => buy(f, amount)}
                  onRefund={() => refund(f)}
                  onEdit={(v) => edit(f, v)}
                  onDelete={() => remove(f)}
                />
              ))}
            </ul>
          </SectionCard>
        )}

        {funded.length > 0 && (
          <SectionCard title="Funded" icon={PackageCheck} contentClassName="space-y-3">
            <ul className="space-y-1 text-sm" aria-label="Funded features">
              {funded.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-text">{f.title}</span>
                  <span className="text-xs text-sub">
                    {inBacklog(rowById.get(f.id)) ? "In the backlog" : "Not in the backlog yet"}
                  </span>
                </li>
              ))}
            </ul>
            {toSend.length > 0 ? (
              <Button type="button" variant="toolkit" disabled={preview} onClick={pushFunded}>
                Add {toSend.length} funded {toSend.length === 1 ? "feature" : "features"} to the
                backlog
              </Button>
            ) : (
              <p className="text-sm text-sub">
                Every funded feature is in the backlog as a story. Size them in Planning Poker.
              </p>
            )}
          </SectionCard>
        )}

        <SectionCard title="Play a round" icon={Radio} contentClassName="space-y-3">
          <p className="text-sm text-sub">
            Each player splits their share of what&apos;s left in the pool across the features still
            to fund
            {roundSheet && roundNo !== null && !blockedReason
              ? ` (round ${roundNo}: ${money(roundSheet.budget)} each${roundNo > 1 ? ", the pool's leftover split evenly" : ""})`
              : ""}
            , anonymously. Only each feature&apos;s total, how many backed it and the spread bands
            are kept, never anyone&apos;s split. A feature can&apos;t take more than it needs: the
            rest goes back to the pool.
          </p>
          <DayField
            label="Round held on"
            value={roundDay}
            max={today}
            problem={(d) => roundDayProblem(d, today, lastRoundDay)}
            onChange={setRoundDay}
            hint={roundDay !== today ? "Backdated" : "Paper rounds can be backdated."}
            disabled={preview}
          />
          {held.stale && (
            <div
              role="status"
              className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-text"
            >
              <p>
                The game changed after this round&apos;s splits were started (a purchase, say).
                Saving caps each total again at what each feature still needs and what&apos;s left
                in the pool.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirmStartOver(true)}
              >
                Start over with the current numbers
              </Button>
            </div>
          )}
          {/* Typing into the count entry holds its sheet (held-sheet.tsx). */}
          <div onChangeCapture={held.onEntryChange}>
            <VoteRoundPanel
              tool="buy-a-feature"
              toolName="Buy-a-Feature"
              sheet={roundSheet}
              onSave={saveRound}
              blockedReason={blockedReason}
              renderResults={renderResults}
            />
          </div>
          <ConfirmDialog
            open={confirmStartOver}
            onOpenChange={setConfirmStartOver}
            title="Start over with the current numbers?"
            description="The splits entered so far for this round are discarded."
            confirmLabel="Start over"
            onConfirm={() => {
              held.release();
              announce("The round starts over with the game's current numbers.");
            }}
          />
          {lastRound && (
            <p role="status" className="text-sm text-text">
              Last round: {lastRound}
            </p>
          )}
        </SectionCard>

        {(priced.length > 0 || rounds.length > 0) && (
          <SectionCard title="Results" icon={BarChart3} contentClassName="space-y-4">
            {priced.length > 0 && <FundingChart features={features} unit={unit} />}
            {rounds.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-text">Saved rounds</h3>
                <GameRounds rounds={rounds} />
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs uppercase tracking-wider text-sub">{label}</div>
      <div className="mt-1 font-data text-xl font-semibold">{value}</div>
    </div>
  );
}
