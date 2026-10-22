// @vitest-environment node
/**
 * POST /api/guest/realtime-token — a squad guest's room token for private
 * Realtime channels.
 *
 * The token's `rooms` claim is the whole of what the database policy lets the
 * guest join, so this route must only ever list topics the guest holds an
 * invite for. The guest cookie and the invite lookups are mocked; the kudos
 * room key is derived for real (lib/realtime/room-keys), and the token is
 * checked by verifying it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SESSION = {
  profileId: "11111111-1111-4111-8111-111111111111",
  squadId: "22222222-2222-4222-8222-222222222222",
  squadOwnerId: "33333333-3333-4333-8333-333333333333",
  displayName: "Guest",
  color: "#ff0000",
};

const h = vi.hoisted(() => ({
  session: null as null | Record<string, string>,
  /** `${toolId}|${entityId}` pairs the guest holds an invite for. */
  invites: new Set<string>(),
  kudosInvite: false,
  /** Rate-limit keys (or key prefixes) to refuse. */
  limited: [] as string[],
}));

const resolveGuestInvite = vi.hoisted(() =>
  vi.fn(async (opts: { squadId: string; profileId: string; toolId: string; entityId: string }) =>
    h.invites.has(`${opts.toolId}|${opts.entityId}`)
      ? { ownerId: "owner", role: "editor", toolId: opts.toolId, entityId: opts.entityId }
      : null
  )
);
const hasGuestToolInvite = vi.hoisted(() =>
  vi.fn<(opts: { squadId: string; profileId: string; toolId: string }) => Promise<boolean>>(
    async () => h.kudosInvite
  )
);
const consumeGuestRateToken = vi.hoisted(() =>
  vi.fn((key: string) => !h.limited.some((prefix) => key.startsWith(prefix)))
);
const getGuestSession = vi.hoisted(() => vi.fn(async () => h.session));

vi.mock("@/lib/auth/guest-session", () => ({ getGuestSession }));
vi.mock("@/lib/squads/invites", () => ({ resolveGuestInvite }));
vi.mock("@/lib/squads/guest-tool-invite", () => ({ hasGuestToolInvite }));
vi.mock("@/app/api/guest/_rate-limit", () => ({ consumeGuestRateToken }));

import { POST, dynamic } from "@/app/api/guest/realtime-token/route";
import { verifyRoomToken } from "@/lib/realtime/room-token";
import { kudosRoomKey } from "@/lib/realtime/room-keys";
import { parseGuestRoomTopic } from "@/lib/realtime/guest-room-access";

function req(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/guest/realtime-token", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

async function post(body: unknown, raw = false) {
  const res = await POST(req(body, raw) as never);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

function ownKudosTopic(): string {
  return `tool:kudos:room:workspace-${kudosRoomKey(SESSION.squadOwnerId)}`;
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_JWT_SECRET", "test-legacy-jwt-secret");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-secret");
  h.session = { ...SESSION };
  h.invites = new Set();
  h.kudosInvite = false;
  h.limited = [];
  resolveGuestInvite.mockClear();
  hasGuestToolInvite.mockClear();
  consumeGuestRateToken.mockClear();
  getGuestSession.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/guest/realtime-token: who may ask", () => {
  it("is never prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers 401 without a guest session, before reading any invite", async () => {
    h.session = null;
    const { res, body } = await post({ topics: ["tool:planning-poker:room:ABC"] });
    expect(res.status).toBe(401);
    expect(body.error).toBe("unauthenticated");
    expect(resolveGuestInvite).not.toHaveBeenCalled();
  });

  it("answers 503 private_rooms_unavailable when the server has no JWT secret", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    h.invites.add("planning-poker|ABC");
    const { res, body } = await post({ topics: ["tool:planning-poker:room:ABC"] });
    expect(res.status).toBe(503);
    expect(body.error).toBe("private_rooms_unavailable");
    expect(body).not.toHaveProperty("token");
    expect(getGuestSession).not.toHaveBeenCalled();
  });

  it("rate-limits per IP, before the cookie lookup", async () => {
    h.limited = ["realtime-token:ip:"];
    const { res, body } = await post({ topics: ["tool:planning-poker:room:ABC"] });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(body.error).toBe("rate_limited");
    expect(consumeGuestRateToken).toHaveBeenCalledWith("realtime-token:ip:203.0.113.7");
    expect(getGuestSession).not.toHaveBeenCalled();
  });

  it("rate-limits per profile, in this route's own bucket", async () => {
    h.limited = ["realtime-token:profile:"];
    const { res } = await post({ topics: ["tool:planning-poker:room:ABC"] });
    expect(res.status).toBe(429);
    expect(consumeGuestRateToken).toHaveBeenCalledWith(
      `realtime-token:profile:${SESSION.profileId}`
    );
    expect(resolveGuestInvite).not.toHaveBeenCalled();
  });
});

