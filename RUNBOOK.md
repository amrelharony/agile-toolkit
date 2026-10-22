# Agile Toolkit — operator runbook

Everything required to bring the toolkit online, in roughly the order you'll touch each system. Five steps, ~30 min start-to-finish if you've never used Supabase before; ~10 min if you have.

**Access model in one paragraph.** The site is public: every tool page works without signing in, and a visitor's data stays in their browser. Only the owner — a Google account listed in `AUTHORIZED_EMAILS`, with a verified email — gets cloud and history sync, the agent's server path, MCP, personal access tokens, the kudos/squads/sessions APIs and realtime multiplayer (the one exception is the opt-in [visitor live rooms](#visitor-live-rooms), off unless `NEXT_PUBLIC_VISITOR_ROOMS=1`). The middleware lets pages through and answers every non-bypassed `/api/*` request without an owner session with JSON (`401 unauthenticated`, `403 not_authorized | wrong_provider | email_unverified`, `503 auth_unavailable | auth_unreachable`), never a redirect. The owner-only pages (`OWNER_ONLY_PAGES` in `src/lib/auth/owner-routes.ts`: `/settings/access-tokens`, `/settings/squads`) redirect to `/auth/sign-in` or `/not-authorized`. The browser asks `GET /api/auth/owner` before starting anything owner-only.

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

## Realtime rooms: what protects them

Live rooms (owner Planning Poker, canvas boards, the kudos wall, squad-guest pages, visitor rooms) are Supabase Realtime channels. Every channel is joined with the public anon key, which ships in the page, so **knowing a channel's name is enough to join it**. The checks in the app (owner or invited guest) run in the browser, not on Supabase.

What keeps strangers out today is that the names can't be guessed:

| Room                  | Channel                                                        | Name                                                                                                              |
| --------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Owner and guest Poker | `tool:planning-poker:room:<code>`                              | 16 characters, about 79 bits (was 6, about 30)                                                                    |
| Canvas                | `tool:canvas:room:<boardId>`, `tool:canvas:presence:<boardId>` | 122 bits for boards made in the app, 126 for boards made by agents (was 48)                                       |
| Kudos wall            | `tool:kudos:room:workspace-<key>`                              | a key the server derives from your user id with a server-only secret (was the user id itself, which isn't secret) |
| Visitor rooms         | `visitor:<tool>:<code>`                                        | 12 characters, about 59 bits, and 3 hours at most                                                                 |

Presence and kudos carry a display name or "Owner", never your email address.

What this does **not** cover:

- A leaked link (for example a guest URL forwarded on) still lets someone join with the anon key directly.
- Revoking an invite stops the guest's page, not a channel they already know the name of.
- Rooms created before this change keep their old, short codes until a new session starts.

The fix for those is Realtime Authorization: private channels that only accept short-lived room tokens the server mints for you or an invited guest, with "Allow public access" turned off. It needs the project's JWT secret on the server and a database policy, so it ships behind a flag with its own enable steps.

---

## Visitor live rooms

Visitors (no sign-in, no squad invite) can run **Planning Poker** or a **Retro** live with their team. A room is a temporary Supabase Realtime broadcast + presence channel, `visitor:<tool>:<12-character code>`, joined through `/join/<tool>/<code>`. Nothing is written to a database, no server secret is involved, and the channel uses the same public anon key as owner rooms. Before any channel opens, the visitor gives a name and ticks a consent box under this text: _"What you type passes through our realtime provider (Supabase) to everyone with the link. We don't store it; the room disappears when everyone leaves. Share the link only with your team."_ Owners don't get visitor rooms (strangers' cards would sync into the owner's workspace); they keep using squad invites.

The feature is **off** unless the build has `NEXT_PUBLIC_VISITOR_ROOMS=1`.

### Turning it on or off

1. **Vercel → Settings → Environment Variables:** set `NEXT_PUBLIC_VISITOR_ROOMS` to `1` for Production (to turn it off, delete it or set it to anything else). Add it to Preview only if you want to try it there.
2. **Redeploy** (Deployments → ⋯ → Redeploy, or push a commit). `NEXT_PUBLIC_*` values are inlined at build time, so changing the variable without a redeploy does nothing. Locally, edit `.env.local` and restart `npm run dev`.
3. Verify from a signed-out window: the "Start a live room" / "Go live" buttons appear (or disappear), and `/join/planning-poker/ABCDEFGHJKMN` shows the name and consent step (or "Live rooms are off").

What turning it **off** does: hides the entry points, makes `/join/…` say live rooms are off, and makes the client gate refuse to open any `visitor:` channel. What it does **not** do: close tabs that already have a room open (they keep going until everyone leaves or the 3-hour limit), or stop anyone who calls Supabase directly with the public anon key. For that, use the emergency brake below.

### Limits built into every room

- **20 people** per room, host included. A joiner who finds 20 already there gets "This room is full (20 people)" and leaves.
- **3-hour hard limit:** the host ends the room for everyone 3 hours after starting it, and every other tab also leaves 3 hours after it joined, whatever happens. A forgotten tab can't run up usage forever.
- **30 minutes idle:** the host is asked whether to keep the room open. With no answer, it ends 2 minutes later.
- **Message limits:**
  - Inbound broadcasts are rate-limited per sender (a burst of 20, then 4 a second) and per event across the room (100, then 25 a second).
  - Anything over 100,000 characters is dropped. A host whose own state is bigger doesn't send it and sees a toast instead. A Retro board over 200 cards counts as too big.
  - Names and card text with control or bidi characters are rejected, and nothing a peer sends is rendered as HTML.
- **Traffic:** the host sends its state when it changes (Retro: at most every 0.5 s), when someone joins, and every 30 s otherwise. There is no 5-second heartbeat. That is roughly 2.4k message deliveries per hour for an idle 20-person room.

### How the two rooms behave

- **Planning Poker:**
  - The host starts a room with **Start a live room** on the "Running it with your team" card.
  - Nothing from the room is logged to History, written back to the Story Map or synced. The host's browser keeps only a host-only copy of the session.
- **Retro:**
  - The host starts a room with **Go live** in the board header.
  - Rooms are host-authoritative: participants send "add card" and "vote" requests, and only the host changes the board.
  - The host's board is its normal local Retro board, so participants' cards stay in the host's browser after the room ends.
  - Participants keep the board in memory only. **Save a copy** puts it in their Past retros, and **Download Markdown** saves a file.
- **Both:**
  - **End room** ends it for everyone. The host keeps the board or session.
  - **Remove** takes a participant out and ignores what they send. It is soft: they can rejoin under a new name. To keep someone out, end the room and share a new link.
  - If the host closes the tab without ending the room, the others elect a new host after about 10 seconds and carry on from the last state they received.

### Watching the quota (Supabase free tier)

Visitor rooms share the project's Realtime quota with owner rooms, squad-guest rooms and the live sync feeds (`user_state`, history, agent conversations). The free plan allows about **200 concurrent connections** and **2 million messages a month**; check current figures at supabase.com/pricing.

- **Supabase → Project → Reports (or Usage) → Realtime:** check peak concurrent connections and messages weekly while the feature is new, and after anything that might drive traffic (a post, a talk).
- Supabase sends usage notices to the organization's billing email; make sure it reaches you. On a paid plan, keep the **spend cap** on.
- If usage climbs with no matching activity of yours, assume someone is abusing the anon key: turn the flag off and redeploy, and use the brake if it doesn't stop.

### Emergency brake

**Supabase → Realtime → Settings → Allow public access: off.** Supabase then refuses joins on public channels: no new visitor room can connect, nobody can rejoin one, and scripts using the anon key are shut out too. A tab that is already connected may keep its room until it reconnects or reaches the 3-hour limit.

It also stops **everything else that uses Realtime**, because all of the app's channels are public: owner Poker/canvas/kudos rooms, squad-guest rooms, and the live push of sync, history and agent-conversation updates between your devices. Saving still works (it goes through the API, not Realtime); other devices just stop getting changes pushed until you turn it back on. Turn it back on once the flag is off and redeployed.

### Residual risks (accepted for v1)

- **Anyone with the link is a full member.** They see everything in the room, can claim to be the host to other participants (the host's own copy is never overwritten), and can take seats up to the 20-person cap. Removing someone is soft: they can rejoin under a new id. The firm fix is to end the room and share a new link.
- **The host election can be rigged:** members state their own join time, so a member can make sure they take over if the host leaves.
- **Anyone with the public anon key can burn Realtime quota**, with or without this feature. Rate limits only protect the people in a room, not the quota.
- **Room codes are visible** in browser history, Vercel request logs (`/join/<tool>/<code>`), and wherever the link is pasted. A code is useless once its room has ended.
- Turning the flag off needs a redeploy and doesn't close open tabs; they end by themselves within 3 hours.
- **An owner who opens a `/join` link joins as a visitor** (that page has no sign-in). Nothing from the room is written to their workspace unless they choose Save a copy.

If abuse shows up, the planned next step is short-lived room tokens minted by a server route with Realtime Authorization on private channels (that needs "Allow public access" off and the owner rooms moved to private channels first).

---

## Shared sprints (the one-time data move)

Burndown, Burnup, Velocity, Sprint Comparison and Sprint Metrics share one list of sprints: the workspace `sprints`, plus `sprintSeries`, one row per sprint holding its daily log and ratings. These tools used to keep their own data in four browser keys. The first time the app loads after this change, it moves that data into the shared sprints, in each browser that has it, and shows one toast ("Moved N sprints from … into shared sprints").

- **When it runs:**
  - for a visitor, straight away;
  - for the owner, only after the first cloud pull finishes;
  - never while the "merge or discard this browser's data?" question is open, or while discarding.
- **How it merges:** it only fills gaps. Values already in the workspace win, and running it again changes nothing.
- **Matching:**
  - Burndown and Burnup data joins the sprint with the same start date, or creates one.
  - Velocity rows keep their ids.
  - Sprint Comparison rows match by name.
- **Ids:** sprints the move creates have ids starting `sprint_legacy_`, and `migratedFrom` on their series lists the source. Sprint Metrics flags them under "Worth checking".
- **Backups:** the old data stays in that browser, under `agile-toolkit:burndown:migrated` (and `burnup`, `velocity`, `sprint-compare`). If a backup already exists, the name gets a `:<timestamp>` suffix.
- **To re-run it** (for example after restoring an old backup), copy a backup back to its original key and reload.
- **If the browser can't store the backup** (storage full), it keeps the old key and tries again on the next load.

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

Three things must be handled **before the mascot/agent ships publicly**. #1 is
done in the repo; #2 and #3 run against infrastructure you control and need
your SSH / dashboard login, so they're documented here rather than automated.

### 1. The mascot GLB is committed (no CDN needed)

The optimised model ([~2.7 MB](#optimising-the-mascot-glb), 16.3 MB straight out
of Blender) is committed as `public/mascot/mascot.<sha256-prefix>.glb` and loaded
from `MASCOT_GLB_URL` in `src/components/agent/mascot/mascot-asset.ts`.
`next.config.mjs` serves `/mascot/*` with
`Cache-Control: public, max-age=31536000, immutable`, which is safe because a
changed model gets a new file name. The raw Blender export stays gitignored.

- **Remove `NEXT_PUBLIC_MASCOT_GLB_URL` from Vercel** (Settings → Environment
  Variables). The loader no longer reads it; the old Supabase-hosted copy was
  the 16 MB export served with `no-cache`.
- To replace the model: run `npm run optimize:mascot` on the new export, rename
  the output to `mascot.<first 8 hex chars of its sha256>.glb`, update
  `MASCOT_GLB_URL`, delete the old file. `test/agent/mascot-asset.test.ts`
  fails if the name doesn't match the bytes or the file is over 3.5 MB.
- The mascot loads after the page is idle (a small launcher shows until then),
  is skipped for visitors with Save-Data on, and falls back to the launcher if
  the GPU drops the WebGL context more than twice.

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
- Then commit it under its new content-hash name (see #1). Never overwrite the
  existing hashed file: browsers that already cached it will keep it for a year.

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

- [ ] `NEXT_PUBLIC_MASCOT_GLB_URL` removed from Vercel; mascot loads textured in prod from `/mascot/mascot.<hash>.glb`
- [ ] Gateway `client_max_body_size 10M`; `nginx -t` clean + reloaded; agent no longer 413s
- [ ] Supabase `service_role` (and `anon` if JWT rotated) regenerated + env updated everywhere
- [ ] OpenClaw `OPENCLAW_API_KEY` regenerated, old key invalidated, env updated
- [ ] Old leaked values confirmed dead (a request with each returns 401)
