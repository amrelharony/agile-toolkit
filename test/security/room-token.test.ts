// @vitest-environment node
/**
 * Room tokens for private Realtime channels (lib/realtime/room-token), and the
 * database policy that reads them (migration 0026).
 *
 * The token is what Supabase checks when someone joins a private room, so the
 * claims are the security boundary: `role` must be `anon` (a leaked token is
 * then no better than the public anon key), owners get `room_owner`, guests get
 * exactly their `rooms`, and anything not signed by us, or expired, is refused.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ROOM_TOKEN_ISSUER,
  ROOM_TOKEN_TTL_SECONDS,
  mintRoomToken,
  privateRoomsConfigured,
  verifyRoomToken,
} from "@/lib/realtime/room-token";

const SECRET = "test-legacy-jwt-secret-with-at-least-32-characters";
const NOW = new Date("2026-10-19T12:00:00Z");

function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function signWith(secret: string, header: unknown, payload: unknown): string {
  const unsigned = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(
    JSON.stringify(payload)
  ).toString("base64url")}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("privateRoomsConfigured", () => {
  it("is true only when SUPABASE_JWT_SECRET is set and non-blank", () => {
    expect(privateRoomsConfigured()).toBe(true);
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(privateRoomsConfigured()).toBe(false);
    vi.stubEnv("SUPABASE_JWT_SECRET", "   \n");
    expect(privateRoomsConfigured()).toBe(false);
  });
});

describe("mintRoomToken", () => {
  it("signs an HS256 JWT that Supabase can verify with the bare secret", () => {
    const { token } = mintRoomToken({ sub: "owner-1", roomOwner: true });
    const [h, p, s] = token.split(".");
    expect(decode(h)).toEqual({ alg: "HS256", typ: "JWT" });
    // Supabase signs and verifies with the secret string as-is.
    expect(createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")).toBe(s);
  });

  it("an owner token: role anon, our issuer, room_owner, no rooms, no aud, one hour", () => {
    const { token, expiresAt } = mintRoomToken({ sub: "owner-1", roomOwner: true });
    const iat = Math.floor(NOW.getTime() / 1000);
    const claims = decode(token.split(".")[1]);
    expect(claims).toEqual({
      iss: ROOM_TOKEN_ISSUER,
      role: "anon",
      sub: "owner-1",
      iat,
      exp: iat + 3600,
      room_owner: true,
    });
    expect(claims).not.toHaveProperty("aud");
    expect(claims).not.toHaveProperty("rooms");
    expect(ROOM_TOKEN_TTL_SECONDS).toBe(3600);
    expect(expiresAt).toBe((iat + 3600) * 1000);
  });

  it("a guest token: role anon, exactly the rooms given, no room_owner", () => {
    const rooms = ["tool:planning-poker:room:ABC", "tool:canvas:presence:board-1"];
    const { token } = mintRoomToken({ sub: "profile-1", rooms });
    const claims = decode(token.split(".")[1]);
    expect(claims.role).toBe("anon");
    expect(claims.sub).toBe("profile-1");
    expect(claims.rooms).toEqual(rooms);
    expect(claims).not.toHaveProperty("room_owner");
  });

  it("refuses to mint without a secret or a subject", () => {
    expect(() => mintRoomToken({ sub: "" })).toThrow();
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(() => mintRoomToken({ sub: "owner-1" })).toThrow();
  });
});

describe("verifyRoomToken", () => {
  it("round-trips a minted token", () => {
    const { token } = mintRoomToken({ sub: "profile-1", rooms: ["tool:retro:room:x"] });
    expect(verifyRoomToken(token)).toMatchObject({
      iss: ROOM_TOKEN_ISSUER,
      role: "anon",
      sub: "profile-1",
      rooms: ["tool:retro:room:x"],
    });
  });

  it("rejects a tampered signature", () => {
    const { token } = mintRoomToken({ sub: "owner-1", roomOwner: true });
    const [h, p, s] = token.split(".");
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(verifyRoomToken(`${h}.${p}.${flipped}`)).toBeNull();
    expect(verifyRoomToken(`${h}.${p}.`)).toBeNull();
    expect(verifyRoomToken(`${h}.${p}`)).toBeNull();
  });

  it("rejects a tampered payload (a guest widening its rooms)", () => {
    const { token } = mintRoomToken({ sub: "profile-1", rooms: ["tool:retro:room:x"] });
    const [h, p, s] = token.split(".");
    const widened = Buffer.from(
      JSON.stringify({ ...decode(p), room_owner: true, rooms: undefined })
    ).toString("base64url");
    expect(verifyRoomToken(`${h}.${widened}.${s}`)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const iat = Math.floor(NOW.getTime() / 1000);
    const forged = signWith(
      "some-other-secret",
      { alg: "HS256", typ: "JWT" },
      { iss: ROOM_TOKEN_ISSUER, role: "anon", sub: "x", iat, exp: iat + 60, room_owner: true }
    );
    expect(verifyRoomToken(forged)).toBeNull();
  });

  it.each(["none", "HS512", "RS256", undefined])("rejects alg %s", (alg) => {
    const iat = Math.floor(NOW.getTime() / 1000);
    const token = signWith(
      SECRET,
      { alg, typ: "JWT" },
      { iss: ROOM_TOKEN_ISSUER, role: "anon", sub: "x", iat, exp: iat + 60 }
    );
    expect(verifyRoomToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = mintRoomToken({ sub: "owner-1", roomOwner: true });
    vi.setSystemTime(NOW.getTime() + 3599_000);
    expect(verifyRoomToken(token)).not.toBeNull();
    vi.setSystemTime(NOW.getTime() + 3600_000);
    expect(verifyRoomToken(token)).toBeNull();
  });

  it("rejects a token from another issuer, even with our signature", () => {
    const iat = Math.floor(NOW.getTime() / 1000);
    const token = signWith(
      SECRET,
      { alg: "HS256", typ: "JWT" },
      { iss: "supabase", role: "anon", sub: "x", iat, exp: iat + 60, room_owner: true }
    );
    expect(verifyRoomToken(token)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyRoomToken("")).toBeNull();
    expect(verifyRoomToken("a.b.c")).toBeNull();
    expect(verifyRoomToken("not a jwt")).toBeNull();
  });

  it("verifies nothing when the server has no secret", () => {
    const { token } = mintRoomToken({ sub: "owner-1", roomOwner: true });
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(verifyRoomToken(token)).toBeNull();
  });
});

describe("migration 0026 (Realtime room authorization)", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/0026_realtime_room_authorization.sql"),
    "utf8"
  );
  // Comments mention the same words; assert on the statements only.
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .toLowerCase();

  it("grants the policy function to anon and authenticated (0025 revoked anon elsewhere)", () => {
    expect(statements).toMatch(
      /grant execute on function public\.realtime_room_allowed\(text\) to anon, authenticated/
    );
  });

  it("is a stable SQL function with a pinned search_path", () => {
    expect(statements).toContain(
      "create or replace function public.realtime_room_allowed(topic text)"
    );
    expect(statements).toMatch(/language sql stable set search_path = ''/);
  });

  it("puts select and insert policies on realtime.messages for anon and authenticated", () => {
    expect(statements).toMatch(
      /create policy "realtime_rooms_select" on realtime\.messages for select to anon, authenticated using \(public\.realtime_room_allowed\(\(select realtime\.topic\(\)\)\)\)/
    );
    expect(statements).toMatch(
      /create policy "realtime_rooms_insert" on realtime\.messages for insert to anon, authenticated with check \(public\.realtime_room_allowed\(\(select realtime\.topic\(\)\)\)\)/
    );
    expect(statements).toContain(
      'drop policy if exists "realtime_rooms_select" on realtime.messages'
    );
    expect(statements).toContain(
      'drop policy if exists "realtime_rooms_insert" on realtime.messages'
    );
  });

  it("honours room claims only from our issuer, and the guest rooms array null-safely", () => {
    expect(statements).toContain(`(auth.jwt() ->> 'iss') = '${ROOM_TOKEN_ISSUER}'`);
    expect(statements).toContain("(auth.jwt() ->> 'room_owner') = 'true'");
    expect(statements).toContain("jsonb_typeof(auth.jwt() -> 'rooms') = 'array'");
    expect(statements).toContain("jsonb_array_elements_text(auth.jwt() -> 'rooms')");
    expect(statements).toContain("topic like 'visitor:%'");
  });

  it("keeps the owner's own feeds to their Supabase session, not to room tokens", () => {
    expect(statements).toContain("(auth.jwt() ->> 'role') = 'authenticated'");
    expect(statements).toContain("'user-sync:' || (auth.jwt() ->> 'sub')");
    expect(statements).toContain("'history:' || (auth.jwt() ->> 'sub')");
    expect(statements).toContain("'agent-conversations-live'");
  });

  it("closes the one anon-reachable policy that trusted auth.uid() (0019 mcp_call_log)", () => {
    // A room token is role anon with a real `sub`; a policy open to anon that
    // compares auth.uid() would let a leaked owner token read owner rows.
    expect(statements).toContain(
      "alter policy mcp_call_log_select_own on public.mcp_call_log to authenticated"
    );
    expect(statements).toContain("revoke all on table public.mcp_call_log from anon");
  });
});
