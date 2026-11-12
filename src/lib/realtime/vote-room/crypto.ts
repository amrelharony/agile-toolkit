/**
 * Anonymous vote rounds: the cryptography, on WebCrypto only.
 *
 * - The host holds an ECDSA P-256 signing pair for the room and signs every
 *   message it sends. Its fingerprint (SHA-256 of the raw public key, first
 *   22 base64url characters, about 128 bits) travels in the join link's
 *   `#k=` fragment, which browsers never send to the server, so participants
 *   can pin the real host before they trust anything.
 * - Each round has a fresh ECDH P-256 pair. A participant seals its answers
 *   to that key: a new ephemeral ECDH pair per ballot, the shared secret
 *   through HKDF-SHA-256 (info `agile-toolkit:vote-ballot:v1`, salt the two
 *   public keys) into an AES-GCM-256 key, a random 12-byte nonce, and an AAD
 *   binding the ballot to its round, sender and ballot id. Only the host's
 *   tab can open it, and a ballot moved to another round or sender fails.
 * - Private keys are generated non-extractable and never leave memory.
 *
 * `VoteCrypto` is an interface so the room hook can take a fake in tests.
 * No browser globals at import time: `webVoteCrypto()` looks for WebCrypto
 * when called.
 */

import { isVisitorRoomCode, joinUrl } from "../visitor-rooms";
import {
  isVoteRoomTool,
  type AnswerString,
  type BallotEnvelope,
  type HostKeys,
  type VoteRoomTool,
} from "./protocol";

export interface HostKeyPair {
  /** ECDSA P-256, one per room. */
  signing: CryptoKeyPair;
  /** ECDH P-256, one per round. */
  ecdh: CryptoKeyPair;
  publicKeys: HostKeys;
  /** `#k=` in the join link. */
  fingerprint: string;
}

export interface SealedBallot {
  epk: string;
  iv: string;
  ct: string;
}

export interface VoteCrypto {
  /** A new room: signing pair, first round's ECDH pair, fingerprint. */
  createHostKeys(): Promise<HostKeyPair>;
  /** The same room key with a fresh ECDH pair, for a new round. */
  rotateRoundKey(k: HostKeyPair): Promise<HostKeyPair>;
  /** The fingerprint of a raw signing public key (22 characters). */
  fingerprint(sigPublic: string): Promise<string>;
  /** An ECDSA signature over `input` (86 characters). */
  sign(k: HostKeyPair, input: string): Promise<string>;
  /** Whether `sig` is the key's signature over `input`. False on any malformed input. */
  verify(sigPublic: string, input: string, sig: string): Promise<boolean>;
  /** `answers` encrypted to the host's round key, bound to `aad`. */
  seal(hostEcdh: string, aad: string, answers: AnswerString): Promise<SealedBallot>;
  /**
   * The answer string inside `env`, or null if it doesn't open under this
   * round's key and `aad`. Only the sealed parts are read, so a wall room's
   * post envelope opens the same way (`wall-room/protocol.ts`).
   */
  open(
    k: HostKeyPair,
    env: Pick<BallotEnvelope, "epk" | "iv" | "ct">,
    aad: string
  ): Promise<string | null>;
}

// ── Encoding ─────────────────────────────────────────────────────────

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

/** Unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
  }
  return out;
}

/**
 * Bytes from unpadded base64url, or null for anything else. Only the
 * canonical spelling is accepted (unused low bits must be zero), so one
 * value has one encoding.
 */
export function fromBase64Url(s: string): Uint8Array | null {
  if (typeof s !== "string" || !B64URL_RE.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      n = (n << 6) | (j < chunk.length ? B64URL.indexOf(chunk[j]) : 0);
    }
    out[o++] = (n >> 16) & 255;
    if (chunk.length > 2) out[o++] = (n >> 8) & 255;
    if (chunk.length > 3) out[o++] = n & 255;
  }
  return toBase64Url(out) === s ? out : null;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A fresh ArrayBuffer holding `bytes`: WebCrypto wants a BufferSource it can trust. */
