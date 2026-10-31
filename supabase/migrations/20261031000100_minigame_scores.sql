begin;

create table if not exists public.minigame_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  score integer not null,
  correct_answers integer not null default 0 check (correct_answers >= 0),
  wrong_answers integer not null default 0 check (wrong_answers >= 0),
  timed_mode boolean not null default false,
  mode text not null default 'free' check (mode in ('free', 'timed', 'challenge')),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now()
);

create index if not exists minigame_scores_ranking_idx
  on public.minigame_scores(score desc, created_at asc);

alter table public.minigame_scores enable row level security;

drop policy if exists minigame_scores_select_authenticated on public.minigame_scores;
create policy minigame_scores_select_authenticated on public.minigame_scores
  for select to authenticated using (true);

drop policy if exists minigame_scores_insert_own on public.minigame_scores;
create policy minigame_scores_insert_own on public.minigame_scores
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.minigame_scores from anon;
grant select, insert on public.minigame_scores to authenticated;
revoke update, delete on public.minigame_scores from authenticated;

commit;
