/**
 * What the public comics routes need before touching their body: a same-site
 * check and a per-instance rate limit. They live in lib/server/public-guard.ts,
 * shared with Amr's AI for visitors; re-exported here so the comics routes
 * keep importing from "../_guard".
 */

export { clientIp, isSameOrigin, withinRateLimit } from "@/lib/server/public-guard";
