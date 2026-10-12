-- blade.io — mode classé (retours de jeu du 2026-10-12).
--
-- Points de rang (PR) par compte et par saison (saisons de six semaines,
-- shared/src/seasons.ts : le serveur de jeu calcule le numéro). Le calcul du
-- gain d'une manche vit dans shared/src/ranked.ts ; la base applique le gain
-- de façon atomique, sans jamais descendre sous 0, et fait la
-- réinitialisation douce : la première manche d'une saison part d'une part
-- des PR de la dernière saison jouée (p_carry, RANKED_SEASON_CARRY).
--
-- Comme les défis (0008) et les saisons (0009) : RLS activée sans policy,
-- fonctions retirées à anon et authenticated, tout passe par le service
-- role du serveur de jeu (GET /api/ranked/me, GET /api/ranked/leaderboard,
-- fin de manche).
--
-- Suivi (calibrage de l'attente de score, cf. shared/src/ranked.ts) :
--   select * from public.ranked_overview;

create table if not exists public.ranked_seasons (
  user_id    uuid not null references auth.users(id) on delete cascade,
  season     integer not null check (season >= 0),
  pr         integer not null default 0 check (pr >= 0),
  games      integer not null default 0 check (games >= 0),
  best_pr    integer not null default 0 check (best_pr >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, season)
);

-- Classement d'une saison : PR décroissants.
create index if not exists ranked_seasons_board_idx
  on public.ranked_seasons (season, pr desc, games desc);

alter table public.ranked_seasons enable row level security;

------------------------------------------------------------------------------
-- ranked_start_pr : PR de départ d'un joueur dans une saison où il n'a pas
-- encore joué, d'après la dernière saison jouée avant elle (0 sinon).
------------------------------------------------------------------------------

create or replace function public.ranked_start_pr(
  p_user   uuid,
  p_season integer,
  p_carry  numeric
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select floor(r.pr * greatest(0, least(1, p_carry)))::integer
    from public.ranked_seasons r
    where r.user_id = p_user and r.season < p_season
    order by r.season desc
    limit 1
  ), 0);
$$;

------------------------------------------------------------------------------
-- apply_ranked_delta : applique le gain (ou la perte) d'une manche, ou la
-- pénalité d'un départ. Plancher à 0, une partie de plus, meilleur total.
-- Renvoie { before, after, games, best }.
------------------------------------------------------------------------------

create or replace function public.apply_ranked_delta(
  p_user   uuid,
  p_season integer,
  p_delta  integer,
  p_carry  numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before integer;
  v_after  integer;
  v_games  integer;
  v_best   integer;
begin
  if p_season < 0 then
    raise exception 'invalid season %', p_season;
  end if;
  loop
    -- Ligne de la saison verrouillée : deux manches du même joueur qui
    -- finissent ensemble (deux onglets) s'appliquent l'une après l'autre.
    select r.pr into v_before
      from public.ranked_seasons r
     where r.user_id = p_user and r.season = p_season
       for update;
    if found then
      v_after := greatest(0, v_before + p_delta);
      update public.ranked_seasons r
         set pr = v_after,
             games = r.games + 1,
             best_pr = greatest(r.best_pr, v_after),
             updated_at = now()
       where r.user_id = p_user and r.season = p_season
      returning r.games, r.best_pr into v_games, v_best;
      exit;
    end if;
    -- Première manche de la saison : réinitialisation douce.
    v_before := public.ranked_start_pr(p_user, p_season, p_carry);
    v_after := greatest(0, v_before + p_delta);
    begin
      insert into public.ranked_seasons (user_id, season, pr, games, best_pr)
        values (p_user, p_season, v_after, 1, greatest(v_before, v_after));
      v_games := 1;
      v_best := greatest(v_before, v_after);
      exit;
    exception when unique_violation then
      -- Une autre manche vient de créer la ligne : on repasse par la mise
      -- à jour, sur son total.
    end;
  end loop;
  return jsonb_build_object('before', v_before, 'after', v_after, 'games', v_games, 'best', v_best);
end;
$$;

------------------------------------------------------------------------------
-- ranked_status : PR, parties, meilleur total et rang d'un joueur dans une
-- saison ; avant sa première manche, ses PR de départ et rank null.
------------------------------------------------------------------------------

create or replace function public.ranked_status(
  p_user   uuid,
  p_season integer,
  p_carry  numeric
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row  public.ranked_seasons;
  v_rank bigint;
  v_pr   integer;
begin
  select * into v_row
    from public.ranked_seasons r
   where r.user_id = p_user and r.season = p_season;
  if not found then
    v_pr := public.ranked_start_pr(p_user, p_season, p_carry);
    return jsonb_build_object('pr', v_pr, 'games', 0, 'best', v_pr, 'rank', null);
  end if;
  -- Même ordre que ranked_leaderboard : PR, puis parties, puis identifiant.
  select count(*) + 1 into v_rank
    from public.ranked_seasons r
   where r.season = p_season
     and (r.pr, r.games, v_row.user_id) > (v_row.pr, v_row.games, r.user_id);
  return jsonb_build_object('pr', v_row.pr, 'games', v_row.games, 'best', v_row.best_pr, 'rank', v_rank);
end;
$$;

------------------------------------------------------------------------------
-- ranked_leaderboard : les premiers d'une saison (50 au plus).
------------------------------------------------------------------------------

create or replace function public.ranked_leaderboard(
  p_season integer,
  p_limit  integer
) returns table (
  user_id  uuid,
  username text,
  pr       integer,
  games    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, p.username, r.pr, r.games
  from public.ranked_seasons r
  join public.profiles p on p.id = r.user_id
  where r.season = p_season
  order by r.pr desc, r.games desc, r.user_id
  limit greatest(1, least(p_limit, 50));
$$;

-- Répartition par saison : joueurs, manches, PR moyens, médians, maximum.
create or replace view public.ranked_overview
  with (security_invoker = on) as
  select
    season,
    count(*) as players,
    sum(games) as games,
    round(avg(pr)) as avg_pr,
    percentile_cont(0.5) within group (order by pr) as median_pr,
    max(pr) as max_pr
  from public.ranked_seasons
  group by season
  order by season desc;

revoke all on public.ranked_overview from anon, authenticated;
revoke all on function public.ranked_start_pr(uuid, integer, numeric) from public, anon, authenticated;
revoke all on function public.apply_ranked_delta(uuid, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.ranked_status(uuid, integer, numeric) from public, anon, authenticated;
revoke all on function public.ranked_leaderboard(integer, integer) from public, anon, authenticated;
grant execute on function public.ranked_start_pr(uuid, integer, numeric) to service_role;
grant execute on function public.apply_ranked_delta(uuid, integer, integer, numeric) to service_role;
grant execute on function public.ranked_status(uuid, integer, numeric) to service_role;
grant execute on function public.ranked_leaderboard(integer, integer) to service_role;
