/**
 * Fixtures for Quick Vote's kinds of round (choice, rank, number): sheets
 * and v3 state bodies as a host builds them. Shares `vote-room-fixtures.ts`'s
 * fake crypto and ids.
 */

import type { HostKeyPair, VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS, signingInput } from "@/lib/realtime/vote-room/protocol";
import type { ChoiceSheet, ChoiceStateBody, RevealedChoice } from "@/lib/realtime/vote-room/choice";
import type { RankSheet, RankStateBody, RevealedRank } from "@/lib/realtime/vote-room/rank";
import type { NumberSheet, NumberStateBody, RevealedNumber } from "@/lib/realtime/vote-room/number";
import { ROUND } from "./vote-room-fixtures";

/** A single-pick poll of three options. */
export const POLL_SHEET: ChoiceSheet = {
  id: "quick:poll",
  title: "Where should we hold the retro?",
  mode: "single",
  limit: 1,
  options: [
    { id: "room", text: "Meeting room" },
    { id: "cafe", text: "Cafe", hint: "Round the corner" },
    { id: "online", text: "Online" },
  ],
};

/** Pick up to two of four. */
export const MULTI_SHEET: ChoiceSheet = {
  id: "quick:multi",
  title: "Which topics?",
  mode: "multi",
  limit: 2,
  options: [
    { id: "a", text: "Flaky tests" },
    { id: "b", text: "On-call" },
    { id: "c", text: "Planning" },
    { id: "d", text: "Demos" },
  ],
};

/** Three dots each across four options. */
export const DOTS_SHEET: ChoiceSheet = {
  id: "quick:dots",
  title: "Dot vote",
  mode: "dots",
  limit: 3,
  options: [
    { id: "a", text: "Flaky tests" },
    { id: "b", text: "On-call" },
    { id: "c", text: "Planning" },
    { id: "d", text: "Demos" },
  ],
};

/** Four options to put in order. */
export const RANK_SHEET: RankSheet = {
  id: "quick:rank",
  title: "Rank the goals",
  options: [
    { id: "speed", text: "Ship faster" },
    { id: "quality", text: "Fewer bugs" },
    { id: "joy", text: "Happier team" },
    { id: "cost", text: "Lower cost" },
  ],
};

/** A whole number from 0 to 100, in %. */
export const NUMBER_SHEET: NumberSheet = {
  id: "quick:confidence",
  title: "How confident are you?",
  min: 0,
  max: 100,
  decimals: 0,
  unit: "%",
};

export interface V3Overrides {
  seq?: number;
  roundId?: string;
  phase?: "open" | "revealed";
  ballots?: number;
  acks?: string[];
  minN?: number;
  endsAt?: number;
}

function head(by: string, keys: Pick<HostKeyPair, "publicKeys">, o: V3Overrides) {
  return {
    v: 3 as const,
    by,
    seq: o.seq ?? 1,
    tool: "quick-vote" as const,
    roundId: o.roundId ?? ROUND,
    endsAt: o.endsAt ?? Date.now() + 3 * 60 * 60 * 1000,
    minN: o.minN ?? 3,
    keys: keys.publicKeys,
    phase: o.phase ?? ("open" as const),
    ballots: o.ballots ?? 0,
    acks: o.acks ?? [],
  };
}

export function choiceStateBody(
  by: string,
  keys: Pick<HostKeyPair, "publicKeys">,
  o: V3Overrides & { sheet?: ChoiceSheet; revealed?: RevealedChoice[] | null } = {}
): ChoiceStateBody {
  const h = head(by, keys, o);
  return {
    v: h.v,
    kind: "choice",
    by: h.by,
    seq: h.seq,
    tool: h.tool,
    roundId: h.roundId,
    endsAt: h.endsAt,
    minN: h.minN,
    sheet: o.sheet ?? POLL_SHEET,
    keys: h.keys,
    phase: h.phase,
    ballots: h.ballots,
    acks: h.acks,
    revealed: o.revealed ?? null,
  };
}

export function rankStateBody(
  by: string,
  keys: Pick<HostKeyPair, "publicKeys">,
  o: V3Overrides & { sheet?: RankSheet; revealed?: RevealedRank[] | null } = {}
): RankStateBody {
  const h = head(by, keys, o);
  return {
    v: h.v,
    kind: "rank",
    by: h.by,
    seq: h.seq,
    tool: h.tool,
    roundId: h.roundId,
    endsAt: h.endsAt,
    minN: h.minN,
    sheet: o.sheet ?? RANK_SHEET,
    keys: h.keys,
    phase: h.phase,
    ballots: h.ballots,
    acks: h.acks,
    revealed: o.revealed ?? null,
  };
}

export function numberStateBody(
  by: string,
  keys: Pick<HostKeyPair, "publicKeys">,
  o: V3Overrides & { sheet?: NumberSheet; revealed?: RevealedNumber | null } = {}
): NumberStateBody {
  const h = head(by, keys, o);
  return {
    v: h.v,
    kind: "number",
    by: h.by,
    seq: h.seq,
    tool: h.tool,
    roundId: h.roundId,
    endsAt: h.endsAt,
    minN: h.minN,
    sheet: o.sheet ?? NUMBER_SHEET,
    keys: h.keys,
    phase: h.phase,
    ballots: h.ballots,
    acks: h.acks,
    revealed: o.revealed ?? null,
  };
}

/** A v3 state as the host would sign it (JSON round-tripped like the wire). */
export async function signedV3<B extends ChoiceStateBody | RankStateBody | NumberStateBody>(
  c: VoteCrypto,
  keys: HostKeyPair,
  body: B
): Promise<B & { sig: string }> {
  const sig = await c.sign(keys, signingInput(VOTE_ROOM_EVENTS.state, body));
  return JSON.parse(JSON.stringify({ ...body, sig })) as B & { sig: string };
}