function buf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ── Link and AAD helpers ─────────────────────────────────────────────

/** Characters of the host key's fingerprint in `#k=`. */
export const FINGERPRINT_CHARS = 22;
const FINGERPRINT_RE = /^[A-Za-z0-9_-]{22}$/;
const FRAGMENT_RE = /^#k=([A-Za-z0-9_-]{22})$/;

/** A well-formed host key fingerprint. */
export function isVoteFingerprint(v: unknown): v is string {
  return typeof v === "string" && FINGERPRINT_RE.test(v);
}

/** The fingerprint in a join link's fragment (`location.hash`), or null when it is missing or malformed. */
export function readVoteLinkFragment(hash: string): string | null {
  if (typeof hash !== "string") return null;
  const m = FRAGMENT_RE.exec(hash);
  return m ? m[1] : null;
}

/**
 * The path a participant opens: `/join/<tool>/<code>#k=<fingerprint>`.
 * The fragment never reaches the server or the Vercel logs. Null when any
 * part is malformed.
 */
export function voteJoinUrl(tool: VoteRoomTool, code: string, fp: string): string | null {
  if (!isVoteRoomTool(tool) || !isVisitorRoomCode(code) || !isVoteFingerprint(fp)) return null;
  const path = joinUrl(tool, code);
  return path ? `${path}#k=${fp}` : null;
}

/** The AAD every ballot is sealed under: it can't be replayed for another round or sender. */
export function ballotAad(roundId: string, by: string, bid: string): string {
  return `agile-toolkit:vote-ballot:v1|${roundId}|${by}|${bid}`;
}

// ── WebCrypto implementation ─────────────────────────────────────────

const HKDF_INFO = "agile-toolkit:vote-ballot:v1";
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
/** A raw uncompressed P-256 point: 0x04, then x and y. */
const RAW_POINT_BYTES = 65;

function rawPoint(s: string): Uint8Array | null {
  const bytes = fromBase64Url(s);
  return bytes && bytes.length === RAW_POINT_BYTES && bytes[0] === 0x04 ? bytes : null;
}

/**
 * The VoteCrypto over a given `SubtleCrypto` and random source. Exported for
 * tests in Node; pages use `webVoteCrypto()`.
 */
