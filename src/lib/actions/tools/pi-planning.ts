/**
 * PI Planning — tool-local actions.
 *
 * Category: Portfolio & Scaling (tools plan, phase 2, P2.6b)
 * Tool:     the SAFe PI board: teams × iterations, PI objectives with
 *           business value, ROAM risks, a confidence vote and predictability.
 *
 * Agent surface: tool.pi_planning.* (reads only this phase)
 *
 *   1. list_state     — the teams, the items by kind, the objectives with
 *                       their planned and actual business value, the risks
 *                       by ROAM status with the ones still to sort, and the
 *                       latest confidence vote (totals only).
 *   2. predictability — per team, the train's total against the band, and
 *                       the closed PIs with their average.
 *
 * The board is the page's synced blob ("agile-toolkit:pi-planning"): in the
 * tab both verbs read this browser's copy, over MCP the user's saved row
 * (`readUserStateBlob`), and both read it through the page's own
 * normaliser (lib/pi-planning/model).
 *
 * No write verbs yet. The blob writer covers an MCP write, but in the tab a
 * write with the page closed still needs a bridge to the open page (as
 * Audience Wall's room verbs have), or the next load's cloud pull would put
 * the old board back over it. Setting ROAM, scoring an objective, saving a
 * vote and closing the PI stay on the page for now.
 *
 * Server-safe: the pure model, ROAM, confidence and predictability modules
 * only, never the page's "use client" store.
 */

import { z } from "zod";
import { registry } from "../registry";
import { readUserStateBlob } from "../user-state-blob";
import { findLink } from "@/lib/handoffs/links";
import { isExampleId } from "@/lib/utils/example-id";
import {
  PI_STORAGE_KEY,
  PI_ITEM_KINDS,
  normalizePiState,
  type PiItem,
  type PiState,
} from "@/lib/pi-planning/model";
import { ROAM_GROUPS, roamGroups, roamVerdict } from "@/lib/pi-planning/roam";
import { latestVote, scopeLabel, voteAverage } from "@/lib/pi-planning/confidence";
import {
  historyAverage,
  piPredictability,
  predictabilityVerdict,
  recordPct,
} from "@/lib/pi-planning/predictability";

const TOOL = "tool.pi_planning";

/** The board on this transport: the tab's copy, or the user's row over MCP. */
async function readBoard(userId?: string): Promise<PiState> {
  return normalizePiState(await readUserStateBlob(PI_STORAGE_KEY, userId));
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function stateSummary(s: PiState) {
  const team = (id: string) => s.teams.find((t) => t.id === id)?.name ?? "";
  const shown = s.items.filter((i) => i.iteration < s.iterations);
  const itemRow = (i: PiItem) => ({
    id: i.id,
    title: i.title,
    team: team(i.teamId),
    iteration: i.iteration + 1,
    ...(i.points !== undefined ? { points: i.points } : {}),
    ...(i.kind === "dependency" && i.dependsOn ? { waitsOn: i.dependsOn } : {}),
  });
  const groups = roamGroups(s);
  const riskRow = (i: PiItem) => ({
    id: i.id,
    title: i.title,
    team: team(i.teamId),
    ...(i.roamOwner ? { owner: i.roamOwner } : {}),
    ...(i.roamNote ? { note: i.roamNote } : {}),
    sentToRiskRegister: Boolean(findLink(i.sentTo, "risk")),
  });
  const vote = latestVote(s);
  return {
    name: s.name ?? null,
    example: s.teams.some((t) => isExampleId(t.id)),
    iterations: s.iterations,
    teams: s.teams.map((t) => ({ id: t.id, name: t.name, velocity: t.velocity ?? null })),
    items: Object.fromEntries(
      PI_ITEM_KINDS.map((k) => [k, shown.filter((i) => i.kind === k).map(itemRow)])
    ),
    objectives: (s.objectives ?? []).map((o) => ({
      id: o.id,
      team: team(o.teamId),
      title: o.title,
      committed: o.committed,
      businessValue: o.businessValue ?? null,
      actualBusinessValue: o.actualBusinessValue ?? null,
    })),
    roam: Object.fromEntries(
      ROAM_GROUPS.filter((g) => g !== "unsorted").map((g) => [g, groups[g].map(riskRow)])
    ),
    toSort: groups.unsorted.map(riskRow),
    roamVerdict: roamVerdict(s),
    latestConfidence: vote
      ? {
          scope: vote.scope,
          scopeName: scopeLabel(s, vote.scope, vote.scopeName),
          average: round1(voteAverage(vote.counts)),
          counts: vote.counts,
          ballots: vote.ballots,
          at: vote.at,
        }
      : null,
  };
}

function predictabilitySummary(s: PiState) {
  const p = piPredictability(s);
  return {
    band: p.band,
    teams: p.teams,
    total: p.total,
    verdict: predictabilityVerdict(p),
    history: (s.history ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      closedAt: r.closedAt,
      predictability: recordPct(r),
      teams: r.teams,
    })),
    historyAverage: historyAverage(s.history),
  };
}

// ──────── tool.pi_planning.list_state ────────
registry.register({
  id: `${TOOL}.list_state`,
  toolId: TOOL,
  name: "list_state",
  category: "read",
  description:
    "PI Planning's board: {name, example, iterations, teams {id, name, velocity}[], items {feature, dependency, risk} each {id, title, team, iteration (from 1), points?, waitsOn?}[], objectives {id, team, title, committed, businessValue, actualBusinessValue}[], roam {resolved, owned, accepted, mitigated} each {id, title, team, owner?, note?, sentToRiskRegister}[], toSort (the risks with no ROAM status yet), roamVerdict, latestConfidence {scope ('train' or a team id), scopeName, average (1–5), counts (votes per point 1–5), ballots, at} | null}. Read-only: ROAM, actual values, votes and closing a PI are set on the page.",
  paramsSchema: z.object({}),
  handler: async () => stateSummary(await readBoard()),
  mcpHandler: async (_params, ctx) => stateSummary(await readBoard(ctx.userId)),
});

// ──────── tool.pi_planning.predictability ────────
registry.register({
  id: `${TOOL}.predictability`,
  toolId: TOOL,
  name: "predictability",
  category: "read",
  description:
    "PI predictability: {band {low, high} (percent, 80–100 unless the train set its own), teams {teamId, name, plannedBv (committed objectives' business value), actualBv (actual value over every objective), toScore (committed objectives still to score), pct | null, status ('nothing-planned' | 'to-score' | 'below' | 'within' | 'above')}[], total (the scored teams together) {plannedBv, actualBv, pct, status, teams} | null, verdict, history (closed PIs) {id, name, closedAt, predictability, teams}[], historyAverage {pct, count} | null (from 3 closed PIs)}.",
  paramsSchema: z.object({}),
  handler: async () => predictabilitySummary(await readBoard()),
  mcpHandler: async (_params, ctx) => predictabilitySummary(await readBoard(ctx.userId)),
});
