-- Agile Toolkit — Realtime Room Infrastructure
-- Enables multiplayer on tools that opt into the Realtime Layer.

create table if not exists rooms (
  id text primary key,
  tool_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table if not exists room_state (
  room_id text references rooms(id) on delete cascade,
  tool_id text not null,
  snapshot jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, tool_id)
);

create index if not exists rooms_tool_id_idx on rooms(tool_id);
create index if not exists room_state_updated_at_idx on room_state(updated_at desc);

alter table rooms enable row level security;
alter table room_state enable row level security;

create policy "anyone can read rooms" on rooms for select using (true);
create policy "anyone can create rooms" on rooms for insert with check (true);
create policy "anyone can update rooms" on rooms for update using (true);

create policy "anyone can read room_state" on room_state for select using (true);
create policy "anyone can write room_state" on room_state for insert with check (true);
create policy "anyone can update room_state" on room_state for update using (true);
create policy "anyone can delete room_state" on room_state for delete using (true);

alter publication supabase_realtime add table room_state;

create or replace function purge_expired_rooms() returns void as $$
  delete from rooms where expires_at < now();
$$ language sql security definer;
