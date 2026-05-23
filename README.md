# Agile Toolkit

A single-user, AI-controllable, cross-device toolkit of 100+ tools for agile
delivery — sprint planning, retros, story mapping, OKRs, metrics dashboards,
decision frameworks, whiteboarding, AI/ML PM workflows, and more.

Built with Next.js 14 (App Router), Zustand, Supabase, and Tailwind.

## Architecture

Five integrated subsystems, layered:

1. **Auth lock** — Single-email allowlist via Google OAuth. Edge middleware
   gates every page and API route on a Supabase session whose email is in
   `AUTHORIZED_EMAILS`. Fail-closed: missing env → every request bounces to
   `/not-authorized`. RLS on every user table is `auth.uid() = user_id`.
   See [src/middleware.ts](src/middleware.ts).

2. **Cross-device cloud sync** — Local-first. Every Zustand store and every
   workspace entity (sprints, stories, whiteboard objects, etc.) writes to
   localStorage first; a debounced pusher mirrors to Supabase. Realtime
   subscriptions fan remote writes back to other open tabs. LWW on
   `updated_at` for conflicts. Soft-deletes via `deleted=true` tombstones
   for concurrent-device reconciliation.
   See [src/lib/sync/engine.ts](src/lib/sync/engine.ts).

3. **Tool action registry** — A typed action surface where every tool
   exposes read/write/intent verbs through a singleton registry. The
   registry produces tool schemas for both Claude tool-use and MCP
   `tools/list`. ~102 actions wired today, growing.
   See [src/lib/actions/registry.ts](src/lib/actions/registry.ts).

4. **In-app chat agent** — A right-side sheet (Cmd/Ctrl+J) powered by GLM
   (Zhipu) via OpenAI-compatible chat completions. Server proxy at
   `/api/agent/stream` or browser-direct BYOK using the per-tool key in
   the LLM settings store. Write actions pause for inline approval;
   "approve all this session" opt-in available.
   See [src/app/api/agent/stream/route.ts](src/app/api/agent/stream/route.ts).

5. **MCP server** — HTTP/SSE transport at `/api/mcp` for remote agents
   (Claude Desktop, Claude Code, OpenClaw), plus a thin stdio relay
   package (`mcp-server/`) that forwards to the deployed app. PAT auth
   with scrypt-hashed bearer tokens. Per-token rate-limit bucket.
   See [src/app/api/mcp/route.ts](src/app/api/mcp/route.ts).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values listed below
npm run dev                  # http://localhost:3000
```

Required environment variables (`.env.local`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...             # server-only, for PAT resolution
AUTHORIZED_EMAILS=you@example.com            # comma-separated, lowercased
ANTHROPIC_API_KEY=sk-ant-...                 # optional; falls back to per-tool BYOK
```

The Supabase project needs migrations 0001–0006 applied:

```bash
npx supabase db push
```

## Scripts

| Command            | Purpose                           |
| ------------------ | --------------------------------- |
| `npm run dev`      | Next.js dev server with HMR.      |
| `npm run build`    | Production build.                 |
| `npm run start`    | Run the production build locally. |
| `npm run lint`     | ESLint over the project.          |
| `npm run test`     | Vitest in watch mode.             |
| `npm run test:run` | Vitest one-shot (CI uses this).   |

## Deployment

Vercel-native. Auto-deploys from `master` to production.

Environment variables for production (set in the Vercel dashboard):

- All four required `.env.local` vars above.
- The `SUPABASE_SERVICE_ROLE_KEY` is sensitive — store it as an Encrypted
  Environment Variable.
- Set the Vercel region to `fra1` to keep the Edge middleware close to
  the Supabase project (see `vercel.json`).

Vercel Authentication ("Require Log In" under Deployment Protection)
must be **off** for the public domain to reach the app; the
single-user lock is enforced by the in-app middleware, not Vercel's.

## MCP integration

Mint a Personal Access Token at `/settings/access-tokens`, then either:

**Claude Desktop (stdio relay):**

```json
{
  "mcpServers": {
    "agile-toolkit": {
      "command": "agile-toolkit-mcp",
      "env": {
        "AGILE_TOOLKIT_PAT": "pat_...",
        "AGILE_TOOLKIT_URL": "https://your-deployment.vercel.app"
      }
    }
  }
}
```

**Any HTTP/SSE MCP client:**

```bash
curl -X POST https://your-deployment.vercel.app/api/mcp \
  -H "Authorization: Bearer pat_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

Rate limit: 120 requests/minute per PAT.

## Security

- All routes gated by middleware on a valid Supabase session + email allowlist.
- All Supabase tables enforce `auth.uid() = user_id` via RLS.
- PATs stored as scrypt hashes; lookup via SECURITY DEFINER Postgres function.
- CSP locked to first-party + the LLM provider endpoints the app actually uses.
- HSTS, COOP, X-Frame-Options DENY, frame-ancestors 'none'.
- security.txt at `/.well-known/security.txt`.
- See [src/lib/auth/](src/lib/auth/) for the auth helpers and
  [src/middleware.ts](src/middleware.ts) for the gate.

## Built by

[Amr Elharony](https://amrelharony.com).
