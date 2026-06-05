# Supabase migrations — numbering & parallel-branch coordination

Migrations are `NNNN_short_name.sql`, applied in **numeric order** by
`supabase db push`. The 4-digit prefix is the version recorded in
`supabase_migrations.schema_migrations`; it must be **unique and monotonic**.

## Picking a number (parallel squads — read this)

Several squads add migrations on separate branches at the same time. Two
branches that both grab the _same_ next number collide: whichever lands on
`master` first applies and records that version; the second can never apply
(`duplicate key … schema_migrations_pkey`), which silently leaves the DB out of
sync with code that already merged expecting the new schema.

To avoid it:

1. Before adding a migration, `git fetch origin && ls supabase/migrations` (or
   check the open PRs) and take the next number **above anything in flight**, not
   just above what's on your branch.
2. If you discover a collision at merge time, **renumber the not-yet-applied
   file to the next free number** (the already-applied one keeps its number).
3. Keep every migration idempotent (`if not exists`, `create or replace`,
   `do $$ … exception when duplicate_object then null …`) so a re-run is safe.

## Resolved collision: 0022 (2026-06)

Two squads independently used `0022`:

| Version | File                                    | Status                                          |
| ------- | --------------------------------------- | ----------------------------------------------- |
| 0022    | `0022_agent_conversations_realtime.sql` | applied first → kept 0022                       |
| 0023    | `0023_pat_access_level.sql`             | **renumbered** from `0022_pat_access_level.sql` |

Both are applied to prod (`0020`–`0023` synced).

**If your branch still contains `0022_pat_access_level.sql`** (the pre-renumber
name), reconcile on your next rebase onto `master`:

1. Delete your `supabase/migrations/0022_pat_access_level.sql` — the identical
   content lives at `0023_pat_access_level.sql` on `master`.
2. If your **local** Supabase already recorded it as `0022`, the local history
   now diverges from remote. Re-sync with:
   ```bash
   supabase migration repair --status reverted 0022   # drop the stale 0022 record
   supabase db push                                    # re-applies it as 0023
   ```
   (Prod is already correct — this only fixes a local dev DB that pushed the old
   `0022_pat_access_level`.)
