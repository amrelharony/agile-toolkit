// @vitest-environment node
// jsdom's crypto can't run these: the real WebCrypto lives in Node.
import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  FINGERPRINT_CHARS,
  ballotAad,
  createWebVoteCrypto,
  fromBase64Url,
  readVoteLinkFragment,
  toBase64Url,
  voteJoinUrl,
  webVoteCrypto,
} from "@/lib/realtime/vote-room/crypto";
import { ballotCiphertextChars, type BallotEnvelope } from "@/lib/realtime/vote-room/protocol";

/**
 * The vote room's cryptography on real WebCrypto: ballots open only under
 * the round's key and the exact AAD, the host's signatures verify only
 * under its key, the fingerprint is stable, and every ballot of a round is
 * the same size.
 */

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const c = createWebVoteCrypto(subtle, (n) => webcrypto.getRandomValues(new Uint8Array(n)));

const ROUND = "round_000001";
const BY = "alice_0000000000";
const BID = "bid_00000001";
const CODE = "ABCDEFGHJKMN";

function envelope(
  sealed: { epk: string; iv: string; ct: string },
  over: Partial<BallotEnvelope> = {}
) {
  return { v: 1 as const, by: BY, roundId: ROUND, bid: BID, ...sealed, ...over };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base64url", () => {
  it("round-trips and accepts only the canonical, unpadded spelling", () => {
    for (const n of [0, 1, 2, 3, 12, 64, 65]) {
      const bytes = webcrypto.getRandomValues(new Uint8Array(n));
      const s = toBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(fromBase64Url(s)!)).toEqual(Array.from(bytes));
    }
    expect(fromBase64Url("AB==")).toBeNull();
    expect(fromBase64Url("A")).toBeNull();
    expect(Array.from(fromBase64Url("AQ")!)).toEqual([1]);
    expect(fromBase64Url("AB")).toBeNull(); // non-zero unused bits
    expect(fromBase64Url("a+b/")).toBeNull();
  });
});

describe("host keys", () => {
  it("are P-256 points as 87-character base64url, with a 22-character stable fingerprint", async () => {
    const k = await c.createHostKeys();
    expect(k.publicKeys.sig).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(k.publicKeys.ecdh).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(fromBase64Url(k.publicKeys.sig)?.[0]).toBe(0x04);
    expect(k.fingerprint).toHaveLength(FINGERPRINT_CHARS);
    expect(await c.fingerprint(k.publicKeys.sig)).toBe(k.fingerprint);
    const other = await c.createHostKeys();
    expect(other.fingerprint).not.toBe(k.fingerprint);
  });

  it("keep their private keys non-extractable", async () => {
    const k = await c.createHostKeys();
    expect(k.signing.privateKey.extractable).toBe(false);
    expect(k.ecdh.privateKey.extractable).toBe(false);
  });

  it("rotate the round key but keep the room key", async () => {
    const k = await c.createHostKeys();
    const next = await c.rotateRoundKey(k);
    expect(next.publicKeys.sig).toBe(k.publicKeys.sig);
    expect(next.fingerprint).toBe(k.fingerprint);
    expect(next.publicKeys.ecdh).not.toBe(k.publicKeys.ecdh);
  });

  it("refuse a fingerprint for something that isn't a key", async () => {
    await expect(c.fingerprint("A".repeat(87))).rejects.toThrow();
  });
});

describe("signatures", () => {
  it("verify under the host's key only, for the exact input", async () => {
    const k = await c.createHostKeys();
    const sig = await c.sign(k, "hello");
    expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(await c.verify(k.publicKeys.sig, "hello", sig)).toBe(true);
    expect(await c.verify(k.publicKeys.sig, "hellp", sig)).toBe(false);
    const other = await c.createHostKeys();
    expect(await c.verify(other.publicKeys.sig, "hello", sig)).toBe(false);
    expect(await c.verify(other.publicKeys.sig, "hello", await c.sign(other, "hello"))).toBe(true);
  });

  it("are false, not an error, for malformed keys or signatures", async () => {
    const k = await c.createHostKeys();
    expect(await c.verify("nope", "x", "y")).toBe(false);
    expect(await c.verify(k.publicKeys.sig, "x", "s".repeat(86))).toBe(false);
    expect(await c.verify(k.publicKeys.ecdh, "x", await c.sign(k, "x"))).toBe(false);
  });
});

