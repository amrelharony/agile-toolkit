import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { GuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { hasGuestToolInvite } from "@/lib/squads/guest-tool-invite";
import { kudosRoomKey } from "./room-keys";

/**
 * Which Realtime topics may a squad guest join? Each one must map to an
 * invite the guest holds:
 *
 *   tool:planning-poker:room:<code>      invite (planning-poker, <code>)
 *   tool:canvas:room:<boardId>           invite (canvas, <boardId>)
 *   tool:canvas:presence:<boardId>       invite (canvas, <boardId>)
 *   tool:kudos:room:workspace-<key>      <key> is the guest's own workspace
 *                                        key, and any kudos invite
 *   tool:<tool>:room:<entityId>          invite (<tool>, <entityId>)
 *
 * Anything else is refused, `visitor:` topics included: those need no
 * token, and a guest token never grants them.
 */

/** Longest topic the guest token route accepts. */
export const MAX_GUEST_TOPIC_LENGTH = 300;

/** Same limits the invite routes put on entity ids (see /api/sessions). */
const MAX_ENTITY_ID_LENGTH = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const TOPIC_RE = /^tool:([a-z0-9_-]{1,64}):(room|presence):([\s\S]+)$/;
const KUDOS_ROOM_PREFIX = "workspace-";

export type GuestRoomTopic =
  | { kind: "invite"; toolId: string; entityId: string }
  | { kind: "kudos"; key: string };

/** Parse a topic into the invite it needs, or null when no invite can grant it. */
export function parseGuestRoomTopic(topic: string): GuestRoomTopic | null {
  if (typeof topic !== "string" || topic.length > MAX_GUEST_TOPIC_LENGTH) return null;
  const match = TOPIC_RE.exec(topic);
  if (!match) return null;
  const [, toolId, channel, entityId] = match;
  if (entityId.length > MAX_ENTITY_ID_LENGTH || CONTROL_CHARS.test(entityId)) return null;

  if (channel === "presence") {
    // Only the canvas has a separate presence channel.
    return toolId === "canvas" ? { kind: "invite", toolId, entityId } : null;
  }
  if (toolId === "kudos") {
    if (!entityId.startsWith(KUDOS_ROOM_PREFIX)) return null;
    const key = entityId.slice(KUDOS_ROOM_PREFIX.length);
    return key.length > 0 ? { kind: "kudos", key } : null;
  }
  return { kind: "invite", toolId, entityId };
}

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The first topic (in request order) the guest may not join, or null when
 * every topic is allowed. Invite lookups run in parallel, once per distinct
 * (tool, entity): a canvas room and its presence channel share one.
 */
export async function findRefusedGuestTopic(
  session: Pick<GuestSession, "profileId" | "squadId" | "squadOwnerId">,
  topics: readonly string[]
): Promise<string | null> {
  const lookups = new Map<string, Promise<boolean>>();
  const lookup = (key: string, run: () => Promise<boolean>): Promise<boolean> => {
    let pending = lookups.get(key);
    if (!pending) {
      pending = run();
      lookups.set(key, pending);
    }
    return pending;
  };

  const ownKudosKey = kudosRoomKey(session.squadOwnerId);
  const verdicts = topics.map((topic): Promise<boolean> => {
    const parsed = parseGuestRoomTopic(topic);
    if (!parsed) return Promise.resolve(false);
    if (parsed.kind === "kudos") {
      if (!ownKudosKey || !sameKey(parsed.key, ownKudosKey)) return Promise.resolve(false);
      return lookup("kudos", () =>
        hasGuestToolInvite({
          squadId: session.squadId,
          profileId: session.profileId,
          toolId: "kudos",
        })
      );
    }
    const { toolId, entityId } = parsed;
    return lookup(JSON.stringify([toolId, entityId]), async () => {
      const invite = await resolveGuestInvite({
        squadId: session.squadId,
        profileId: session.profileId,
        toolId,
        entityId,
      });
      return invite !== null;
    });
  });

  const allowed = await Promise.all(verdicts);
  const refused = allowed.findIndex((ok) => !ok);
  return refused === -1 ? null : topics[refused];
}
