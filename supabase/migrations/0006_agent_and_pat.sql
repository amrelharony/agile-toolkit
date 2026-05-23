-- Agile Toolkit — Agent conversations + MCP personal access tokens
--
-- ══════════════════════════════════════════════════════════════════════
-- Tables
-- ══════════════════════════════════════════════════════════════════════
-- agent_conversations  — one row per chat thread with the in-app agent.
-- agent_messages       — one row per message inside a conversation.
-- access_tokens        — hashed PATs used to authenticate MCP requests.

-- ══════════════════════════════════════════════════════════════════════
-- agent_conversations
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.agent_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text not null check (char_length(title) <= 200),
  /** Optional tool context — when set, the agent system prompt narrows
   *  focus to actions for this toolId. */
  tool_id         text check (tool_id is null or char_length(tool_id) <= 64),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists agent_conversations_user_last_msg_idx
  on public.agent_conversations(user_id, last_message_at desc);

alter table public.agent_conversations enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- agent_messages
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.agent_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.agent_conversations(id) on delete cascade,
  role             text not null check (role in ('user','assistant','tool')),
  /** content is a JSON array of blocks per Anthropic message-format:
   *    [{type:"text",text:"..."}]
   *    [{type:"tool_use",id:"...",name:"...",input:{...}}]
   *    [{type:"tool_result",tool_use_id:"...",content:"..."}]
   */
  content          jsonb not null check (octet_length(content::text) <= 262144), -- 256 KB
  created_at       timestamptz not null default now()
);

create index if not exists agent_messages_conv_created_idx
  on public.agent_messages(conversation_id, created_at);

alter table public.agent_messages enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- access_tokens — MCP personal access tokens
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.access_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  /** Hash of the raw token. Constructed as base64url(scrypt(rawToken, salt)).
   *  Raw token is shown to the user ONCE on creation and never stored. */
  token_hash    text not null unique check (char_length(token_hash) between 32 and 256),
  /** First 8 chars of the raw token, plaintext, for UI display:
   *  "starts with pat_a3f9…". Not security-sensitive on its own. */
  prefix        text not null check (char_length(prefix) = 8),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);

create index if not exists access_tokens_user_idx
  on public.access_tokens(user_id);
create index if not exists access_tokens_hash_idx
  on public.access_tokens(token_hash);

alter table public.access_tokens enable row level security;

-- ══════════════════════════════════════════════════════════════════════
-- GRANTs (defense-in-depth)
-- ══════════════════════════════════════════════════════════════════════
revoke all on table public.agent_conversations from anon;
revoke all on table public.agent_messages      from anon;
revoke all on table public.access_tokens       from anon;

grant select, insert, update, delete on table public.agent_conversations to authenticated;
grant select, insert, delete         on table public.agent_messages      to authenticated;
grant select, insert, update, delete on table public.access_tokens       to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RLS — every row private to its user_id
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists "agent_conv_select_own" on public.agent_conversations;
drop policy if exists "agent_conv_insert_own" on public.agent_conversations;
drop policy if exists "agent_conv_update_own" on public.agent_conversations;
drop policy if exists "agent_conv_delete_own" on public.agent_conversations;
drop policy if exists "agent_msg_select_via_conv" on public.agent_messages;
drop policy if exists "agent_msg_insert_via_conv" on public.agent_messages;
drop policy if exists "agent_msg_delete_via_conv" on public.agent_messages;
drop policy if exists "access_tokens_select_own" on public.access_tokens;
drop policy if exists "access_tokens_insert_own" on public.access_tokens;
drop policy if exists "access_tokens_update_own" on public.access_tokens;
drop policy if exists "access_tokens_delete_own" on public.access_tokens;

create policy "agent_conv_select_own"
  on public.agent_conversations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "agent_conv_insert_own"
  on public.agent_conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "agent_conv_update_own"
  on public.agent_conversations for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "agent_conv_delete_own"
  on public.agent_conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "agent_msg_select_via_conv"
  on public.agent_messages for select to authenticated
  using (exists (
    select 1 from public.agent_conversations c
    where c.id = agent_messages.conversation_id
      and c.user_id = (select auth.uid())
  ));
create policy "agent_msg_insert_via_conv"
  on public.agent_messages for insert to authenticated
  with check (exists (
    select 1 from public.agent_conversations c
    where c.id = agent_messages.conversation_id
      and c.user_id = (select auth.uid())
  ));
create policy "agent_msg_delete_via_conv"
  on public.agent_messages for delete to authenticated
  using (exists (
    select 1 from public.agent_conversations c
    where c.id = agent_messages.conversation_id
      and c.user_id = (select auth.uid())
  ));

create policy "access_tokens_select_own"
  on public.access_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "access_tokens_insert_own"
  on public.access_tokens for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "access_tokens_update_own"
  on public.access_tokens for update to authenticated
  using      ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "access_tokens_delete_own"
  on public.access_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ══════════════════════════════════════════════════════════════════════
-- PAT lookup function (security definer — bypasses RLS for unauthenticated
-- bearer-token resolution at the MCP HTTP transport layer)
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.resolve_pat(p_hash text)
  returns table (token_id uuid, user_id uuid)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  return query
    update public.access_tokens
    set last_used_at = now()
    where token_hash = p_hash
      and revoked_at is null
      and (expires_at is null or expires_at > now())
    returning id, access_tokens.user_id;
end;
$$;

revoke all     on function public.resolve_pat(text) from public;
grant  execute on function public.resolve_pat(text) to service_role;
