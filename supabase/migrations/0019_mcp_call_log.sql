-- Agile Toolkit — MCP call observability log.
--
-- ══════════════════════════════════════════════════════════════════════
-- Why this exists
-- ══════════════════════════════════════════════════════════════════════
-- Phase 3 hardening of the MCP buildout. Every authorized-agent tools/call
-- records a structured row here so the workspace owner can see which tools
-- agents actually exercise, their error rates, latency, and per-squad
-- attribution. This is analytics, not an audit/security control — it is
-- best-effort: the transport swallows insert failures so logging can never
-- affect an agent's tool call (see src/lib/mcp/call-log.ts).
--
-- Writes come exclusively from the MCP route via the service-role client
-- (RLS is bypassed for the insert). Reads are owner-scoped via RLS so a
-- future in-app analytics view can query a user's own rows with the
-- anon/auth client.
--
-- ══════════════════════════════════════════════════════════════════════
-- Table
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.mcp_call_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  action_id     text not null,
  duration_ms   integer not null,
  squad_profile_ids uuid[] not null default '{}'::uuid[],
  is_error      boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.mcp_call_log is
  'Structured per-call log for MCP tools/call invocations (Phase 3 observability). Best-effort analytics, written by the service role from the MCP route; owner-readable via RLS. Not an audit/security control.';

-- Analytics access pattern: a user''s recent calls, newest first. Also
-- serves "error rate by action over the last N days" style queries.
create index if not exists mcp_call_log_user_created_idx
  on public.mcp_call_log (user_id, created_at desc);

create index if not exists mcp_call_log_user_action_idx
  on public.mcp_call_log (user_id, action_id);

-- ══════════════════════════════════════════════════════════════════════
-- RLS — owner reads own rows; no client-side writes.
-- ══════════════════════════════════════════════════════════════════════
alter table public.mcp_call_log enable row level security;

-- Owner can read their own call log (for an in-app analytics view).
drop policy if exists mcp_call_log_select_own on public.mcp_call_log;
create policy mcp_call_log_select_own
  on public.mcp_call_log
  for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for anon/authenticated: only the
-- service-role client (which bypasses RLS) writes here. This prevents a
-- client from forging or tampering with log rows.

grant select on public.mcp_call_log to authenticated;
