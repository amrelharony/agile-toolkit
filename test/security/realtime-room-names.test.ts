// @vitest-environment node
/**
 * Realtime channels are public: anyone with the project's anon key who can
 * name a channel can join it. So every room name must be unguessable:
 * owner Poker codes, canvas board ids made by agents, and the kudos room key
 * (which used to be the owner's user id, a value that isn't secret).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonError } from "@/lib/auth/json-error";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ outcome: null as unknown }));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => {
    if (h.outcome) throw h.outcome;
    return { user: { id: "owner-1" }, supabase: {} };
  },
}));

import { kudosRoomKey } from "@/lib/realtime/room-keys";
import { GET } from "@/app/api/realtime/kudos-room/route";
import {
  OWNER_ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  generateRoomCode,
} from "@/app/(tools)/planning-poker/room-code";
import { isVisitorRoomCode } from "@/lib/realtime/visitor-rooms";
import { isValidSession } from "@/app/(tools)/planning-poker/types";

beforeEach(() => {
  h.outcome = null;
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("owner Planning Poker room codes", () => {
  it("are 16 characters of the unambiguous alphabet, about 79 bits", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRoomCode()));
    expect(codes.size).toBe(200);
    for (const code of Array.from(codes)) {
      expect(code).toHaveLength(OWNER_ROOM_CODE_LENGTH);
      expect(code.split("").every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    }
    expect(OWNER_ROOM_CODE_LENGTH * Math.log2(ROOM_CODE_ALPHABET.length)).toBeGreaterThan(78);
  });

  it("never look like a visitor code, and still pass the session validator", () => {
    const code = generateRoomCode();
    expect(isVisitorRoomCode(code)).toBe(false);
    expect(
      isValidSession({
        roomCode: code,
        sessionName: "Sprint 12",
        scale: ["1", "2", "3"],
        scaleType: "fibonacci",
        host: "Owner",
        hostId: "owner-1",
        participants: [{ id: "owner-1", name: "Owner", vote: null }],
        stories: [],
        currentStoryIdx: 0,
        revealed: false,
      })
    ).toBe(true);
  });
});

describe("kudos room key", () => {
  it("is a stable 32-character key per workspace that reveals nothing of the owner id", () => {
    const a = kudosRoomKey("owner-1");
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(kudosRoomKey("owner-1")).toBe(a);
    expect(kudosRoomKey("owner-2")).not.toBe(a);
    expect(a).not.toContain("owner");
  });

  it("depends on the server secret, and is unavailable without it", () => {
    const a = kudosRoomKey("owner-1");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "another-secret");
    expect(kudosRoomKey("owner-1")).not.toBe(a);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(kudosRoomKey("owner-1")).toBeNull();
  });

  it("is handed to the verified owner only, uncached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ roomKey: kudosRoomKey("owner-1") });

    h.outcome = jsonError(403, "not_authorized", "Not the owner.");
    const refused = await GET();
    expect(refused.status).toBe(403);
  });

  it("answers 503 when the server can't derive keys", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("room_keys_unavailable");
  });
});