describe("ballots", () => {
  it("open under the round key and the same AAD", async () => {
    const k = await c.createHostKeys();
    const aad = ballotAad(ROUND, BY, BID);
    const sealed = await c.seal(k.publicKeys.ecdh, aad, "02-");
    expect(sealed.epk).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(sealed.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(sealed.ct).not.toContain("02-");
    expect(await c.open(k, envelope(sealed), aad)).toBe("02-");
  });

  it("open to null when the ciphertext or nonce is tampered with", async () => {
    const k = await c.createHostKeys();
    const aad = ballotAad(ROUND, BY, BID);
    const sealed = await c.seal(k.publicKeys.ecdh, aad, "012");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(await c.open(k, envelope({ ...sealed, ct: flip(sealed.ct) }), aad)).toBeNull();
    expect(await c.open(k, envelope({ ...sealed, iv: flip(sealed.iv) }), aad)).toBeNull();
    expect(await c.open(k, envelope({ ...sealed, epk: "A".repeat(87) }), aad)).toBeNull();
  });

  it("open to null under an AAD for another sender, round or ballot", async () => {
    const k = await c.createHostKeys();
    const sealed = await c.seal(k.publicKeys.ecdh, ballotAad(ROUND, BY, BID), "012");
    for (const aad of [
      ballotAad(ROUND, "mallory_00000000", BID),
      ballotAad("round_000002", BY, BID),
      ballotAad(ROUND, BY, "bid_00000002"),
    ]) {
      expect(await c.open(k, envelope(sealed), aad)).toBeNull();
    }
  });

  it("don't open under the previous round's key", async () => {
    const k = await c.createHostKeys();
    const aad = ballotAad(ROUND, BY, BID);
    const sealedOld = await c.seal(k.publicKeys.ecdh, aad, "012");
    const next = await c.rotateRoundKey(k);
    expect(await c.open(next, envelope(sealedOld), aad)).toBeNull();
    const sealedNew = await c.seal(next.publicKeys.ecdh, aad, "012");
    expect(await c.open(k, envelope(sealedNew), aad)).toBeNull();
    expect(await c.open(next, envelope(sealedNew), aad)).toBe("012");
  });

  it("are the same length for every answer pattern of a round", async () => {
    const k = await c.createHostKeys();
    const aad = ballotAad(ROUND, BY, BID);
    const lengths = new Set<number>();
    for (const answers of ["000", "aaa", "-1-", "9a0", "---"]) {
      lengths.add((await c.seal(k.publicKeys.ecdh, aad, answers)).ct.length);
    }
    expect(Array.from(lengths)).toEqual([ballotCiphertextChars(3)]);
  });

  it("use a fresh ephemeral key and nonce every time", async () => {
    const k = await c.createHostKeys();
    const aad = ballotAad(ROUND, BY, BID);
    const a = await c.seal(k.publicKeys.ecdh, aad, "012");
    const b = await c.seal(k.publicKeys.ecdh, aad, "012");
    expect(a.epk).not.toBe(b.epk);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("refuse to seal to something that isn't a key", async () => {
    await expect(c.seal("A".repeat(87), "aad", "0")).rejects.toThrow();
  });
});

describe("webVoteCrypto", () => {
  it("is null without crypto.subtle", () => {
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    expect(webVoteCrypto()).toBeNull();
  });

  it("is null outside a secure context", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(webVoteCrypto()).toBeNull();
  });

  it("works where WebCrypto does", async () => {
    vi.stubGlobal("isSecureContext", true);
    const real = webVoteCrypto();
    expect(real).not.toBeNull();
    const k = await real!.createHostKeys();
    expect(k.fingerprint).toHaveLength(22);
  });
});

describe("link helpers", () => {
  const FP = "abcdefghijklmnopqrstuv";

  it("readVoteLinkFragment takes exactly #k= and 22 base64url characters", () => {
    expect(readVoteLinkFragment(`#k=${FP}`)).toBe(FP);
    for (const bad of [
      "",
      "#",
      `#k=${FP.slice(1)}`,
      `#k=${FP}x`,
      `#K=${FP}`,
      `k=${FP}`,
      `#k=${FP.slice(0, 21)}+`,
      `#x=1&k=${FP}`,
    ]) {
      expect(readVoteLinkFragment(bad)).toBeNull();
    }
  });

  it("voteJoinUrl appends the fragment to the join path, and is null for bad parts", () => {
    expect(voteJoinUrl("health-check", CODE, FP)).toBe(`/join/health-check/${CODE}#k=${FP}`);
    expect(voteJoinUrl("health-check", "ABC123", FP)).toBeNull();
    expect(voteJoinUrl("health-check", CODE, "short")).toBeNull();
    expect(voteJoinUrl("retro" as "health-check", CODE, FP)).toBeNull();
  });

  it("ballotAad binds the round, the sender and the ballot", () => {
    expect(ballotAad(ROUND, BY, BID)).toBe(`agile-toolkit:vote-ballot:v1|${ROUND}|${BY}|${BID}`);
  });
});
