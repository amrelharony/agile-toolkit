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

| Symptom                                         | Likely cause                                                | Fix                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/*` returns 503 `auth_unavailable`         | `AUTHORIZED_EMAILS` empty or Supabase env missing           | Check `.env.local`, restart dev server (tool pages keep working meanwhile)                        |
| Sign-in lands on "Not the owner account"        | Google account not in `AUTHORIZED_EMAILS`                   | Sign in with the owner account; check the allowlist spelling                                      |
| Sign-in lands on "Owner sign-in unavailable"    | `AUTHORIZED_EMAILS` empty on that deployment                | Set it (e.g. Vercel → Preview env); no session was created, nothing to undo                       |
| Header says "Cloud sync is paused"              | Signed-out work in this browser awaits merge/discard        | Click **Review** in the notice, then **Merge** or **Discard**                                     |
| `/auth/sign-in` works but bounces back unauth'd | Google redirect URI mismatch                                | Add `http://localhost:3000` to Supabase Auth → URL config                                         |
| Agent sheet won't open / says "no GLM key"      | Neither `ZAI_API_KEY` set nor BYOK configured               | Set the server key, or click avatar → **AI settings (BYOK)** and paste a GLM key                  |
| Agent returns "Insufficient balance"            | z.ai account has no credit AND you picked a paid model      | Top up at z.ai/manage-pricing OR set `ZAI_AGENT_MODEL=glm-4.5-flash` (free tier)                  |
| MCP returns 401                                 | PAT typo, revoked, or `SUPABASE_SERVICE_ROLE_KEY` missing   | Verify token in `/settings/access-tokens`; verify env on server                                   |
| `tools/list` returns empty over MCP             | Action registry didn't load on the API route runtime        | Restart dev server; check `src/app/api/mcp/route.ts` still imports `register-all`                 |
| Two tabs show different workspace               | Sync not running (owner unverified, or prompt pending)      | Check console for `[sync:*]` errors; verify Supabase and `/api/auth/owner`                        |
| `test/pdf/worker-version` fails only on Windows | Checkout made before `.gitattributes` (CRLF working copies) | Re-checkout once: `git rm -q --cached -r . && git reset --hard` (commit or stash your work first) |

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

The fix for those is private rooms, below.

### Private rooms (Realtime Authorization)

With `NEXT_PUBLIC_PRIVATE_ROOMS=1`, every room opens as a **private** channel, and Supabase checks each join against the policy in migration 0026 (its visitor branch narrowed by 0027, and given the Prioritize tools' vote rounds by 0028).

**Who gets in:**

- **Owner:** your browser fetches a short-lived room token from `/api/realtime/token` (owner only) that opens every tool room.
- **Invited guest:** a guest's browser fetches one from `/api/guest/realtime-token` that lists exactly the rooms their invites cover.
- **Visitor rooms** still open with the plain anon key. The code in the link is their only key, by design. Since migration 0027 the policy admits only the app's own shape, `visitor:<visitor tool>:<12-character code>`; 0026 admitted any topic starting with `visitor:`. Migration 0028 added Kano, Buy-a-Feature and the $100 Test to the visitor tools.
- **Your sync, history and agent-conversation feeds** use private channels on your own signed-in session.

**Tokens:**

- Tokens last 60 minutes and refresh themselves.
- They have role `anon`, so a leaked one is worth no more than the public key against the database.
- They are signed with `SUPABASE_JWT_SECRET`. That is the project's legacy JWT secret, as powerful as the service-role key, so keep it server-only.

A public channel and a private channel with the same name are separate on Supabase. Tested live on 19 Oct 2026: someone on the public channel neither heard the private room nor reached it. So **the flag alone protects what's said in a room.** Turning off "Allow public access" then does two more things:

- old tabs (still running the build from before the flag) can't keep using public channels;
- nobody can use the public key to run **public** channels of their own on the project's quota.

It does **not** shut the anon key out of private channels the policy admits for it: visitor rooms. With the flag on, visitor rooms are private channels that the policy's visitor branch lets the plain anon key join, so they keep working with public access off, and so does anyone who uses the anon key to open a private channel of that shape. Migrations 0027 and 0028 narrow that branch from any `visitor:%` topic to the app's own tools and 12-character codes; to stop visitor rooms entirely, use the SQL step under "Emergency brake".

**Turning it on (in this order):**

1. **Secret:** put the legacy JWT secret in `SUPABASE_JWT_SECRET` in Vercel (Production) and `.env.local`. It's under Project Settings → JWT Keys → Legacy JWT Secret.
2. **Migration:** run `supabase db push`, which applies 0026, 0027 and 0028. This is safe at any time, because public channels ignore the policy. After pushing, check:
   - `select has_function_privilege('anon','public.realtime_room_allowed(text)','EXECUTE');` returns true;
   - two policies, `realtime_rooms_select` and `realtime_rooms_insert`, are on `realtime.messages`;
   - `select public.realtime_room_allowed('visitor:retro:ABCDEFGHJKMN'), public.realtime_room_allowed('visitor:anything');` returns `true, false` (0027 applied);
   - `select public.realtime_room_allowed('visitor:kano-model:ABCDEFGHJKMN'), public.realtime_room_allowed('visitor:hundred-dollar-test:ABCDEFGHJKMN');` returns `true, true` (0028 applied).
3. **Flag:** set `NEXT_PUBLIC_PRIVATE_ROOMS=1` in Vercel and **redeploy**. It's inlined at build time.
4. **Check production:**
   - an owner Poker session and the kudos wall stay live (open them signed in);
   - an invited guest joins;
   - a visitor room works;
   - your other devices still get sync updates.

   Ask anyone with the site open to reload: tabs still running the old build use public channels.

5. **Lock it:** Supabase → Realtime → Settings → turn **off** "Allow public access". From then on public channels are refused entirely: an old tab can't keep using a public one, and nobody can run their own public channels on the anon key. The anon key still opens private visitor-room channels (`visitor:<visitor tool>:<code>`, per 0028): that is how visitor rooms and vote rounds work.

**Rolling back:** turn "Allow public access" back **on** first, then unset the flag and redeploy.

**Worth knowing:**

- **If the secret is missing or wrong,** the token routes answer 503, or Supabase rejects the token. Owner and guest rooms then stay local-only (they show "Local-only"); they never fall back to a public channel. Visitor rooms and sync keep working.
- **Revoking an invite** cuts a guest off when their current token expires, within 60 minutes. Their next refresh is refused.
- **Rotating the legacy JWT secret** also replaces the legacy anon and service-role keys. Update all three in Vercel and `.env.local`, then redeploy.
- **New channel code** must go through `useRoom`, `useCanvasPresence` or `acquireRoomAuth` for rooms, or `ownerFeedChannel` for your own feeds. A public channel stops working once public access is off.

---

## Visitor live rooms

Visitors (no sign-in, no squad invite) can run **Planning Poker** or a **Retro** live with their team, and anyone can run an anonymous **vote round** (Health Check, Psych Safety, Mood Tracker, Kano, Buy-a-Feature and the $100 Test, see "Live vote rounds" below). A room is a temporary Supabase Realtime broadcast + presence channel, `visitor:<tool>:<12-character code>`, joined through `/join/<tool>/<code>`. Nothing is written to a database, no server secret is involved, and the channel uses the same public anon key as owner rooms. Before any channel opens, the visitor gives a name and ticks a consent box under this text: _"What you type passes through our realtime provider (Supabase) to everyone with the link. We don't store it; the room disappears when everyone leaves. Share the link only with your team."_ (vote rounds have their own text, below). Owners don't get Poker or Retro visitor rooms (strangers' cards would sync into the owner's workspace); they keep using squad invites. **Vote rounds are the one exception:** the owner hosts them on a visitor channel too, because participants can send only encrypted numbers (scale answers, answer pairs or amounts) and nothing reaches the workspace except the totals, when the host presses Save round.

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

### How the rooms behave

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
- **Vote rounds** work differently (no host election, nothing shown before Reveal): see the next section.

### Live vote rounds (Health Check, Psych Safety, Mood; Kano; Buy-a-Feature and the $100 Test)

**What it is:** the facilitator presses **Run a live round**, gives a name, and shares the link with **Copy link** (it ends in `#k=…`). People open it on their phones, give a name and answer: with taps on a scale (scale rounds), two taps per feature (Kano), or by typing an amount per item (Buy-a-Feature, the $100 Test). The facilitator sees only how many people have answered. **Reveal results** needs 3 answers (5 for Psych Safety) and closes the round. It shows the totals per question (a question with fewer answers than that stays hidden, "withheld"), the answer-pair grid per feature (likewise per feature), or each item's total and average; in an allocation round who gave each item something, and the bands, show only if 5 had answered, so the host is told to wait for 5 before revealing if they want them. **Save round** stores the totals in the tool; **New round** starts again with a fresh key.

**Three kinds of round** run on the same room, the same keys and the same messages. A tool's kind is fixed (`VOTE_ROUND_KIND` in `src/lib/realtime/vote-room/protocol.ts`):

- **Scale** (Health Check, Psych Safety, Mood Tracker): one answer per question on one scale, kept as the count per answer. These rounds' messages are exactly as before (v1).
- **Pair** (Kano): for each feature, two questions on Kano's five answers ("If it has this, how do you feel?" and "If it doesn't have this?": I like it / I expect it / I'm neutral / I can live with it / I dislike it). Each person's two answers about a feature travel as one number, so the host keeps only the 5 × 5 count of answer pairs per feature: never the answers alone, never one person's answers across features. A feature's grid shows from 3 answers.
- **Allocation** (Buy-a-Feature, the $100 Test): each person splits a budget across 2 to 20 items, in whole amounts. The split travels as fixed-width digits (every ballot in a round is the same size), and the host keeps, per item, the total and how many people gave an amount in each of five bands of the budget (0, up to 10%, up to 25%, up to 50%, more than 50%), and nothing else: no sum of squares, no lowest or highest amount. Reveal shows each item's total and average from 3 answers; who gave an item anything, and the bands, only from 5. The $100 Test splits $100 and must give it all out; Buy-a-Feature splits each player's budget, caps each feature at what's left of its price, and refunds anything over it.

Pair and allocation rounds send their state as a new version (v2, with its kind). A tab still running an older build can't join them: its tool list doesn't have these tools, so it opens nothing.

**Who can host:** the owner or a visitor. Squad guests can't host (they get count entry instead). Participants need no account.

**What travels:**

- The host's questions, signed with a key made in the host's browser for this room. The link's `#k=` part is that key's fingerprint, and participants trust only messages signed by it, so nobody else in the room can pose as the host to collect answers.
- Each person's answers: numbers only (one per question, one per feature for the answer pair, or one amount per item), encrypted in their browser so only the host's browser can read them. That browser adds them to the counts (per-question counts, per-feature pair counts, or per-item totals and bands) and drops them. Before Reveal nobody, the host included, sees a distribution, per-question or per-feature counts, or an item's total.
- A participant's browser re-sends the same encrypted answers until the host's browser confirms them (for about two minutes; then it says they weren't confirmed and lets the person answer again). The host never counts one person twice, so a resend is harmless.
- The `#k=` part never reaches the server or the Vercel logs (browsers don't send the fragment), but it is in browser history like the rest of the link.
- Consent text for vote rounds: _"Answers are encrypted in each person's browser, so only the host's browser can read them, and it keeps the totals only. They pass through our realtime provider (Supabase). Others in the room see your name and whether you've answered, not what. After the host reveals the results, everyone in the room sees the totals, for questions with enough answers; if everyone gives the same answer, the totals show it. Share the link only with your team."_

**Flags:** `NEXT_PUBLIC_VISITOR_ROOMS=1` is required. It works with `NEXT_PUBLIC_PRIVATE_ROOMS` on or off. It needs HTTPS (or localhost) for the browser's encryption.

**Limits:** the visitor-room limits above, plus at most 60 answers (ballots) per round, 20,000 characters per message, 32 questions, 11 scale points, and numbers only from participants. Kano: at most 32 features and 5 answers per question. Allocation rounds: 2 to 20 items, a budget of 10 to 9,999 whole units, caps up to 1,000,000, a unit of at most 4 characters, and items × digits of the budget at most 80 (so every ballot fits the same 128-character envelope).

**Before deploying these tools:** push migrations 0027 and 0028 together (one `supabase db push`, see "Private rooms"). Production runs 0026 until then, whose visitor branch admits these rooms along with any other `visitor:` topic. Never leave 0027 applied without 0028: with `NEXT_PUBLIC_PRIVATE_ROOMS=1` the private channels of Kano, Buy-a-Feature and the $100 Test are then refused, so their live rounds can't connect (their count entry keeps working).

**Traffic:** each answer reaches every member, so about members × members deliveries per round (400 for a full room), plus the host's state at most every 0.5 s while answers arrive, after joins, and every 30 s.

**If the host closes or reloads the tab:** the round is lost (the counts exist only in that tab). Participants who were already in the room see "The host left" after about 10 seconds; anyone who opens the link afterwards sees "Nobody is hosting this round" after about 90 seconds. The host starts a new room and shares the new link. Revealed results survive **End room**: they stay on the host's screen until saved or closed (Close asks first when they aren't saved).

**Troubleshooting:**

- _"This link is incomplete"_: the link was copied without its `#k=` part (for example from the address bar of a page that dropped it). Use **Copy link**.
- _"This browser can't take part"_: no HTTPS, an old browser, or the realtime service is unreachable.
- _"Nobody is hosting this round"_: no host has sent anything for 90 seconds, so the link is probably from a room that ended (or the host's tab was closed or reloaded). Ask the host for a new link.
- _"The host's browser didn't confirm your answers"_: the participant's answers went unconfirmed through every resend (the host's tab was asleep or offline, or the person was removed). They can answer again; nothing is counted twice.
- More answers than names in the room: the host sees a warning. Someone may have answered again from another tab; start a new round if the totals look wrong.
- _"Someone else sent answers under your name"_ (participant) or "An answer came under a name that had already answered" (host): someone is answering under another member's id (residual risk 4 below). End the room and share a new link.

**Turning it off:** unset the flag and redeploy, as above. **Enter counts instead** (count hands or collect paper answers, then type the totals) keeps working, with the same 3-or-5 rule. For Kano it is a 5 × 5 grid per feature (one tick per paper answer pair). For Buy-a-Feature and the $100 Test it is either **Paper splits** (type each paper split; it is added to the totals and cleared, so the spread shows from 5 as live) or **Totals only** (each item's total and the number of people; the spread is then unknown).

### Watching the quota (Supabase free tier)

Visitor rooms share the project's Realtime quota with owner rooms, squad-guest rooms and the live sync feeds (`user_state`, history, agent conversations). The free plan allows about **200 concurrent connections** and **2 million messages a month**; check current figures at supabase.com/pricing.

- **Supabase → Project → Reports (or Usage) → Realtime:** check peak concurrent connections and messages weekly while the feature is new, and after anything that might drive traffic (a post, a talk).
- Supabase sends usage notices to the organization's billing email; make sure it reaches you. On a paid plan, keep the **spend cap** on.
- If usage climbs with no matching activity of yours, assume someone is abusing the anon key: turn the flag off and redeploy, and use the brake if it doesn't stop.

### Emergency brake

The anon key is public, and there are two ways a script can use it on the Realtime quota, **whatever `NEXT_PUBLIC_PRIVATE_ROOMS` says** (that flag only decides which channels the app's own build opens):

- **Private `visitor:` channels.** The policy from 0026/0027/0028 is a database setting: once it is pushed, its visitor branch lets the plain anon key join any private channel of the visitor shape, even while the app's build uses public channels. Only 0026 is in production so far, so production's visitor branch is still 0026's `topic like 'visitor:%'` (any topic starting with `visitor:`). 0027 and 0028 are pushed together before the deploy that ships the Team and Prioritize tools' live rounds; from then on the branch admits only `visitor:<visitor tool>:<12-character code>`.
- **Public channels of any name**, `visitor:` ones included, for as long as "Allow public access" is on.

A full brake against anon-key abuse therefore takes **both** steps:

1. **No private visitor channels (SQL).** In the Supabase SQL editor, re-create `public.realtime_room_allowed` exactly as in migration 0028 but **without the visitor line** (the `topic ~ '^visitor:…'` line and the `or` that follows it; keep `set search_path = ''`, every other branch and the `grant execute … to anon, authenticated, service_role`). From then on nobody can join a private `visitor:` channel. Owner rooms, guest rooms and your sync feeds (private channels with tokens or your session) keep working.
2. **No public channels.** **Supabase → Realtime → Settings → Allow public access: off.** Supabase then refuses every join on a public channel.

A tab that is already connected may keep its room until it reconnects or reaches the 3-hour limit.

**What each step also stops:**

- **With `NEXT_PUBLIC_PRIVATE_ROOMS=1` (production today):** the app's visitor rooms and vote rounds are private channels, so step 1 stops them; step 2 stops nothing the app still uses (all its channels are private), only old tabs on a build from before the flag.
- **With the flag unset:** the app's visitor rooms are public channels, so step 1 alone doesn't stop them; step 2 does, and it also stops **everything else that uses Realtime**, because all of the app's channels are then public: owner Poker/canvas/kudos rooms, squad-guest rooms, and the live push of sync, history and agent-conversation updates between your devices. Saving still works (it goes through the API, not Realtime); other devices just stop getting changes pushed until you turn public access back on.

**To undo it:** re-run the function block of `supabase/migrations/0028_realtime_visitor_prioritize_tools.sql` (it is idempotent), and turn "Allow public access" back on if the build still uses public channels. Turn `NEXT_PUBLIC_VISITOR_ROOMS` off and redeploy as well if visitor rooms shouldn't come back.

### Residual risks (accepted for v1)

- **Anyone with the link is a full member.** They see everything in the room, can claim to be the host to other participants (the host's own copy is never overwritten), and can take seats up to the 20-person cap. Removing someone is soft: they can rejoin under a new id. The firm fix is to end the room and share a new link.
- **The host election can be rigged:** members state their own join time, so a member can make sure they take over if the host leaves.
- **Anyone with the public anon key can burn Realtime quota**, with or without this feature. Rate limits only protect the people in a room, not the quota.
- **Room codes are visible** in browser history, Vercel request logs (`/join/<tool>/<code>`), and wherever the link is pasted. A code is useless once its room has ended.
- Turning the flag off needs a redeploy and doesn't close open tabs; they end by themselves within 3 hours.
- **An owner who opens a `/join` link joins as a visitor** (that page has no sign-in). Nothing from the room is written to their workspace unless they choose Save a copy.

**Vote rounds:**

1. Answers are hidden from the other participants and from what is stored, but **not from a host who opens their browser's developer tools**: the host's tab decrypts each ballot, with its sender's presence id, for an instant before adding it to the counts, and the running counts sit in the tab's memory.
2. **Who answered, and when, is visible** to everyone in the room (ballots are broadcast, encrypted, under the sender's id). What they answered is not.
3. **Anyone holding the full link can join and answer.** Only the host's questions and results are authenticated, by the key in `#k=`.
4. **A member can spend someone else's ballot** by claiming their id, and can use that to **single out one person's answers**: answer under every other member's id before they do, and after Reveal the totals minus the attacker's own answers are the target's. The victim's own answers are then refused as a second answer. Both sides are warned: the victim's screen says someone sent answers under their name, and the host sees that answers came under names that had already answered. If either warning shows, end the room and share a new link.
5. **Someone can answer again from a new tab** (a new tab is a new member). This is bounded by the 20 seats and 60 ballots per round, and the host sees a warning when answers outnumber the names in the room.
6. **minN is a floor, not a guarantee:** if everyone gives the same answer, the totals reveal everyone's answer. In an allocation round the same goes for amounts: an item total of 0 says everyone gave it nothing, and in the $100 Test a total of people × $100 says everyone gave it everything. With exactly 3 answers, the host (who knows their own split) and one other member can work out the third person's split from the totals: the same small-round risk as risk 4.
7. **The anon key can still open visitor-shaped channels** (0028 admits the app's tools and 12-character codes only), and public channels while public access is on. Watch the quota, and use both steps of the emergency brake above if it is abused.
8. **Two allocation rounds can be compared:** re-running the same sheet with nearly the same people, one person missing, lets the two sets of totals be subtracted to show that person's split. Reveal closes each round, and Buy-a-Feature's later rounds change the sheet (budgets, what's left of each price), but a facilitator re-running the $100 Test should expect this.
9. **The spread waits for 5 answers, and no exact spread is kept, on purpose.** A person's bands are linked across items (in the $100 Test someone can be in the top band of at most one item), so at 3 answers the bands would narrow each split more than a scale answer does. An exact spread (a sum of squares) is never kept: with 3 answers and the host's own split known, the totals and the sums of squares would give both other splits.
10. **A Kano grid shows how one feature's two answers went together** (that is what the Kano table needs), never one person's answers across features. At 3 answers a person who gave an unusual pair may still recognise it; it is the same floor as every vote round.

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

## The "Agile at Work" comics

The comics live at `/comics` and every story is `/comics?ep=NN`: book episodes are 1-26, weekly stories continue from 27. Printed posters add `&b=NN`, so those 260 links can never change. The middleware rewrites a valid number to a static page and leaves the address bar alone.

- **Stories** are rows in `comic_stories`, with art in the `comic-panels` bucket. Both are closed to the public API; pages read through `src/lib/comics/store.ts`.
- **Release:** a story shows once its `release_at` has passed, within about 10 minutes (`revalidate = 600`). A number that isn't released shows "coming soon" with no content.
- **If Supabase is down** the read throws, the ISR refresh fails and pages keep their last good copy. All 26 book episodes are prerendered at build, so printed links keep working even before anything is imported.
- **Free-tier download allowance:** pages load the 768 px file, and the 1536 px file only when a panel opens full screen. Don't add `srcset`: a 3x phone would pick the larger file.
- **Entry counts** are anonymous daily totals in `comic_entry_counts`, and licence requests wait in `comic_licence_requests`. Neither stores an IP address or user agent.

---

## Deploy hardening (Amr + the agent gateway)

Three things must be handled **before the mascot/agent ships publicly**. #1 is
done in the repo; #2 and #3 run against infrastructure you control and need
your SSH / dashboard login, so they're documented here rather than automated.

### 1. Amr's sprite sheet is committed (no CDN needed)

The sheet (~490 KB) is committed as `public/mascot/amr.<sha256-prefix>.webp` and
loaded from `MASCOT_SPRITE_URL` in `src/components/agent/mascot/mascot-asset.ts`.
`next.config.mjs` serves `/mascot/*` with
`Cache-Control: public, max-age=31536000, immutable`, which is safe because a
changed sheet gets a new file name. The middleware matcher skips `.webp` files
directly under `/mascot`, so loading it costs the owner no session check.

- **Remove `NEXT_PUBLIC_MASCOT_GLB_URL` from Vercel** (Settings → Environment
  Variables). Nothing loads a model any more.
- To replace the sheet: take `final/spritesheet-extended.png` from the pet pack
  (only that file: the pack also holds photo boards and rejected art), convert it
  to WebP at q88 with alpha, rename the output to
  `amr.<first 8 hex chars of its sha256>.webp`, update `MASCOT_SPRITE_URL`, delete
  the old file. `test/agent/mascot-asset.test.ts` fails if the name doesn't match
  the bytes, the file is over 700 KB, or anything else is in `public/mascot`. Never
  overwrite the existing hashed file: browsers that already cached it will keep it
  for a year.
- Amr loads after the page is idle (a small launcher shows until then), is
  skipped for visitors with Save-Data on, and falls back to the launcher if the
  sheet can't load.

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

- [ ] `NEXT_PUBLIC_MASCOT_GLB_URL` removed from Vercel; Amr loads in prod from `/mascot/amr.<hash>.webp`
- [ ] Gateway `client_max_body_size 10M`; `nginx -t` clean + reloaded; agent no longer 413s
- [ ] Supabase `service_role` (and `anon` if JWT rotated) regenerated + env updated everywhere
- [ ] OpenClaw `OPENCLAW_API_KEY` regenerated, old key invalidated, env updated
- [ ] Old leaked values confirmed dead (a request with each returns 401)
