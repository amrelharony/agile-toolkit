# Agile Toolkit — operator runbook

Everything required to bring the single-user refactor online, in roughly the order you'll touch each system. Five steps, ~30 min start-to-finish if you've never used Supabase before; ~10 min if you have.

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

---

## 2. Create `.env.local` (1 min)

```bash
cp .env.example .env.local
```

Then fill in the values you just copied. Minimum required:

```bash
AUTHORIZED_EMAILS=elharonyclaw@gmail.com   # comma-separated; missing = deny all
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
- `supabase/migrations/0002_auth_history.sql`  *(if not already applied from an older deploy)*
- `supabase/migrations/0003_share_tokens.sql`  *(same)*
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
2. Open http://localhost:3000 → you should be redirected to `/auth/sign-in`.
3. Click **Continue with Google** → sign in with the email in `AUTHORIZED_EMAILS`.
4. You should land back at `/` with full app chrome (sidebar + header + tools list).
5. Try a write through the chat agent (header → message-square icon, or Cmd/Ctrl+K twice):
   - Ask: *"Create a sprint called Sprint 47 starting today for 2 weeks at 30 points."*
   - Expect a "Confirm action" card for `workspace.sprint.create`. Click **Approve**.
   - Navigate to `/sprint-goal` → the sprint should appear.
6. Reload the page → sprint persists (came back from Supabase, not just localStorage).
7. Open the same URL in a second browser (Chrome + Firefox, or one normal + one private window) → sign in same account → the sprint appears within ~2 s.

If any of those steps fails, check:
- Browser console for errors
- Network tab → look for 401/403 from `/api/agent/stream` or `/api/access-tokens`
- Supabase logs → **Logs → Postgres** for RLS denials

---

## 5. Connect Claude Desktop via MCP (5 min, optional)

1. In the toolkit: header avatar → **Access tokens** → name it (e.g. *Claude Desktop on Laptop*) → **Create**.
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
6. Try in Claude Desktop: *"List my sprints from the agile toolkit"* → it calls `workspace_sprint_list` and shows the result.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Every page redirects to `/not-authorized` | `AUTHORIZED_EMAILS` unset or wrong email | Check `.env.local`, restart dev server |
| `/auth/sign-in` works but bounces back unauth'd | Google redirect URI mismatch | Add `http://localhost:3000` to Supabase Auth → URL config |
| Agent sheet won't open / says "no GLM key" | Neither `ZAI_API_KEY` set nor BYOK configured | Set the server key, or click avatar → **AI settings (BYOK)** and paste a GLM key |
| Agent returns "Insufficient balance" | z.ai account has no credit AND you picked a paid model | Top up at z.ai/manage-pricing OR set `ZAI_AGENT_MODEL=glm-4.5-flash` (free tier) |
| MCP returns 401 | PAT typo, revoked, or `SUPABASE_SERVICE_ROLE_KEY` missing | Verify token in `/settings/access-tokens`; verify env on server |
| `tools/list` returns empty over MCP | Action registry didn't load on the API route runtime | Restart dev server; check `src/app/api/mcp/route.ts` still imports `register-all` |
| Two tabs show different workspace | Sync engine not running (auth not detected) | Check browser console for `[sync:*]` errors; verify Supabase is reachable |

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
