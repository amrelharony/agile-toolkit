-- 0035_comic_guess_taps.sql
--
-- Weekly stories become something to do as well as read: before the last panel
-- shows, the reader guesses what happens; afterwards they can say whether
-- they've seen that habit at work; and each story can carry one small thing to
-- try this week.
--
-- comic_stories.guess: { question, options: [2-4], happened: index, note? }.
--   `happened` is the option the last panel shows. lib/comics/guess.ts checks the
--   whole shape; this only holds it to an object of the right size. Null means
--   no guess, and the story shows all its panels as before.
-- comic_stories.try_action: the line under "Try it this week".
-- comic_stories.extras_draft: what an import brought in for the owner to check,
--   { guess?, tryAction?, tryTool? }. No page reads it. Approving in the portal
--   copies it into the live columns and clears it, so nothing drafted is shown
--   before the owner has said yes.
--
-- comic_story_taps: anonymous running totals per story. kind 'guess' counts
--   each option picked (choice = the option's index); kind 'seen' counts
--   "Yes, I've seen this" (0) and "Not yet" (1). No IP address, user agent,
--   cookie or time is stored, and no row says who tapped. Only the service role
--   may call comic_story_tap, through /api/comics/taps, which allowlists ep,
--   kind and choice.
--
-- Idempotent: `if not exists`, `drop constraint if exists` and
-- `create or replace` throughout.

alter table public.comic_stories
  add column if not exists guess jsonb;

alter table public.comic_stories
  add column if not exists try_action text;

alter table public.comic_stories
  add column if not exists extras_draft jsonb;

alter table public.comic_stories
  drop constraint if exists comic_stories_guess_check;
alter table public.comic_stories
  add constraint comic_stories_guess_check check (
    guess is null
    or (
      jsonb_typeof(guess) = 'object'
      and jsonb_typeof(guess -> 'options') = 'array'
      and jsonb_array_length(guess -> 'options') between 2 and 4
      and octet_length(guess::text) <= 4000
    )
  );

alter table public.comic_stories
  drop constraint if exists comic_stories_try_action_check;
alter table public.comic_stories
  add constraint comic_stories_try_action_check check (
    try_action is null or char_length(try_action) between 1 and 160
  );

alter table public.comic_stories
  drop constraint if exists comic_stories_extras_draft_check;
alter table public.comic_stories
  add constraint comic_stories_extras_draft_check check (
    extras_draft is null
    or (jsonb_typeof(extras_draft) = 'object' and octet_length(extras_draft::text) <= 8000)
  );

create table if not exists public.comic_story_taps (
  ep     int      not null check (ep between 27 and 999),
  kind   text     not null check (kind in ('guess', 'seen')),
  choice smallint not null check (choice between 0 and 3),
  count  bigint   not null default 0,
  primary key (ep, kind, choice)
);

comment on table public.comic_story_taps is
  'Anonymous running totals of guesses and "seen this at work" taps per weekly story, written through comic_story_tap. No visitor identifiers.';

alter table public.comic_story_taps enable row level security;
revoke all on table public.comic_story_taps from anon, authenticated;

-- One atomic add, then every total for that story and kind, so the reader sees
-- the split their tap is part of. The insert's own row comes from RETURNING: the
-- rest of the statement reads the table as it was before the insert.
create or replace function public.comic_story_tap(
  p_ep     int,
  p_kind   text,
  p_choice smallint
) returns table (tap_choice smallint, tap_count bigint)
language sql
set search_path = ''
as $$
  with hit as (
    insert into public.comic_story_taps as t (ep, kind, choice, count)
    values (p_ep, p_kind, p_choice, 1)
    on conflict (ep, kind, choice)
    do update set count = t.count + 1
    returning t.choice, t.count
  )
  select hit.choice, hit.count from hit
  union all
  select t.choice, t.count
    from public.comic_story_taps t
   where t.ep = p_ep and t.kind = p_kind and t.choice <> p_choice;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_story_tap(int, text, smallint)
  from public, anon, authenticated;
grant execute on function public.comic_story_tap(int, text, smallint) to service_role;
