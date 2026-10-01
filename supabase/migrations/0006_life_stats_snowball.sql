-- blade.io — télémétrie des contre-mesures au snowball (tâche 4.2 du plan).
--
-- Nouvelles colonnes de life_stats (cf. 0005_life_stats.sql) :
--   was_leader : la vie finit alors que le joueur est le leader (couronne) ;
--   leader_ms  : temps passé leader pendant la vie (approxime la durée du
--                règne : une vie peut en compter plusieurs) ;
--   bounty     : prime versée à son tueur (0 sans prime) ;
--   underdog   : tué par un joueur qui avait au plus la moitié de ses lames.
--
-- Les vues gagnent des colonnes en fin de liste (create or replace view
-- n'accepte que des ajouts à la fin).

alter table public.life_stats
  add column if not exists was_leader boolean  not null default false,
  add column if not exists leader_ms  integer  not null default 0,
  add column if not exists bounty     smallint not null default 0,
  add column if not exists underdog   boolean  not null default false;

create or replace view public.life_stats_summary
  with (security_invoker = on) as
  with recent as (
    select * from public.life_stats
    where created_at > now() - interval '7 days' and not room_private
  ),
  deaths as (
    select cause, count(*) as n
    from recent
    where cause in ('blades', 'throw', 'wall')
    group by cause
  )
  select
    (select count(*) from recent) as lives,
    (select count(*) from recent where life_index = 1) as first_lives,
    (select round(100.0 * avg((duration_ms < 20000)::int), 1)
       from recent where life_index = 1) as first_lives_under_20s_pct,
    (select round(100.0 * avg((duration_ms < 20000)::int), 1)
       from recent where life_index = 1 and newcomer) as newcomer_first_lives_under_20s_pct,
    (select round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1)
       from recent) as median_life_s,
    (select cause from deaths order by n desc limit 1) as top_death_cause,
    (select round(100.0 * max(n) / nullif(sum(n), 0), 1) from deaths) as top_death_cause_pct,
    -- Part des morts face à un joueur où le tueur était au moins deux fois
    -- plus petit.
    (select round(100.0 * avg(underdog::int), 1)
       from recent where killer_kind is not null) as underdog_kills_pct,
    -- Durée médiane passée leader, parmi les vies qui l'ont été.
    (select round((percentile_cont(0.5) within group (order by leader_ms) / 1000.0)::numeric, 1)
       from recent where leader_ms > 0) as median_leader_s,
    (select count(*) from recent where bounty > 0) as bounties_paid;

create or replace view public.life_stats_daily
  with (security_invoker = on) as
  select
    date_trunc('day', created_at)::date as day,
    count(*) as lives,
    round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1) as median_life_s,
    round(100.0 * avg((duration_ms < 20000)::int) filter (where life_index = 1), 1) as first_lives_under_20s_pct,
    round(100.0 * avg((cause = 'wall')::int), 1) as wall_deaths_pct,
    round(avg(max_blades), 1) as avg_max_blades,
    round(avg(boost_ms) / 1000.0, 1) as avg_boost_s,
    round(100.0 * sum(throw_hits) / nullif(sum(throws), 0), 1) as throw_accuracy_pct,
    round(100.0 * avg(underdog::int) filter (where killer_kind is not null), 1) as underdog_kills_pct,
    round((percentile_cont(0.5) within group (order by leader_ms) filter (where leader_ms > 0) / 1000.0)::numeric, 1) as median_leader_s
  from public.life_stats
  where created_at > now() - interval '30 days' and not room_private
  group by 1
  order by 1 desc;

revoke all on public.life_stats_summary, public.life_stats_daily from anon, authenticated;
