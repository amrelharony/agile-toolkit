/**
 * Shared fixtures for the vote-room tests: a questionnaire, a fake
 * `VoteCrypto` that runs in jsdom (WebCrypto doesn't), and helpers that
 * build what a real host or participant would send.
 *
 * The fake is deterministic, not secure: a "signature" is a hash of the
 * key and the input, and a "ciphertext" is the answers XORed with a
 * keystream from the round key and the AAD, plus a 16-byte tag. It keeps
 * the properties the hook relies on: only the right key verifies or opens,
 * a changed AAD or body fails, and the ciphertext has the real length.
 */

import type { HostKeyPair, VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { fromBase64Url, toBase64Url } from "@/lib/realtime/vote-room/crypto";
import {
  ANSWER_ALPHABET,
  VOTE_ROOM_EVENTS,
  signingInput,
  type BallotEnvelope,
  type Questionnaire,
  type RevealedQuestion,
  type VoteRoomTool,
  type VoteStateBody,
  type VoteStateMessage,
} from "@/lib/realtime/vote-room/protocol";
import type { AllocationRoomTool } from "@/lib/realtime/vote-room/protocol";
import {
  KANO_PAIR_ANSWERS,
  KANO_PAIR_PROMPTS,
  PAIR_ALPHABET,
  type PairSheet,
  type PairStateBody,
  type RevealedPair,
} from "@/lib/realtime/vote-room/pair";
import type {
  AllocationSheet,
  AllocationStateBody,
  RevealedAllocation,
} from "@/lib/realtime/vote-room/allocation";

export const CODE = "ABCDEFGHJKMN";
export const NOW = Date.parse("2026-10-26T10:00:00.000Z");

/** Three questions on a traffic-light scale; the last one is optional. */
export const QUESTIONNAIRE: Questionnaire = {
  id: "health-check:default",
  title: "Squad health",
  scale: {
    id: "traffic",
    points: [
      { value: 2, label: "Green" },
      { value: 1, label: "Yellow" },
      { value: 0, label: "Red" },
    ],
  },
  questions: [
    { id: "fun", text: "Fun", hint: "We love going to work" },
    { id: "speed", text: "Speed" },
    { id: "learning", text: "Learning", optional: true },
  ],
};

// ── A tiny deterministic hash (FNV-1a variants), base64url out ───────

function hashBytes(input: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let h = 0x811c9dc5;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < input.length; j++) {
      h ^= input.charCodeAt(j) + i;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out[i] = h & 0xff;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

let keyCounter = 0;

/** A raw-looking public key string: 87 base64url characters (0x04 and 64 bytes). */
function fakePublicKey(tag: string): string {
  return toBase64Url(concat(Uint8Array.of(0x04), hashBytes(tag, 64)));
}

function keystream(key: string, aad: string, n: number): Uint8Array {
  return hashBytes(`stream|${key}|${aad}`, n);
}

export interface FakeVoteCrypto extends VoteCrypto {
  /** Calls made, for assertions. */
  calls: { sign: number; verify: number; open: number; seal: number };
}

export function fakeVoteCrypto(): FakeVoteCrypto {
  const calls = { sign: 0, verify: 0, open: 0, seal: 0 };
  const fingerprintOf = (sigPublic: string) =>
    toBase64Url(hashBytes(`fp|${sigPublic}`, 17)).slice(0, 22);
  const sigOf = (sigPublic: string, input: string) =>
    toBase64Url(hashBytes(`sig|${sigPublic}|${input}`, 64));
  return {
    calls,
    async createHostKeys() {
      keyCounter += 1;
      const sig = fakePublicKey(`room-${keyCounter}`);
      const ecdh = fakePublicKey(`round-${keyCounter}-0`);
      const dummy = {} as CryptoKeyPair;
      return {
        signing: dummy,
        ecdh: dummy,
        publicKeys: { sig, ecdh },
        fingerprint: fingerprintOf(sig),
      };
    },
    async rotateRoundKey(k: HostKeyPair) {
      keyCounter += 1;
      return { ...k, publicKeys: { ...k.publicKeys, ecdh: fakePublicKey(`round-${keyCounter}`) } };
    },
    async fingerprint(sigPublic: string) {
      return fingerprintOf(sigPublic);
    },
    async sign(k: HostKeyPair, input: string) {
      calls.sign++;
      return sigOf(k.publicKeys.sig, input);
    },
    async verify(sigPublic: string, input: string, sig: string) {
      calls.verify++;
      return sigOf(sigPublic, input) === sig;
    },
    async seal(hostEcdh: string, aad: string, answers: string) {
      calls.seal++;
      const plain = utf8(answers);
      const ks = keystream(hostEcdh, aad, plain.length);
      const body = plain.map((b, i) => b ^ ks[i]);
      const tag = hashBytes(`tag|${hostEcdh}|${aad}|${answers}`, 16);
      return {
        epk: fakePublicKey(`eph-${aad}`),
        iv: toBase64Url(hashBytes(`iv|${aad}`, 12)),
        ct: toBase64Url(concat(body, tag)),
      };
    },
    async open(k: HostKeyPair, env: BallotEnvelope, aad: string) {
      calls.open++;
      const bytes = fromBase64Url(env.ct);
      if (!bytes || bytes.length < 17) return null;
      const body = bytes.slice(0, bytes.length - 16);
      const ks = keystream(k.publicKeys.ecdh, aad, body.length);
      const answers = new TextDecoder().decode(body.map((b, i) => b ^ ks[i]));
      const tag = toBase64Url(hashBytes(`tag|${k.publicKeys.ecdh}|${aad}|${answers}`, 16));
      return tag === toBase64Url(bytes.slice(bytes.length - 16)) ? answers : null;
    },
  };
}

// ── What a host sends ────────────────────────────────────────────────

export interface StateOverrides {
  seq?: number;
  roundId?: string;
  phase?: "open" | "revealed";
  ballots?: number;
  acks?: string[];
  revealed?: RevealedQuestion[] | null;
  minN?: number;
  questionnaire?: Questionnaire;
  tool?: VoteRoomTool;
  endsAt?: number;
}

export const ROUND = "round_000001";

/**
 * A scale round's state as the host builds it. `endsAt` defaults to 3 h
 * from the clock, as the v2 fixtures' do: tests on fake timers (set to
 * `NOW`) get `NOW` + 3 h as before, and a participant test on the real
 * clock no longer sees the room closed once 13:00 UTC on 2026-10-26 passes.
 */
export function stateBody(by: string, keys: HostKeyPair, o: StateOverrides = {}): VoteStateBody {
  return {
    v: 1,
    by,
    seq: o.seq ?? 1,
    tool: o.tool ?? "health-check",
    roundId: o.roundId ?? ROUND,
    endsAt: o.endsAt ?? Date.now() + 3 * 60 * 60 * 1000,
    minN: o.minN ?? 3,
    questionnaire: o.questionnaire ?? QUESTIONNAIRE,
    keys: keys.publicKeys,
    phase: o.phase ?? "open",
    ballots: o.ballots ?? 0,
    acks: o.acks ?? [],
    revealed: o.revealed ?? null,
  };
}

/** A state as the host would sign it (JSON round-tripped like the wire). */
export async function signedState(
  c: VoteCrypto,
  by: string,
  keys: HostKeyPair,
  o: StateOverrides = {}
): Promise<VoteStateMessage> {
  const body = stateBody(by, keys, o);
  const sig = await c.sign(keys, signingInput(VOTE_ROOM_EVENTS.state, body));
  return JSON.parse(JSON.stringify({ ...body, sig })) as VoteStateMessage;
}

export async function signedKick(c: VoteCrypto, by: string, keys: HostKeyPair, id: string) {
  const body = { v: 1 as const, by, id };
  return { ...body, sig: await c.sign(keys, signingInput(VOTE_ROOM_EVENTS.kick, body)) };
}

export async function signedEnd(
  c: VoteCrypto,
  by: string,
  keys: HostKeyPair,
  reason: "host" | "idle" | "expired" = "host"
) {
  const body = { v: 1 as const, by, reason };
  return { ...body, sig: await c.sign(keys, signingInput(VOTE_ROOM_EVENTS.end, body)) };
}

/** The answer string for point indexes (-1 skipped). */
export function answerString(indexes: number[]): string {
  return indexes.map((i) => (i < 0 ? "-" : ANSWER_ALPHABET[i])).join("");
}

// ── Pair (Kano) and allocation rounds ────────────────────────────────

/** Three features on Kano's five answers; the last one is optional. */
export const PAIR_SHEET: PairSheet = {
  id: "kano:round",
  title: "Feature survey",
  prompts: { ...KANO_PAIR_PROMPTS },
  answers: [...KANO_PAIR_ANSWERS],
  items: [
    { id: "dark", text: "Dark mode", hint: "Across the whole app" },
    { id: "export", text: "CSV export" },
    { id: "emoji", text: "Emoji reactions", optional: true },
  ],
};

/** A $100 Test sheet: four items, $100 each, all of it given out. */
export const ALLOCATION_SHEET: AllocationSheet = {
  id: "hundred:round",
  title: "Where would you put $100?",
  budget: 100,
  unit: "$",
  spendAll: true,
  items: [
    { id: "search", text: "Search" },
    { id: "export", text: "Exports" },
    { id: "sso", text: "Single sign-on" },
    { id: "themes", text: "Themes" },
  ],
};

/** A Buy-a-Feature sheet: $50 each to give, up to it, features capped at what's left of their price. */
export const BUY_SHEET: AllocationSheet = {
  id: "buy:round-1",
  title: "Buy-a-Feature, round 1",
  budget: 50,
  unit: "$",
  spendAll: false,
  items: [
    { id: "search", text: "Search", cap: 60 },
    { id: "export", text: "Exports", cap: 30, hint: "Priced 40, 10 raised" },
    { id: "sso", text: "Single sign-on", cap: 120 },
  ],
};

/** The split string for amounts at `width` digits each. */
export function allocationString(amounts: number[], width: number): string {
  return amounts.map((a) => String(a).padStart(width, "0")).join("");
}

/** The pair answer string for joint indexes (-1 skipped). */
export function pairString(joints: number[]): string {
  return joints.map((j) => (j < 0 ? "-" : PAIR_ALPHABET[j])).join("");
}

export interface KindStateOverrides {
  seq?: number;
  roundId?: string;
  phase?: "open" | "revealed";
  ballots?: number;
  acks?: string[];
  minN?: number;
  endsAt?: number;
}

/** A pair round's state as the host builds it. `endsAt` defaults to 3 h from the real clock. */
export function pairStateBody(
  by: string,
  keys: Pick<HostKeyPair, "publicKeys">,
  o: KindStateOverrides & { sheet?: PairSheet; revealed?: RevealedPair[] | null } = {}
): PairStateBody {
  return {
    v: 2,
    kind: "pair",
    by,
    seq: o.seq ?? 1,
    tool: "kano-model",
    roundId: o.roundId ?? ROUND,
    endsAt: o.endsAt ?? Date.now() + 3 * 60 * 60 * 1000,
    minN: o.minN ?? 3,
    sheet: o.sheet ?? PAIR_SHEET,
    keys: keys.publicKeys,
    phase: o.phase ?? "open",
    ballots: o.ballots ?? 0,
    acks: o.acks ?? [],
    revealed: o.revealed ?? null,
  };
}

/** An allocation round's state as the host builds it. `endsAt` defaults to 3 h from the real clock. */
export function allocationStateBody(
  by: string,
  keys: Pick<HostKeyPair, "publicKeys">,
  o: KindStateOverrides & {
    sheet?: AllocationSheet;
    tool?: AllocationRoomTool;
    revealed?: RevealedAllocation[] | null;
  } = {}
): AllocationStateBody {
  return {
    v: 2,
    kind: "allocation",
    by,
    seq: o.seq ?? 1,
    tool: o.tool ?? "hundred-dollar-test",
    roundId: o.roundId ?? ROUND,
    endsAt: o.endsAt ?? Date.now() + 3 * 60 * 60 * 1000,
    minN: o.minN ?? 3,
    sheet: o.sheet ?? ALLOCATION_SHEET,
    keys: keys.publicKeys,
    phase: o.phase ?? "open",
    ballots: o.ballots ?? 0,
    acks: o.acks ?? [],
    revealed: o.revealed ?? null,
  };
}

/** A v2 state as the host would sign it (JSON round-tripped like the wire). */
export async function signedKindState<B extends PairStateBody | AllocationStateBody>(
  c: VoteCrypto,
  keys: HostKeyPair,
  body: B
): Promise<B & { sig: string }> {
  const sig = await c.sign(keys, signingInput(VOTE_ROOM_EVENTS.state, body));
  return JSON.parse(JSON.stringify({ ...body, sig })) as B & { sig: string };
}
