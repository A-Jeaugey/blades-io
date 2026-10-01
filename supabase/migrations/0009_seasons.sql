-- blade.io — classements temporaires et saisons (tâche 5.4 du plan).
--
-- Classements du jour, de la semaine et de la saison : meilleur score de
-- chaque joueur parmi ses parties publiques de la période (comme
-- leaderboard_top, qui reste le classement de tous les temps). Les bornes
-- (minuit, lundi, début de saison, heure de Paris) sont calculées par le
-- serveur de jeu (shared/src/seasons.ts).
--
-- Fin de saison : les dix premiers reçoivent des trophées, une seule fois
-- (seasons_closed sert de verrou), et le résultat est gardé dans
-- season_results. Tout passe par le service role : fonctions et tables
-- retirées à anon et authenticated.

create table if not exists public.season_results (
  season  integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  rank    integer not null,
  score   integer not null,
  reward  integer not null,
  primary key (season, user_id)
);

create table if not exists public.seasons_closed (
  season    integer primary key,
  rewarded  integer not null default 0,
  closed_at timestamptz not null default now()
);

alter table public.season_results enable row level security;
alter table public.seasons_closed enable row level security;

------------------------------------------------------------------------------
-- leaderboard_since : classement d'une période [p_since, p_until).
------------------------------------------------------------------------------

create or replace function public.leaderboard_since(
  p_since timestamptz,
  p_until timestamptz,
  p_limit integer
) returns table (
  user_id          uuid,
  username         text,
  score            integer,
  kills            integer,
  max_blades       integer,
  survival_seconds integer,
  games_played     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select
      m.user_id,
      max(m.score)            as best_score,
      max(m.kills)            as best_kills,
      max(m.max_blades)       as best_max_blades,
      max(m.survival_seconds) as best_survival,
      count(*)                as games
    from public.matches m
    where m.room_code is null
      and m.created_at >= p_since
      and m.created_at < p_until
    group by m.user_id
  )
  select p.id, p.username, b.best_score, b.best_kills, b.best_max_blades, b.best_survival, b.games
  from best b
  join public.profiles p on p.id = b.user_id
  order by b.best_score desc, b.games desc, p.id
  limit greatest(1, least(p_limit, 200));
$$;

------------------------------------------------------------------------------
-- player_rank_since : rang d'un joueur sur la période (null sans partie).
------------------------------------------------------------------------------

create or replace function public.player_rank_since(
  p_user  uuid,
  p_since timestamptz,
  p_until timestamptz
) returns table (rank bigint, score integer)
language sql
stable
security definer
set search_path = public
as $$
  with best as (
    select m.user_id, max(m.score) as best_score
    from public.matches m
    where m.room_code is null
      and m.created_at >= p_since
      and m.created_at < p_until
    group by m.user_id
  ), mine as (
    select best_score from best where user_id = p_user
  )
  select (select count(*) from best where best_score > mine.best_score) + 1, mine.best_score
  from mine;
$$;

------------------------------------------------------------------------------
-- close_season : récompense les premiers d'une saison terminée, une fois.
-- p_rewards : trophées du 1er, du 2e… Renvoie le nombre de joueurs
-- récompensés par cet appel (0 si la saison était déjà close).
------------------------------------------------------------------------------

create or replace function public.close_season(
  p_season  integer,
  p_start   timestamptz,
  p_end     timestamptz,
  p_rewards integer[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  n     integer := 0;
  total integer := coalesce(array_length(p_rewards, 1), 0);
begin
  insert into public.seasons_closed (season) values (p_season) on conflict do nothing;
  if not found then
    return 0;
  end if;
  if total > 0 then
    for r in select * from public.leaderboard_since(p_start, p_end, total) loop
      n := n + 1;
      insert into public.season_results (season, user_id, rank, score, reward)
        values (p_season, r.user_id, n, r.score, p_rewards[n]);
      perform public.credit_wallet(r.user_id, p_rewards[n]::bigint);
    end loop;
  end if;
  update public.seasons_closed set rewarded = n where season = p_season;
  return n;
end;
$$;

revoke all on function public.leaderboard_since(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.player_rank_since(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.close_season(integer, timestamptz, timestamptz, integer[]) from public, anon, authenticated;
grant execute on function public.leaderboard_since(timestamptz, timestamptz, integer) to service_role;
grant execute on function public.player_rank_since(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.close_season(integer, timestamptz, timestamptz, integer[]) to service_role;
