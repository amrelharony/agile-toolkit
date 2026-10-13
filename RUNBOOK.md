# Agile Toolkit — operator runbook

Everything required to bring the toolkit online, in roughly the order you'll touch each system. Five steps, ~30 min start-to-finish if you've never used Supabase before; ~10 min if you have.

**Access model in one paragraph.** The site is public: every tool page works without signing in, and a visitor's data stays in their browser. Only the owner — a Google account listed in `AUTHORIZED_EMAILS`, with a verified email — gets cloud and history sync, the agent's server path, MCP, personal access tokens, the kudos/squads/sessions APIs and realtime multiplayer. The middleware lets pages through and answers every non-bypassed `/api/*` request without an owner session with JSON (`401 unauthenticated`, `403 not_authorized | wrong_provider | email_unverified`, `503 auth_unavailable | auth_unreachable`), never a redirect. The owner-only pages (`OWNER_ONLY_PAGES` in `src/lib/auth/owner-routes.ts`: `/settings/access-tokens`, `/settings/squads`) redirect to `/auth/sign-in` or `/not-authorized`. The browser asks `GET /api/auth/owner` before starting anything owner-only.

---

## 1. Create a Supabase project (5 min, one-time)

1. Open [supabase.com](https://supabase.com), sign in (free tier is plenty for single-user use).
2. **New project** → name it (e.g. `agile-toolkit`), pick a region, set a DB password (save it in your password manager — you'll only need it for direct psql access).
3. Wait ~2 min for provisioning.
4. **Project Settings → API** → copy three values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Project API keys → anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Project API keys → service_role** → `SUPABASE_SERVICE_ROLE_KEY` (server-only, used for PAT lookup)
5. **Authentication → Providers → Google** → enable.
   - You'll need a Google OAuth client (Cloud Console → OAuth 2.0 client IDs → Web application). Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback` (Supabase shows this string on the same page).
6. **Authentication → URL configuration** → add `http://localhost:3000` and (later) your production URL to **Site URL** + **Redirect URLs**.
7. Leave **Allow new users to sign up** on for now — your first owner sign-in (section 4) creates your account. Turn it off before the site goes public (see [Before going public](#before-going-public-owner-checklist)).

---

## 2. Create `.env.local` (1 min)

```bash
cp .env.example .env.local
```

Then fill in the values you just copied. Minimum required:

```bash
AUTHORIZED_EMAILS=a.elharony@gmail.com   # comma-separated; missing = deny all
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...    # KEEP SECRET — never expose to client
ZAI_API_KEY=<id>.<segment>                  # GLM/z.ai key from z.ai/manage-apikey
ZAI_AGENT_MODEL=glm-4.5-flash               # free tier; bump to glm-4.5 / glm-4.6 after topping up
```

The agent runs on GLM (z.ai, OpenAI-compatible) by default. If `ZAI_API_KEY`
is unset, the agent falls back to the client BYOK path — configure a GLM
provider in the in-app AI Settings dialog and the chat sidebar picks it up.

Restart `npm run dev` so the new env loads.

---

## 3. Apply migrations (3 min)

Three SQL files live in `supabase/migrations/`. Apply them **in order** against your Supabase project.

### Option A: Supabase CLI (recommended)

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>   # ref is in the project URL
supabase db push
```

### Option B: SQL editor (manual)

For each file in this order:

- `supabase/migrations/0002_auth_history.sql` _(if not already applied from an older deploy)_
- `supabase/migrations/0003_share_tokens.sql` _(same)_
- `supabase/migrations/0004_tighten_rooms_rls.sql`
- `supabase/migrations/0005_user_state.sql`
- `supabase/migrations/0006_agent_and_pat.sql`

Open **SQL Editor → New query** in the Supabase dashboard, paste each file's contents, run.

Migrations 0001 / 0002 / 0003 are idempotent (they use `if not exists`); 0004 onwards are also idempotent thanks to the recent fix that dropped the unguarded `TRUNCATE CASCADE`.

**Verify:**

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
-- Expect: access_tokens, agent_conversations, agent_messages, history_events,
-- profiles, room_state, rooms, share_tokens, user_entities, user_state
```

---

## 4. First sign-in + smoke walkthrough (5 min)

1. `npm run dev` (or restart if `.env.local` changed mid-session).
2. Open http://localhost:3000 → the home page loads as a visitor (no redirect). The header's account button is the visitor menu (person icon).
3. Visitor menu → **Owner sign in** → **Continue with Google** → sign in with the email in `AUTHORIZED_EMAILS`.
4. You should land back where you started, with your avatar in the header (the server confirmed you as the owner) — cloud sync is running.
5. Try a write through the chat agent (header → message-square icon, or Cmd/Ctrl+K twice):
   - Ask: _"Create a sprint called Sprint 47 starting today for 2 weeks at 30 points."_
   - Expect a "Confirm action" card for `workspace.sprint.create`. Click **Approve**.
   - Navigate to `/sprint-goal` → the sprint should appear.
6. Reload the page → sprint persists (came back from Supabase, not just localStorage).
7. Open the same URL in a second browser (Chrome + Firefox, or one normal + one private window) → sign in same account → the sprint appears within ~2 s.

8. Check the owner-only surface from a signed-out (private) window:
   ```bash
   curl -i http://localhost:3000/api/kudos                   # 401 JSON {"error":"unauthenticated",…}
   curl -i http://localhost:3000/settings/access-tokens      # 307 → /auth/sign-in?next=…
   curl -i http://localhost:3000/                            # 200
   ```

If any of those steps fails, check:

- Browser console for errors
- Network tab → look for 401/403 from `/api/agent/stream` or `/api/access-tokens`
- Supabase logs → **Logs → Postgres** for RLS denials

---

## 5. Connect Claude Desktop via MCP (5 min, optional)

1. In the toolkit: header avatar → **Access tokens** → name it (e.g. _Claude Desktop on Laptop_) → **Create**.
2. **Copy the raw token now** — it's shown once.
3. Build the relay (one-time):
   ```bash
   cd mcp-server && npm install && npm run build && npm link
   ```
   `npm link` makes the `agile-toolkit-mcp` binary available globally without publishing.
4. Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
   ```json
   {
     "mcpServers": {
       "agile-toolkit": {
         "command": "agile-toolkit-mcp",
         "env": {
           "AGILE_TOOLKIT_PAT": "pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
           "AGILE_TOOLKIT_URL": "http://localhost:3000"
         }
       }
     }
   }
   ```
   For production, swap `AGILE_TOOLKIT_URL` to your Vercel domain.
5. Restart Claude Desktop. The toolkit's actions appear as `workspace_sprint_create`, `tool_canvas_add_sticky`, `intent_start_retro_for_sprint`, etc.
6. Try in Claude Desktop: _"List my sprints from the agile toolkit"_ → it calls `workspace_sprint_list` and shows the result.

---

## Troubleshooting

| Symptom                                         | Likely cause                                              | Fix                                                                               |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/api/*` returns 503 `auth_unavailable`         | `AUTHORIZED_EMAILS` empty or Supabase env missing         | Check `.env.local`, restart dev server (tool pages keep working meanwhile)        |
| Sign-in lands on "Not the owner account"        | Google account not in `AUTHORIZED_EMAILS`                 | Sign in with the owner account; check the allowlist spelling                      |
| Sign-in lands on "Owner sign-in unavailable"    | `AUTHORIZED_EMAILS` empty on that deployment              | Set it (e.g. Vercel → Preview env); no session was created, nothing to undo       |
| Header says "Cloud sync is paused"              | Signed-out work in this browser awaits merge/discard      | Click **Review** in the notice, then **Merge** or **Discard**                     |
| `/auth/sign-in` works but bounces back unauth'd | Google redirect URI mismatch                              | Add `http://localhost:3000` to Supabase Auth → URL config                         |
| Agent sheet won't open / says "no GLM key"      | Neither `ZAI_API_KEY` set nor BYOK configured             | Set the server key, or click avatar → **AI settings (BYOK)** and paste a GLM key  |
| Agent returns "Insufficient balance"            | z.ai account has no credit AND you picked a paid model    | Top up at z.ai/manage-pricing OR set `ZAI_AGENT_MODEL=glm-4.5-flash` (free tier)  |
| MCP returns 401                                 | PAT typo, revoked, or `SUPABASE_SERVICE_ROLE_KEY` missing | Verify token in `/settings/access-tokens`; verify env on server                   |
| `tools/list` returns empty over MCP             | Action registry didn't load on the API route runtime      | Restart dev server; check `src/app/api/mcp/route.ts` still imports `register-all` |
| Two tabs show different workspace               | Sync not running (owner unverified, or prompt pending)    | Check console for `[sync:*]` errors; verify Supabase and `/api/auth/owner`        |

---

## Deploying to Vercel (optional)

1. `vercel link` → connect to your Vercel project.
2. Add the same env vars from `.env.local` in **Vercel Project Settings → Environment Variables**.
3. Update **Google OAuth client** authorized redirect URI to include your Vercel URL.
4. Update **Supabase Auth → URL config** with the Vercel URL.
5. `vercel --prod`.
6. Mint a fresh PAT on the production URL and swap your local Claude Desktop config to point at it.

Production checklist:

- [ ] Vercel env vars set (5 vars)
- [ ] Google OAuth redirect URI updated
- [ ] Supabase Auth URL config updated
- [ ] Migrations applied to prod Supabase project
- [ ] First sign-in succeeds
- [ ] Smoke walkthrough (step 4) repeats green
- [ ] [Before going public](#before-going-public-owner-checklist) done

---

## Before going public (owner checklist)

Every tool page is public, and so is the **Owner sign in** button. Anyone can start a Google sign-in, so do these **before** the deploy that makes the site public — not after:

1. **Supabase → Authentication → Sign In / Providers → Allow new users to sign up: off.** Your owner account must already exist (sign in once first). Strangers then get `signup_disabled` and land on "Not the owner account" instead of getting an `auth.users` + `profiles` row.
2. **Supabase → Authentication → Sign In / Providers → Allow anonymous sign-ins: off.** Turn off the Email provider too if you only use Google.
3. **Supabase → Authentication → Users:** delete every user that isn't the owner (stray sign-ins from while sign-ups were on).
4. **Vercel → Settings → Deployment Protection:** turn on protection for **Preview** deployments (Vercel Authentication). Every push builds a preview, previews use the production Supabase project, and without protection they are public. Keep it **off** for the production domain.
5. Verify on the production URL from a signed-out window: `/` → 200, `/api/kudos` → 401 JSON, `/settings/access-tokens` → redirect to sign-in, `/robots.txt` and `/sitemap.xml` → 200.

Known behaviour worth knowing:

- When your session expires you quietly become a visitor; the header shows "Signed out — changes stay on this device" with **Sign in to sync**. Owner pages and the API keep failing closed.
- Signing out clears the toolkit data in that browser (your cloud copy stays) unless you tick **Keep a copy on this browser**. If a visitor used the browser before you sign in, you're asked to **Merge** their work into your cloud workspace or **Discard** it; sync waits for the answer.
- Signing out while offline (or while Supabase is down) still removes the session from that browser; the next page warns that your other devices may still be signed in. If even that fails, the dialog says you're still signed in and nothing is cleared — try again.
- **Merge** for list-style tools (risk register, decision log, 1:1s, …) combines the browser's rows with the cloud's by id; a row deleted while signed out comes back from the cloud. The same applies to your own edits after a session lapse.

---

## Publishing the "Agile at Work" comic

The reader at `/agile-at-work` shows "Coming soon" until the PDF exists, and the home banner and sitemap entry stay hidden. Availability is decided at build time (`scripts/comic-asset.mjs` → `NEXT_PUBLIC_COMIC_PDF_SIZE` / `NEXT_PUBLIC_COMIC_PDF_VERSION`).

1. Export the PDF for the web:
   - **Linearized** ("Fast Web View" / "Optimize for fast web view"), so page 1 shows before the whole file downloads.
   - Images as **JPEG at 150–200 dpi**; fonts **embedded**.
   - **No JPEG2000 or JBIG2** images — the reader doesn't configure pdf.js's WASM decoders for them, so those images won't render.
   - Aim for **50 MB or less**.
2. Commit it as `public/comics/agile-at-work.pdf`. GitHub's web uploader caps files at **25 MB** and `git push` rejects files over **100 MB**, so push anything over 25 MB with git.
3. Restart `npm run dev` locally (the build-time check runs once per start). On Vercel the push that adds the file rebuilds.
4. Verify: `curl -I https://<domain>/comics/agile-at-work.pdf` → `200`, `content-type: application/pdf`, `accept-ranges: bytes`, `cache-control: public, max-age=86400, stale-while-revalidate=604800`. Then open `/agile-at-work`.
5. Replacing the file later needs no other change: the reader requests `?v=<content hash>`, so browsers never mix byte ranges of the old and new file.

After bumping `pdfjs-dist`, run `npm run pdf:worker` (copies the matching worker to `public/pdf.worker.legacy.min.mjs`) and commit the result.

---

## Deploy hardening (the ElharonyClaw mascot + agent gateway)

Three things must be handled **before the mascot/agent ships publicly**. The
code side of #1 is already wired (one env var drives the loader + CSP); #2 and
#3 run against infrastructure you control and need your SSH / dashboard login,
so they're documented here rather than automated.

### 1. Host the mascot GLB off a CDN

The model (`/public/mascot/mascot.glb`, ~2.7 MB after
[optimisation](#optimising-the-mascot-glb) — 16.3 MB straight out of Blender) is
**gitignored** — it is not in the repo and won't be on Vercel. Serve it from any
static host and point the app at it with one variable; the loader **and** the
Content-Security-Policy both follow it (`next.config.mjs` whitelists the URL's
origin in `connect-src` automatically — no manual CSP edit).

1. Upload `mascot.glb` to a CDN / object store (Cloudflare R2, S3+CloudFront,
   Vercel Blob, Supabase Storage public bucket, or even a GitHub Release asset).
   - Set `Content-Type: model/gltf-binary` and a long `Cache-Control`
     (`public, max-age=31536000, immutable`); add a `?v=N` query when you
     replace it.
   - The host must send permissive CORS (`Access-Control-Allow-Origin: *` or your
     app origin) since GLTFLoader `fetch()`es it cross-origin.
2. Set the env var (locally in `.env.local`, and in **Vercel → Settings →
   Environment Variables**):
   ```bash
   NEXT_PUBLIC_MASCOT_GLB_URL=https://cdn.example.com/mascot/mascot.glb
   ```
3. Redeploy. Verify in the browser: Network tab shows the `.glb` 200ing from the
   CDN, no CSP `connect-src`/`Refused to connect` console error, mascot renders
   textured (not white).

> Alternative — **Git LFS**: `git lfs track "*.glb"`, remove the `.gitignore`
> entry, commit, push to an LFS-enabled remote, then set
> `NEXT_PUBLIC_MASCOT_GLB_URL` to the LFS raw URL (or just serve `/mascot/…`
> from `public/` if the LFS file lands there at build). At the optimised 2.7 MB
> the file is also small enough to simply commit (drop the `.gitignore` line and
> leave `NEXT_PUBLIC_MASCOT_GLB_URL` unset) — a CDN still wins on cache headers
> and on keeping binaries out of git history, but it is no longer forced.

### Optimising the mascot GLB

Blender exports the baseColor map as a 4096×4096 PNG: 13.9 MB of the 16.3 MB
file, 89 MB of GPU memory, and 16.7 M pixels for the synchronous `retintSkin`
pass in `engine/retint-skin.ts` to walk on the main thread. The mascot renders at
~160×280 CSS px, so that resolution is unreachable on screen.

```bash
npm run optimize:mascot
```

Downscales every embedded texture to 1024 px and transcodes the colour maps to
JPEG q90 with **4:4:4** chroma (no subsampling — `retintSkin` thresholds on
per-pixel R/G/B differences, and 4:2:0 would smear exactly the signal its skin
detection keys off). Geometry, skin, morph targets and all 16 animations are
relocated byte-for-byte; only the image bufferViews change.

- Result: **16.33 MB → 2.66 MB**, GPU texture memory 89.5 MB → 5.6 MB, GLTFLoader
  parse ~1000 ms → ~150 ms, the retint pass ~590 ms → ~74 ms.
- `--size 2048` keeps more detail (~2.8 MB); `--dry-run` reports without writing;
  `--in`/`--out` work on a copy. Normal/occlusion/metallicRoughness maps and any
  texture on a non-opaque material are resized but deliberately kept as PNG.
- Needs one raster encoder — `sharp` (`npm i -D sharp`) or Python + Pillow
  (`pip install Pillow`), whichever is present.
- Re-upload to the CDN afterwards and bump the `?v=N` on
  `NEXT_PUBLIC_MASCOT_GLB_URL`, or year-long `immutable` caching will keep
  serving the old file to anyone who already visited.

### 2. Raise the OpenClaw gateway upload limit (nginx → 413 fix)

The agent advertises **~620 tools**; that request body exceeds nginx's default
`client_max_body_size` of **1 MB**, so the gateway (`chat.amrelharony.com`)
returns **413 Request Entity Too Large** and the agent silently fails to stream.

On the gateway host, in the `server { }` block that proxies to the chat
completions backend (e.g. `/etc/nginx/sites-available/chat.amrelharony.com` or
`/etc/nginx/conf.d/*.conf`):

```nginx
server {
    server_name chat.amrelharony.com;
    # … existing TLS + location blocks …

    client_max_body_size 10M;   # was the implicit 1M default → 413 on big tool lists
}
```

Then:

```bash
sudo nginx -t            # validate config
sudo systemctl reload nginx
```

Also check the layers **behind** nginx don't re-impose a limit:

- The OpenClaw app server (uvicorn/gunicorn `--limit-request-*`, Node body-parser
  `limit`, etc.) — raise to ≥10 MB if set.
- If Cloudflare fronts the domain, its body limit (100 MB on free) is fine.

Verify: from the toolkit, send one agent message and confirm `/api/agent/stream`
no longer 413s and the gateway streams a reply.

### 3. Rotate the leaked credentials (do this promptly)

During development two secrets were pasted into a chat transcript: the
**OpenClaw gateway key** (`OPENCLAW_API_KEY`) and a **Supabase secret**. They are
**not** in git (audited — the repo only ever read them from env), so no history
rewrite is needed; just regenerate them and update env.

**Supabase**

1. Dashboard → **Project Settings → API**.
   - Newer projects: **API Keys** → roll the **secret / `service_role`** key.
   - Legacy projects: **JWT Settings → Rotate secret** — ⚠️ this regenerates
     **both** `anon` and `service_role` and **signs out every session**; you must
     then update `NEXT_PUBLIC_SUPABASE_ANON_KEY` too.
2. Update `SUPABASE_SERVICE_ROLE_KEY` (and the anon key if it changed) in
   `.env.local` **and** Vercel env vars, then redeploy.
3. Re-mint any MCP PATs only if you rotated the JWT secret (sessions/tokens
   signed by the old secret stop validating).

**OpenClaw gateway**

1. Regenerate the gateway bearer key wherever you issue it (the gateway's own key
   management / its env on `chat.amrelharony.com`).
2. Update `OPENCLAW_API_KEY` in `.env.local` and Vercel; redeploy.
3. Invalidate the old key on the gateway so the exposed value is dead.

Hardening checklist:

- [ ] `NEXT_PUBLIC_MASCOT_GLB_URL` set to the CDN URL (local + Vercel); mascot loads textured in prod
- [ ] Gateway `client_max_body_size 10M`; `nginx -t` clean + reloaded; agent no longer 413s
- [ ] Supabase `service_role` (and `anon` if JWT rotated) regenerated + env updated everywhere
- [ ] OpenClaw `OPENCLAW_API_KEY` regenerated, old key invalidated, env updated
- [ ] Old leaked values confirmed dead (a request with each returns 401)
