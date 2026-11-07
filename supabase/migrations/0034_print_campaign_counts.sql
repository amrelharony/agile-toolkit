-- 0034_print_campaign_counts.sql
--
-- The print campaign's visit counts, and the episode a kudos card was written for.
--
-- comic_visit_counts: one row per month, page, printed piece and episode. Every
-- QR code the campaign prints says which piece it's on (`src`): the posters and
-- kudos cards on /comics, the book's page 161 and back cover, the kudos wall sign
-- and the Scrum Master guide on /kudos. "comics" is the comic pages' own links to
-- /kudos, and "none" anything else. Nothing here can identify a visitor: no IP
-- address, user agent, cookie or time finer than the month is ever stored, and
-- the browser keeps nothing either. lib/comics/visits.ts allowlists what the
-- public beacon may send, and only the service role may call comic_visit_hit.
--
-- comic_entry_counts (0029) stays as it is: the VIP link in the book keeps
-- counting there, and its old daily poster and building rows remain readable.
--
-- kudos.episode: a kudos card opened from an episode (/kudos?ep=NN) keeps its
-- number, so its headline and quote are always read from the print campaign's
-- data file rather than copied into the row.
--
-- Idempotent: `if not exists` and `create or replace` throughout.

create table if not exists public.comic_visit_counts (
  month date   not null check (month = date_trunc('month', month)::date),
  path  text   not null check (path in ('/comics', '/kudos')),
  src   text   not null check (src in ('poster', 'kudos', 'book', 'sign', 'guide', 'comics', 'none')),
  ep    int    not null default 0 check (ep between 0 and 999),
  count bigint not null default 0,
  primary key (month, path, src, ep)
);

comment on table public.comic_visit_counts is
  'Anonymous monthly totals of visits by printed piece, written through comic_visit_hit. No visitor identifiers.';

alter table public.comic_visit_counts enable row level security;
revoke all on table public.comic_visit_counts from anon, authenticated;

-- One atomic add to this month's total, so concurrent scans can't lose a count.
create or replace function public.comic_visit_hit(
  p_path text,
  p_src  text,
  p_ep   int default 0
) returns void
language sql
set search_path = ''
as $$
  insert into public.comic_visit_counts as c (month, path, src, ep, count)
  values (date_trunc('month', now() at time zone 'utc')::date, p_path, p_src, p_ep, 1)
  on conflict (month, path, src, ep)
  do update set count = c.count + 1;
$$;

-- `from public` alone isn't enough: Supabase grants EXECUTE explicitly to anon
-- and authenticated (see 0025). Service role only.
revoke all on function public.comic_visit_hit(text, text, int)
  from public, anon, authenticated;
grant execute on function public.comic_visit_hit(text, text, int) to service_role;

alter table public.kudos
  add column if not exists episode smallint check (episode between 1 and 26);

comment on column public.kudos.episode is
  'The book episode whose printed kudos card this one was written from (/kudos?ep=NN), or null.';
