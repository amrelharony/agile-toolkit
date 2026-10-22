# Agile Toolkit

A free, public toolkit of 110 interactive tools for agile delivery — sprint
planning, retros, story mapping, OKRs, metrics dashboards, decision frameworks,
whiteboarding, AI/ML PM workflows, and more.

Every tool works without an account: a visitor's work stays in their browser.
The owner's sign-in adds cross-device cloud sync, the in-app agent and MCP.

Built with Next.js 14 (App Router), Zustand, Supabase, and Tailwind.

## Architecture

Five integrated subsystems, layered:

1. **Access model** — Public, browser-only tools; owner-only server.
   - **Visitors** (no sign-in) use every tool. Their data stays in the
     browser's localStorage and never reaches the toolkit's server or
     database (in-tool AI prompts go straight to the provider of the key the
     visitor brings).
   - **The owner** is a Supabase session whose user is in
     `AUTHORIZED_EMAILS`, signed in with Google, with a verified email
     (`isOwnerUser` in [src/lib/auth/authorize.ts](src/lib/auth/authorize.ts)).
     Owner-only: cloud and history sync, the agent's server path, MCP,
     personal access tokens, the kudos/squads/sessions APIs and realtime
     multiplayer.
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
   `/api/agent/stream` or browser-direct BYOK using the per-tool key in
   the LLM settings store. Write actions pause for inline approval;
   "approve all this session" opt-in available.
   See [src/app/api/agent/stream/route.ts](src/app/api/agent/stream/route.ts).

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
SUPABASE_SERVICE_ROLE_KEY=eyJ...             # server-only: PATs, squads, the private comic
AUTHORIZED_EMAILS=you@example.com            # comma-separated, lowercased
ANTHROPIC_API_KEY=sk-ant-...                 # optional; falls back to per-tool BYOK
```

The Supabase project needs migrations 0001–0006 applied:

```bash
npx supabase db push
```

## Scripts

| Command                  | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `npm run dev`            | Next.js dev server with HMR.                                       |
| `npm run build`          | Production build.                                                  |
| `npm run start`          | Run the production build locally.                                  |
| `npm run lint`           | ESLint over the project.                                           |
| `npm run test`           | Vitest in watch mode.                                              |
| `npm run test:run`       | Vitest one-shot (CI uses this).                                    |
| `npm run pdf:worker`     | Copy the pdf.js worker to `public/` (after bumping `pdfjs-dist`).  |
| `npm run comic:new-link` | Mint a new private comic link and print its hash (writes nothing). |

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
Preview deployments (see the checklist below).

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

## "Agile at Work" comic (private)

The colour edition of the comic is **not public**. Nothing on the site lists
or links to it, it is not in the sitemap, and its page is `noindex`. The only
way in is the private link the owner prints as a QR code in the book:

```
https://agile.amrelharony.com/comic/<token>
```

- **Never write the token down** in the repo, issues, PRs, chats or logs. Only
  its SHA-256 is committed (`COMIC_LINK_TOKEN_SHA256` in
  [src/lib/comic/token.ts](src/lib/comic/token.ts)). The middleware checks the
  token and rewrites the right link to the reader page (`src/app/read/[token]`);
  any other `/comic/...` URL is the same 404 as any unknown URL, and so is the
  reader page's own `/read/...` URL. Nothing every visitor downloads names the
  comic: the shared header, mascot and toasts learn about it only from the
  mounted reader.
- **Read online only.** The PDF sits in a **private** Supabase Storage
  bucket; the page hands the browser a signed URL that expires after 12 hours
  (a reload mints a new one). There is no download button.
- Needs `SUPABASE_SERVICE_ROLE_KEY` on the server (already set for MCP and
  squads). Without it the page says the comic can't be loaded right now.

**Uploading the PDF** (Supabase dashboard → **Storage**):

1. **New bucket** → name `comics`, **Public bucket: off** — and keep it off.
   A public bucket serves the PDF to anyone at
   `https://<project-ref>.supabase.co/storage/v1/object/public/comics/agile-at-work.pdf`,
   so the page refuses to show the comic while it is on. That URL must not
   return `200`.
2. Upload the file to the bucket root as **`agile-at-work.pdf`**. Until it's
   there, the link shows "coming soon". To replace it later, delete the old
   file and upload the new one under the same name — no deploy needed. Never
   commit the PDF (e.g. to the old `public/comics/`): anything under
   `public/` is served to everyone, so `.gitignore` excludes it and a test
   fails CI if one gets in.
3. The free plan caps uploads at **50 MB per file**. Export for the web:
   **linearized ("Fast Web View")**, **JPEG** images at 150–200 dpi, fonts
   embedded. Avoid JPEG2000 and JBIG2 images — the reader doesn't configure
   pdf.js's WASM decoders for them, so they won't render.

**Rotating the link:** `npm run comic:new-link` prints a new link and the
SHA-256 of its token. Paste the hash into `COMIC_LINK_TOKEN_SHA256`, commit
and deploy. The old link — and every QR code already printed with it — stops
working.

After bumping `pdfjs-dist`, run `npm run pdf:worker` so the public worker
matches the library version (the reader and the Canvas PDF import share it).

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
