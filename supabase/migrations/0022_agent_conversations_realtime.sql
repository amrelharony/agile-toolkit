-- Agile Toolkit — realtime for agent_conversations (multi-tab history sync).
--
-- The conversation list subscribes to postgres_changes on agent_conversations so
-- a thread created / renamed / deleted in one tab or device appears live in
-- another. The subscription only TRIGGERS a re-fetch (listConversations), which
-- is itself RLS-filtered — so the realtime event is just a "something changed"
-- signal and never leaks another user's rows.
--
-- REPLICA IDENTITY FULL so realtime filters on non-PK columns (user_id) work;
-- the publication add is idempotent and degrades gracefully where realtime isn't
-- enabled (mirrors history_events in 0002).

alter table public.agent_conversations replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.agent_conversations;
exception
  when duplicate_object then null; -- already in the publication (re-run)
  when undefined_object then null; -- no realtime (self-hosted); push-only is fine
end $$;
