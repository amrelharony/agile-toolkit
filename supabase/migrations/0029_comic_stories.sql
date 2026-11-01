-- 0029_comic_stories.sql
--
-- The comics section: stories and their art, anonymous entry counts, and the
-- licence request inbox.
--
-- Nobody reads these tables directly. RLS is on with no policies and every
-- privilege is revoked from anon and authenticated, so the anon key shipped
-- in the browser has no route to them. Only server code holding the service
-- role reads or writes, and pages only ever show stories whose release_at has
-- passed (src/lib/comics/store.ts). That leaves no bulk route to unreleased
-- stories or to anyone's licence request.
--
-- Idempotent: `if not exists`, `create or replace`, `on conflict`.

-- ══════════════════════════════════════════════════════════════════════
-- comic_stories
--
-- Episodes 1-26 are the printed book; weekly stories continue from 27. A null
-- release_at is a draft. "cast" is a reserved word, hence cast_names.
-- panels holds [{ pathFull, pathSmall, width, height, alt, dialogue, signs }]:
-- storage paths rather than URLs, so a CDN can come later without moving data.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.comic_stories (
  ep             int         primary key check (ep between 1 and 999),
  collection     text        not null check (collection in ('book', 'weekly')),
  source_id      text        unique,
  title          text        not null default '',
  lesson         text        not null default '',
  squad_question text        not null default '',
  cast_names     text[]      not null default '{}',
  themes         text[]      not null default '{}',
  panels         jsonb       not null default '[]'::jsonb,
  share_path     text,
  book_page      int,
  release_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint comic_stories_ep_matches_collection check (
    (collection = 'book' and ep between 1 and 26)
    or (collection = 'weekly' and ep >= 27)
  )
);

comment on table public.comic_stories is
  'Comic stories and the storage paths of their art. A null release_at is a draft. Read by server code only, through src/lib/comics/store.ts.';

create index if not exists comic_stories_release_at_idx
  on public.comic_stories (release_at);

alter table public.comic_stories enable row level security;
revoke all on table public.comic_stories from anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- comic_entry_counts
--
-- Daily totals only: which way in, which episode, which building. Nothing here
-- can identify a visitor: no IP address, user agent or cookie is ever stored.
-- ep and building are 0 for the plain /comics address.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.comic_entry_counts (
  day      date   not null,
  entry    text   not null check (entry in ('poster', 'direct')),
  ep       int    not null default 0 check (ep between 0 and 999),
  building int    not null default 0 check (building between 0 and 10),
  count    bigint not null default 0,
  primary key (day, entry, ep, building)
);

comment on table public.comic_entry_counts is
  'Anonymous daily totals of comic entries, written through comic_entry_hit. No visitor identifiers.';

alter table public.comic_entry_counts enable row level security;
revoke all on table public.comic_entry_counts from anon, authenticated;

-- One atomic add to today's total, so concurrent scans can't lose a count.
create or replace function public.comic_entry_hit(
  p_entry    text,
  p_ep       int default 0,
  p_building int default 0
) returns void
language sql
set search_path = ''
as $$
  insert into public.comic_entry_counts as c (day, entry, ep, building, count)
  values ((now() at time zone 'utc')::date, p_entry, p_ep, p_building, 1)
  on conflict (day, entry, ep, building)
  do update set count = c.count + 1;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_entry_hit(text, int, int)
  from public, anon, authenticated;
grant execute on function public.comic_entry_hit(text, int, int) to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- comic_licence_requests
--
-- What a company typed into the form on /comics/license, and nothing about
-- the browser it came from: no IP address, no user agent. The route caps the
-- unhandled rows so spam can't fill the database; the length checks here keep
-- the cap meaningful whatever writes to the table.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.comic_licence_requests (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null check (char_length(name) <= 120),
  company      text        not null check (char_length(company) <= 160),
  email        text        not null check (char_length(email) <= 254),
  intended_use text        not null check (char_length(intended_use) <= 1000),
  team_size    text        not null check (char_length(team_size) <= 40),
  message      text        not null default '' check (char_length(message) <= 2000),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz
);

comment on table public.comic_licence_requests is
  'Licence requests from /comics/license, read only by the owner through server code. No IP address or user agent is stored.';

-- The route counts these on every submission.
create index if not exists comic_licence_requests_unhandled_idx
  on public.comic_licence_requests (created_at)
  where handled_at is null;

alter table public.comic_licence_requests enable row level security;
revoke all on table public.comic_licence_requests from anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- Storage: the comic-panels bucket
--
-- Public, so a story page can load its art without a token, but with no policy
-- on storage.objects: nobody can list or write it except the service role and
-- the signed upload URLs it hands out. Paths are unguessable, and replacing art
-- uploads a new file. Not named "comics": unmerged PR 39 claims that name.
-- ══════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comic-panels',
  'comic-panels',
  true,
  5242880, -- 5 MB
  array['image/webp', 'image/jpeg']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
