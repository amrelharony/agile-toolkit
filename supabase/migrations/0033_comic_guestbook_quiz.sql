-- 0033_comic_guestbook_quiz.sql
--
-- The comics' study and community pieces (PR 10 of the comics plan):
--
--   comic_guestbook          notes readers leave at /comics/guestbook. Every one
--                            waits for the owner: nothing shows until approved.
--   comic_stories.quiz       an optional quiz under a story, written in the portal.
--   comic_stories.try_tool   an optional "try this with your team" tool for one
--                            story, over the one its theme picks.
--
-- The site reads quiz and try_tool apart from the rest of a story, and treats a
-- failed read as "none", so pages keep working before this migration runs.
--
-- Idempotent: every statement is "if not exists" or replaces what it adds.

-- ══════════════════════════════════════════════════════════════════════
-- comic_guestbook
--
-- What the reader typed and when, and nothing about the browser it came from:
-- no IP address, no user agent. The route caps the notes waiting for approval
-- so spam can't fill the database; the length checks here keep that cap
-- meaningful whatever writes to the table.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.comic_guestbook (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(name) between 1 and 60),
  message     text        not null check (char_length(message) between 1 and 500),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

comment on table public.comic_guestbook is
  'Guestbook notes from /comics/guestbook, shown only once the owner approves them. Read and written by server code only. No IP address or user agent is stored.';

-- The public page lists approved notes, newest first; the route counts the rest.
create index if not exists comic_guestbook_approved_idx
  on public.comic_guestbook (approved_at desc)
  where approved_at is not null;
create index if not exists comic_guestbook_waiting_idx
  on public.comic_guestbook (created_at)
  where approved_at is null;

alter table public.comic_guestbook enable row level security;
revoke all on table public.comic_guestbook from anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- comic_stories: quiz and try_tool
--
-- quiz is [{ question, options: [2-4], answer: index, explain? }], one to three
-- of them (lib/comics/extras.ts checks the shape). try_tool is a tool id from
-- the catalog, which the site checks against it before linking.
-- ══════════════════════════════════════════════════════════════════════
alter table public.comic_stories
  add column if not exists quiz jsonb;

alter table public.comic_stories
  add column if not exists try_tool text;

alter table public.comic_stories
  drop constraint if exists comic_stories_quiz_check;
alter table public.comic_stories
  add constraint comic_stories_quiz_check check (
    quiz is null
    or (
      jsonb_typeof(quiz) = 'array'
      and jsonb_array_length(quiz) between 1 and 3
      and octet_length(quiz::text) <= 8000
    )
  );

alter table public.comic_stories
  drop constraint if exists comic_stories_try_tool_check;
alter table public.comic_stories
  add constraint comic_stories_try_tool_check check (
    try_tool is null or try_tool ~ '^[a-z0-9-]{1,64}$'
  );
