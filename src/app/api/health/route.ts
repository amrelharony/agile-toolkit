/**
 * Uptime probe.
 *
 *   GET /api/health   — 200 { status, timestamp, commit, env, region }
 *
 * The middleware bypass list has always exempted this path (it must answer
 * without a Supabase session, since a monitor never carries one) but the route
 * itself was never implemented, so probes got the 404 page and read the site as
 * down while it was serving fine.
 *
 * Deliberately a LIVENESS check, not a readiness one: it proves this deployment
 * boots and serves, and touches nothing else. Reaching into Supabase here would
 * make every probe a write-path dependency and turn a paused free-tier database
 * — which the keepalive cron already handles — into a false "site down" page.
 *
 * `commit` is the deployed SHA, which answers the question a probe failure
 * always raises next: is the build I just shipped actually live?
 */

/**
 * Never prerender or cache this. Without it Next statically renders the handler
 * at build time and every probe gets a frozen timestamp from whenever the
 * deployment was built — the one thing a liveness check must not do.
 */
export const dynamic = "force-dynamic";

/** Vercel system env vars; all absent in local dev, hence the null fallbacks. */
function deployment() {
  return {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
  };
}

export async function GET() {
  return Response.json(
    { status: "ok", timestamp: new Date().toISOString(), ...deployment() },
    {
      status: 200,
      headers: {
        // Vercel's edge caches 200s from route handlers by default; a cached
        // health check reports the state of whenever it was cached.
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
