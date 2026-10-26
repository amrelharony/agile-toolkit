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
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BUY_A_FEATURE_ID,
  type AllocationRound,
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
import { allocationRoundFrom } from "@/lib/hundred-dollar/allocation";
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
  roundOutcomeText,
  roundPoolProblem,
  unitOf,
  withPrice,
  withRaised,
  type FeatureLedger,
} from "@/lib/buy-a-feature/game";
import { buildExample, type BuyAFeatureExample } from "./example";
import { AddFeatureForm, type FeatureValues } from "./feature-form";
import { FeatureRow } from "./feature-row";
import { FundingChart, GameRounds } from "./funding";
import { GameSettings } from "./game-settings";
import { toMarkdown } from "./markdown";

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
  // For the resets' Undo: what they changed, as it was.
  const before = useRef<{
    rows: PrioritizationItem[];
    game: BuyAFeatureGame | null;
    rounds: AllocationRound[];
  }>({ rows: [], game: null, rounds: [] });

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
  const sheetKey = [
    next.number,
    next.budget,
    unit,
    ...(next.sheet?.items.map((x) => `${x.id}|${x.text}|${x.cap ?? ""}|${x.hint ?? ""}`) ?? []),
  ].join("\n");
  const sheet = useMemo(
    () => next.sheet,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by what the sheet shows only
    [sheetKey]
  );
  const blockedReason = preview ? "Clear the example to run a round with your team." : next.blocked;

  const outcomeOf = (r: Pick<AllocationRoundResult, "items">) => {
    const now = freshRows().map(featureLedger);
    return roundOutcomeText(applyAllocationRound(now, r), now, unit);
  };

  const saveRound = (result: AllocationRoundResult) => {
    if (preview) return false;
    const rowsNow = freshRows();
    const ledgers = rowsNow.map(featureLedger);
    const applied = applyAllocationRound(ledgers, result);
    if (applied.missing.length === result.items.length) {
      // Refused: the kit keeps Save round available.
      toast.error("None of the round's features are still in the game, so nothing was saved.");
      return false;
    }
    const problem = roundPoolProblem(applied, poolOf(freshGame(), ledgers), unit);
    if (problem) {
      toast.error(problem);
      return false;
    }
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
      date: todayIso(),
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
    announce(text);
    return () => {
      for (const [id, amount] of Array.from(added)) {
        const cur = freshRow(id);
        if (cur) upsert(withRaised(cur, Math.max(0, featureLedger(cur).raised - amount), nowIso()));
      }
      ws().removeAllocationRound(saved.id);
      setLastRound(null);
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
          <KPI label="Spent" value={money(features.reduce((s, f) => s + f.raised, 0))} />
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
                <ResetButton
                  label="Refund unfunded features"
                  title="Refund the features that fell short?"
                  description={`${short.length} ${short.length === 1 ? "feature gives" : "features give"} back ${money(short.reduce((s, f) => s + f.raised, 0))} to the pool. Funded features keep their money.`}
                  confirmLabel="Refund them"
                  doneLabel={`Refunded ${short.length} unfunded ${short.length === 1 ? "feature" : "features"}`}
                  disabled={preview || short.length === 0}
                  onReset={() => {
                    const rowsNow = freshRows();
                    const refunds = refundUnfunded(rowsNow.map(featureLedger));
                    before.current = {
                      ...before.current,
                      rows: rowsNow.filter((r) => refunds.has(r.id)),
                    };
                    const now = nowIso();
                    for (const r of before.current.rows) upsert(withRaised(r, 0, now));
                  }}
                  onUndo={() => before.current.rows.forEach(upsert)}
                />
                <ResetButton
                  label="Reset game"
                  title="Reset the game?"
                  description={`Every feature's money goes back to the pool, the budget per player is cleared${rounds.length > 0 ? ` and the ${rounds.length} saved ${rounds.length === 1 ? "round is" : "rounds are"} deleted` : ""}. The features, their prices and the players stay.`}
                  confirmLabel="Reset game"
                  doneLabel="Reset the game"
                  disabled={preview}
                  variant="danger-ghost"
                  onReset={() => {
                    const rowsNow = freshRows();
                    before.current = {
                      rows: rowsNow.filter((r) => featureLedger(r).raised > 0 || r.fields?.raised),
                      game: freshGame(),
                      rounds: gameRounds(ws().allocationRounds),
                    };
                    const now = nowIso();
                    for (const r of before.current.rows) upsert(withRaised(r, 0, now));
                    if (before.current.game) writeGame({ budgetPerPlayer: undefined });
                    for (const r of before.current.rounds) ws().removeAllocationRound(r.id);
                    setLastRound(null);
                    log(BUY_FEATURE_ACTIONS.GAME_RESET, {
                      features: rowsNow.length,
                      rounds: before.current.rounds.length,
                    });
                  }}
                  onUndo={() => {
                    const b = before.current;
                    b.rows.forEach(upsert);
                    if (b.game) ws().upsertBuyAFeatureGame(b.game);
                    b.rounds.forEach((r) => ws().upsertAllocationRound(r));
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
            {next.sheet && next.budget !== null
              ? ` (round ${next.number}: ${money(next.budget)} each${next.number > 1 ? ", the pool's leftover split evenly" : ""})`
              : ""}
            , anonymously. Only each feature&apos;s total, how many backed it and the spread bands
            are kept, never anyone&apos;s split. A feature can&apos;t take more than it needs: the
            rest goes back to the pool.
          </p>
          <VoteRoundPanel
            tool="buy-a-feature"
            toolName="Buy-a-Feature"
            sheet={sheet}
            onSave={saveRound}
            blockedReason={blockedReason}
            renderResults={(r) => <p className="text-sm text-text">Saving it: {outcomeOf(r)}</p>}
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
