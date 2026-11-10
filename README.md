# Agile Toolkit

A free, public toolkit for Scrum masters and agile teams — sprint planning,
daily scrum, retrospectives, estimation, delivery metrics, team health,
prioritization and decision frameworks, whiteboarding — plus the free
"Agile at Work" comic book. About 80 tools are in the main navigation; some
30 more for neighbouring work (AI/LLM product management, security, SRE and
incident response, strategy frameworks) sit on a "More tools" shelf
(`/more-tools`) that any visitor can switch on.

Every tool works without an account: a visitor's work is saved only in their
browser. The owner's sign-in adds cross-device cloud sync, the in-app agent
and MCP. Two opt-in features for visitors, both off by default, do send what
a visitor types elsewhere: live rooms and Amr's AI (see the access model
below).

Built with Next.js 14 (App Router), Zustand, Supabase, and Tailwind.

## Architecture

Five integrated subsystems, layered:

1. **Access model** — Public, browser-only tools; owner-only server.
   - **Visitors** (no sign-in) use every tool. Their data is saved only in the
     browser's localStorage and does not reach the toolkit's server or
     database (in-tool AI prompts go straight to the provider of the key the
     visitor brings). The comics and kudos pages do send anonymous counts for
     every visitor: see "The 'Agile at Work' comics" in
     [RUNBOOK.md](RUNBOOK.md#the-agile-at-work-comics). There are two opt-in
     exceptions, both off by default:
     - **Visitor live rooms** (off unless `NEXT_PUBLIC_VISITOR_ROOMS=1`):
       after a consent step, what people type in a room passes through
       Supabase Realtime to everyone with the link. Nothing is written to a
       database. See "Visitor live rooms" in
       [RUNBOOK.md](RUNBOOK.md#visitor-live-rooms).
     - **Amr's AI for visitors** (off unless `VISITOR_AI_ENABLED=1` and
       `NEXT_PUBLIC_VISITOR_AI=1`): after a consent card, the visitor's
       messages, the tool they are on and what Amr reads from their tools go
       through `/api/agent/visitor` and Amr's own AI server to the AI
       provider. The site keeps only a daily message count. See "Visitor AI"
       in [RUNBOOK.md](RUNBOOK.md#visitor-ai).
   - **The owner** is a Supabase session whose user is in
     `AUTHORIZED_EMAILS`, signed in with Google, with a verified email
     (`isOwnerUser` in [src/lib/auth/authorize.ts](src/lib/auth/authorize.ts)).
     Owner-only: cloud and history sync, the agent's server path
     (`/api/agent/stream`), MCP, personal access tokens, the
     kudos/squads/sessions APIs and realtime multiplayer. The two opt-in
     features above are the exceptions for visitors.
   - Edge middleware lets every page through (pages fail **open**) and
     guards the owner surface (fails **closed**): every non-bypassed
     `/api/*` route answers JSON `401 unauthenticated`,
     `403 not_authorized | wrong_provider | email_unverified` or
     `503 auth_unavailable | auth_unreachable` (with `retry-after`) — never a
     redirect. The pages in `OWNER_ONLY_PAGES`
     ([src/lib/auth/owner-routes.ts](src/lib/auth/owner-routes.ts):
     `/settings/access-tokens`, `/settings/squads`) redirect to sign-in or
     `/not-authorized`. A non-owner's session cookies are expired, so they
     carry on as a visitor.
   - The browser never trusts a session on its own: `GET /api/auth/owner`
     (`200 {owner:true}`, else 401/403/503 JSON) confirms the owner before
     anything owner-only starts. RLS on every user table is
     `auth.uid() = user_id`.
   - Shared browsers: owner sign-out clears the toolkit's local data unless
     "Keep a copy on this browser" is ticked; visitors can clear it from the
     visitor menu; and when the owner signs in where a visitor left work, a
     "merge or discard?" prompt runs before any sync uploads it.
   - See [src/middleware.ts](src/middleware.ts).

2. **Cross-device cloud sync** (owner) — Local-first. Every Zustand store and every
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

4. **In-app chat agent** (owner) — A right-side sheet (Cmd/Ctrl+J) powered by GLM
   (Zhipu) via OpenAI-compatible chat completions. Server proxy at
   `/api/agent/stream` (owner-only) or browser-direct BYOK using the per-tool
   key in the LLM settings store. Write actions pause for inline approval;
   "approve all this session" opt-in available.
   See [src/app/api/agent/stream/route.ts](src/app/api/agent/stream/route.ts).
   Visitors never use that path. With the visitor AI flags on, they get the
   metered `/api/agent/visitor` instead
   ([src/app/api/agent/visitor/route.ts](src/app/api/agent/visitor/route.ts)):
   see "Visitor AI" in [RUNBOOK.md](RUNBOOK.md#visitor-ai).

5. **MCP server** (owner) — HTTP/SSE transport at `/api/mcp` for remote agents
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

| Command              | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `npm run dev`        | Next.js dev server with HMR.                                      |
| `npm run build`      | Production build.                                                 |
| `npm run start`      | Run the production build locally.                                 |
| `npm run lint`       | ESLint over the project.                                          |
| `npm run test`       | Vitest in watch mode.                                             |
| `npm run test:run`   | Vitest one-shot (CI uses this).                                   |
| `npm run pdf:worker` | Copy the pdf.js worker to `public/` (after bumping `pdfjs-dist`). |

## Deployment

Vercel-native. Auto-deploys from `master` to production.

Environment variables for production (set in the Vercel dashboard):

- All four required `.env.local` vars above.
- The `SUPABASE_SERVICE_ROLE_KEY` is sensitive — store it as an Encrypted
  Environment Variable.
- Set the Vercel region to `fra1` to keep the Edge middleware close to
  the Supabase project (see `vercel.json`).

Vercel Authentication ("Require Log In" under Deployment Protection)
must be **off** for the production domain — the site is public and the
owner-only surface is enforced by the in-app middleware. Keep it **on** for
Preview deployments (see the checklist below). Only `master` and `preview/*`
branches deploy at all (`git.deploymentEnabled` in `vercel.json`); see
[RUNBOOK.md, "Vercel builds and cost"](RUNBOOK.md#vercel-builds-and-cost).

### Owner checklist — before deploying

The public "Owner sign in" button lets anyone start a Google sign-in, so:

- **Supabase → Authentication → Sign In / Providers:** once the owner has
  signed in at least once (that creates the account), turn off **Allow new
  users to sign up** — strangers then get `signup_disabled` instead of an
  account. Confirm **anonymous sign-ins** are off.
- **Supabase → Authentication → Users:** delete any non-owner users created
  while sign-ups were on.
- **Vercel → Settings → Deployment Protection:** protect **Preview**
  deployments. Previews share the production Supabase project and would
  otherwise be public.

## "Agile at Work" comics

The comics live at `/comics`, and every story is `/comics?ep=NN`. See
[RUNBOOK.md, "The Agile at Work comics"](RUNBOOK.md#the-agile-at-work-comics).

After bumping `pdfjs-dist`, run `npm run pdf:worker` so the public worker the
whiteboard's PDF import loads matches the library version.

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

- Pages are public; every non-bypassed `/api/*` route and the
  `OWNER_ONLY_PAGES` require the owner (allowlisted Google account with a
  verified email). API failures are JSON 401/403/503, never redirects.
- MCP bearer tokens are re-checked against the owner, so a PAT row inserted
  by another account resolves to nothing.
- All Supabase tables enforce `auth.uid() = user_id` via RLS.
- PATs stored as scrypt hashes; lookup via SECURITY DEFINER Postgres function.
- CSP locked to first-party + the LLM provider endpoints the app actually uses.
- HSTS, COOP, X-Frame-Options DENY, frame-ancestors 'none'.
- security.txt at `/.well-known/security.txt`; `/robots.txt` keeps `/api/`,
  `/auth/`, `/settings/`, `/guest/` and `/not-authorized` out of the index.
- See [src/lib/auth/](src/lib/auth/) for the auth helpers and
  [src/middleware.ts](src/middleware.ts) for the gate.

## Built by

[Amr Elharony](https://amrelharony.com).