export function createWebVoteCrypto(
  subtle: SubtleCrypto,
  randomBytes: (n: number) => Uint8Array
): VoteCrypto {
  const exportRaw = async (key: CryptoKey): Promise<Uint8Array> =>
    new Uint8Array(await subtle.exportKey("raw", key));

  const fingerprintOf = async (raw: Uint8Array): Promise<string> =>
    toBase64Url(new Uint8Array(await subtle.digest("SHA-256", buf(raw)))).slice(
      0,
      FINGERPRINT_CHARS
    );

  const newEcdh = (): Promise<CryptoKeyPair> =>
    subtle.generateKey(ECDH, false, ["deriveBits"]) as Promise<CryptoKeyPair>;

  /** The AES key for one ballot, from an ECDH secret and the two public keys. */
  const ballotKey = async (
    priv: CryptoKey,
    peer: Uint8Array,
    epk: Uint8Array,
    hostPub: Uint8Array,
    usage: "encrypt" | "decrypt"
  ): Promise<CryptoKey> => {
    const peerKey = await subtle.importKey("raw", buf(peer), ECDH, false, []);
    const secret = await subtle.deriveBits({ name: "ECDH", public: peerKey }, priv, 256);
    const hkdf = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    return subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: buf(concat(epk, hostPub)),
        info: buf(utf8(HKDF_INFO)),
      },
      hkdf,
      { name: "AES-GCM", length: 256 },
      false,
      [usage]
    );
  };

  // The last verifying key, so a stream of states from one host imports it once.
  let verifyCache: { raw: string; key: CryptoKey } | null = null;

  return {
    async createHostKeys() {
      const signing = (await subtle.generateKey(ECDSA, false, ["sign", "verify"])) as CryptoKeyPair;
      const ecdh = await newEcdh();
      const sigRaw = await exportRaw(signing.publicKey);
      const ecdhRaw = await exportRaw(ecdh.publicKey);
      return {
        signing,
        ecdh,
        publicKeys: { sig: toBase64Url(sigRaw), ecdh: toBase64Url(ecdhRaw) },
        fingerprint: await fingerprintOf(sigRaw),
      };
    },

    async rotateRoundKey(k) {
      const ecdh = await newEcdh();
      const ecdhRaw = await exportRaw(ecdh.publicKey);
      return { ...k, ecdh, publicKeys: { ...k.publicKeys, ecdh: toBase64Url(ecdhRaw) } };
    },

    async fingerprint(sigPublic) {
      const raw = rawPoint(sigPublic);
      if (!raw) throw new Error("not a P-256 public key");
      return fingerprintOf(raw);
    },

    async sign(k, input) {
      const sig = await subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        k.signing.privateKey,
        buf(utf8(input))
      );
      return toBase64Url(new Uint8Array(sig));
    },

    async verify(sigPublic, input, sig) {
      try {
        const raw = rawPoint(sigPublic);
        const sigBytes = fromBase64Url(sig);
        if (!raw || !sigBytes || sigBytes.length !== 64) return false;
        let key = verifyCache?.raw === sigPublic ? verifyCache.key : null;
        if (!key) {
          key = await subtle.importKey("raw", buf(raw), ECDSA, false, ["verify"]);
          verifyCache = { raw: sigPublic, key };
        }
        return await subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          buf(sigBytes),
          buf(utf8(input))
        );
      } catch {
        return false;
      }
    },

    async seal(hostEcdh, aad, answers) {
      const hostPub = rawPoint(hostEcdh);
      if (!hostPub) throw new Error("not a P-256 public key");
      const eph = await newEcdh();
      const epk = await exportRaw(eph.publicKey);
      const key = await ballotKey(eph.privateKey, hostPub, epk, hostPub, "encrypt");
      const iv = randomBytes(12);
      const ct = await subtle.encrypt(
        { name: "AES-GCM", iv: buf(iv), additionalData: buf(utf8(aad)), tagLength: 128 },
        key,
        buf(utf8(answers))
      );
      return { epk: toBase64Url(epk), iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) };
    },

    async open(k, env, aad) {
      try {
        const epk = rawPoint(env.epk);
        const hostPub = rawPoint(k.publicKeys.ecdh);
        const iv = fromBase64Url(env.iv);
        const ct = fromBase64Url(env.ct);
        if (!epk || !hostPub || !iv || iv.length !== 12 || !ct) return null;
        const key = await ballotKey(k.ecdh.privateKey, epk, epk, hostPub, "decrypt");
        const plain = await subtle.decrypt(
          { name: "AES-GCM", iv: buf(iv), additionalData: buf(utf8(aad)), tagLength: 128 },
          key,
          buf(ct)
        );
        return new TextDecoder("utf-8", { fatal: true }).decode(plain);
      } catch {
        return null;
      }
    },
  };
}

/**
 * WebCrypto's VoteCrypto, or null where vote rounds can't run: no
 * `crypto.subtle`, or a page that isn't a secure context (plain HTTP;
 * localhost counts as secure).
 */
export function webVoteCrypto(): VoteCrypto | null {
  const g = globalThis as { isSecureContext?: boolean; crypto?: Crypto };
  if (g.isSecureContext === false) return null;
  const c = g.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== "function") return null;
  return createWebVoteCrypto(c.subtle, (n) => c.getRandomValues(new Uint8Array(n)));
}
