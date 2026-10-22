import "server-only";
import { createHmac } from "node:crypto";

/**
 * Unguessable Realtime room keys, derived on the server.
 *
 * Realtime channels are public: anyone holding the project's anon key and a
 * channel name can join it. A name built from an id that isn't secret (the
 * owner's user id travels in presence and session state) is therefore an
 * open door. These keys are an HMAC of that id under a server-only secret,
 * so only someone the server hands the key to (the owner, or a guest with a
 * valid invite) can name the channel.
 *
 * The secret is the service-role key, which already exists on the server and
 * never reaches a browser; the label versions the derivation, so changing it
 * moves everyone to a new channel at once.
 */
export function kudosRoomKey(ownerId: string): string | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !ownerId) return null;
  return createHmac("sha256", secret)
    .update(`agile-toolkit:kudos-room:v1:${ownerId}`)
    .digest("base64url")
    .slice(0, 32);
}