describe("POST /api/guest/realtime-token: topics map to invites", () => {
  it("a Poker room needs the (planning-poker, code) invite, and the token lists exactly it", async () => {
    h.invites.add("planning-poker|ABCDEFGHJKMNPQRS");
    const topic = "tool:planning-poker:room:ABCDEFGHJKMNPQRS";
    const { res, body } = await post({ topics: [topic] });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(resolveGuestInvite).toHaveBeenCalledWith({
      squadId: SESSION.squadId,
      profileId: SESSION.profileId,
      toolId: "planning-poker",
      entityId: "ABCDEFGHJKMNPQRS",
    });
    expect(body.topics).toEqual([topic]);

    const claims = verifyRoomToken(body.token as string);
    expect(claims).toMatchObject({ role: "anon", sub: SESSION.profileId, rooms: [topic] });
    expect(claims).not.toHaveProperty("room_owner");
    expect(body.expiresAt).toBe(claims!.exp * 1000);
  });

  it("a canvas room and its presence channel both need the (canvas, boardId) invite, looked up once", async () => {
    h.invites.add("canvas|board-42");
    const topics = ["tool:canvas:room:board-42", "tool:canvas:presence:board-42"];
    const { res, body } = await post({ topics });
    expect(res.status).toBe(200);
    expect(resolveGuestInvite).toHaveBeenCalledTimes(1);
    expect(resolveGuestInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "canvas", entityId: "board-42" })
    );
    expect(verifyRoomToken(body.token as string)?.rooms).toEqual(topics);
  });

  it("the kudos room needs the guest's own workspace key and any kudos invite", async () => {
    h.kudosInvite = true;
    const topic = ownKudosTopic();
    const { res, body } = await post({ topics: [topic] });
    expect(res.status).toBe(200);
    expect(hasGuestToolInvite).toHaveBeenCalledWith({
      squadId: SESSION.squadId,
      profileId: SESSION.profileId,
      toolId: "kudos",
    });
    expect(resolveGuestInvite).not.toHaveBeenCalled();
    expect(verifyRoomToken(body.token as string)?.rooms).toEqual([topic]);
  });

  it("refuses another workspace's kudos room, without even looking up invites", async () => {
    h.kudosInvite = true;
    const foreign = `tool:kudos:room:workspace-${kudosRoomKey("44444444-4444-4444-8444-444444444444")}`;
    const { res, body } = await post({ topics: [foreign] });
    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: "topic_not_allowed", topic: foreign });
    expect(hasGuestToolInvite).not.toHaveBeenCalled();
  });

  it("refuses the right kudos room to a guest with no kudos invite", async () => {
    h.kudosInvite = false;
    const { res, body } = await post({ topics: [ownKudosTopic()] });
    expect(res.status).toBe(403);
    expect(body.topic).toBe(ownKudosTopic());
  });

  it("refuses the kudos room when the server can't derive room keys", async () => {
    h.kudosInvite = true;
    const topic = ownKudosTopic();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { res } = await post({ topics: [topic] });
    expect(res.status).toBe(403);
  });

  it("any other tool room needs the (tool, entityId) invite", async () => {
    h.invites.add("retro|R7X2");
    const { res } = await post({ topics: ["tool:retro:room:R7X2"] });
    expect(res.status).toBe(200);
    expect(resolveGuestInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "retro", entityId: "R7X2" })
    );
  });

  it("refuses a topic without an invite, naming the first refused topic, and mints nothing", async () => {
    h.invites.add("planning-poker|OK");
    const topics = [
      "tool:planning-poker:room:OK",
      "tool:planning-poker:room:NOPE",
      "tool:retro:room:ALSO-NOPE",
    ];
    const { res, body } = await post({ topics });
    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      error: "topic_not_allowed",
      topic: "tool:planning-poker:room:NOPE",
    });
    expect(body).not.toHaveProperty("token");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("an invite for one tool doesn't open another tool's room with the same id", async () => {
    h.invites.add("canvas|X1");
    const { res } = await post({ topics: ["tool:planning-poker:room:X1"] });
    expect(res.status).toBe(403);
  });

  it.each([
    ["a visitor room", "visitor:planning-poker:ABCD1234"],
    ["the owner's sync feed", `user-sync:${SESSION.squadOwnerId}`],
    ["the owner's history feed", `history:${SESSION.squadOwnerId}`],
    ["the agent conversation feed", "agent-conversations-live"],
    ["a prefixed topic", "realtime:tool:canvas:room:board-42"],
    ["an empty entity", "tool:canvas:room:"],
    ["an upper-case tool", "tool:Canvas:room:board-42"],
    ["presence on a tool without it", "tool:retro:presence:R7X2"],
    ["an unknown channel kind", "tool:canvas:state:board-42"],
    ["a kudos room that isn't a workspace room", "tool:kudos:room:board-42"],
    ["a kudos workspace room without a key", "tool:kudos:room:workspace-"],
    ["kudos presence", `tool:kudos:presence:workspace-${"k".repeat(32)}`],
    ["a control character", "tool:canvas:room:board\u000042"],
    ["an entity over 200 characters", `tool:canvas:room:${"b".repeat(201)}`],
  ])("refuses %s with 403 and no invite lookup", async (_label, topic) => {
    h.invites.add("canvas|board-42");
    h.kudosInvite = true;
    const { res, body } = await post({ topics: [topic] });
    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: "topic_not_allowed", topic });
    expect(resolveGuestInvite).not.toHaveBeenCalled();
    expect(hasGuestToolInvite).not.toHaveBeenCalled();
  });

  it("deduplicates repeated topics", async () => {
    h.invites.add("canvas|board-42");
    const { res, body } = await post({
      topics: ["tool:canvas:room:board-42", "tool:canvas:room:board-42"],
    });
    expect(res.status).toBe(200);
    expect(body.topics).toEqual(["tool:canvas:room:board-42"]);
    expect(verifyRoomToken(body.token as string)?.rooms).toEqual(["tool:canvas:room:board-42"]);
  });

  it("accepts eight topics", async () => {
    const topics = Array.from({ length: 8 }, (_, i) => `tool:retro:room:R${i}`);
    topics.forEach((_, i) => h.invites.add(`retro|R${i}`));
    const { res } = await post({ topics });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/guest/realtime-token: bad bodies", () => {
  it("answers 400 invalid_json for a body that isn't JSON", async () => {
    const { res, body } = await post("{not json", true);
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  it.each([
    ["no topics", {}],
    ["null", null],
    ["topics not an array", { topics: "tool:retro:room:R1" }],
    ["an empty array", { topics: [] }],
    ["a non-string topic", { topics: [42] }],
    ["an empty topic", { topics: [""] }],
    ["nine topics", { topics: Array.from({ length: 9 }, (_, i) => `tool:retro:room:R${i}`) }],
    ["a topic over 300 characters", { topics: [`tool:retro:room:${"r".repeat(290)}`] }],
  ])("answers 400 invalid_input for %s", async (_label, payload) => {
    const { res, body } = await post(payload);
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_input");
    expect(resolveGuestInvite).not.toHaveBeenCalled();
  });

  it("answers 413 for an oversized body", async () => {
    const { res, body } = await post({ topics: ["x".repeat(20_000)] });
    expect(res.status).toBe(413);
    expect(body.error).toBe("body_too_large");
  });
});

describe("parseGuestRoomTopic", () => {
  it("maps each room shape to the invite it needs", () => {
    expect(parseGuestRoomTopic("tool:planning-poker:room:ABC")).toEqual({
      kind: "invite",
      toolId: "planning-poker",
      entityId: "ABC",
    });
    expect(parseGuestRoomTopic("tool:canvas:presence:b1")).toEqual({
      kind: "invite",
      toolId: "canvas",
      entityId: "b1",
    });
    expect(parseGuestRoomTopic("tool:kudos:room:workspace-KEY")).toEqual({
      kind: "kudos",
      key: "KEY",
    });
    // An entity id may itself contain colons; it is everything after `room:`.
    expect(parseGuestRoomTopic("tool:retro:room:a:b")).toEqual({
      kind: "invite",
      toolId: "retro",
      entityId: "a:b",
    });
    expect(parseGuestRoomTopic("visitor:retro:ABC")).toBeNull();
  });
});
