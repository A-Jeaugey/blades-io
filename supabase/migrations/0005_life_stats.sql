-- blade.io — télémétrie de gameplay (tâche 4.8 du plan).
--
-- Une ligne par fin de vie d'un joueur humain, écrite par le serveur de jeu
-- (service role, cf. server/src/telemetry.ts). Les bots ne sont pas
-- enregistrés. Aucune donnée identifiante pour les invités ; user_id pour
-- les joueurs connectés.
--
-- RLS activée sans aucune policy : ni lecture ni écriture depuis les
-- clients. Les vues sont en security_invoker (elles appliquent les droits
-- de l'appelant, donc la RLS de la table) et leur accès est retiré à anon
-- et authenticated : on les interroge depuis l'éditeur SQL du dashboard.
--
-- Questions de référence :
--   select first_lives_under_20s_pct, top_death_cause from public.life_stats_summary;

create table if not exists public.life_stats (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  room_private   boolean     not null,
  user_id        uuid        references auth.users(id) on delete set null,
  -- 1 = première vie depuis l'arrivée dans la room.
  life_index     smallint    not null,
  -- Première partie sur cet appareil (déclaré par le client).
  newcomer       boolean     not null default false,
  duration_ms    integer     not null,
  -- blades : lame en orbite, throw : lame lancée, wall : bordure ;
  -- quit : retour au menu en vie ; disconnect : connexion perdue sans
  -- retour ; restart : redémarrage du serveur.
  cause          text        not null
    check (cause in ('blades', 'throw', 'wall', 'quit', 'disconnect', 'restart')),
  killer_kind    text        check (killer_kind in ('player', 'bot')),
  killer_tier    smallint,
  -- Lames en orbite au début de l'échange (pertes des 3 s précédentes
  -- comprises), du tueur et de la victime.
  killer_blades  smallint,
  victim_blades  smallint    not null default 0,
  max_blades     smallint    not null default 0,
  max_tier       smallint    not null default 0,
  score          integer     not null default 0,
  kills          smallint    not null default 0,
  throws         smallint    not null default 0,
  -- Lancers qui ont touché au moins un adversaire (lame ou corps).
  throw_hits     smallint    not null default 0,
  boost_ms       integer     not null default 0,
  -- Période de grâce ou sa rampe encore active à la fin de la vie.
  in_grace       boolean     not null default false,
  -- Population de la room à la fin de la vie.
  humans         smallint    not null default 0,
  bots           smallint    not null default 0
);

create index if not exists life_stats_created_at_idx
  on public.life_stats (created_at desc);

alter table public.life_stats enable row level security;

------------------------------------------------------------------------------
-- Vues d'agrégation (7 derniers jours, parties publiques sauf mention)
------------------------------------------------------------------------------

-- Résumé : les deux questions de référence en une requête.
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
    (select round(100.0 * max(n) / nullif(sum(n), 0), 1) from deaths) as top_death_cause_pct;

-- Répartition des fins de vie par cause.
create or replace view public.life_stats_causes
  with (security_invoker = on) as
  select
    cause,
    count(*) as lives,
    round(100.0 * count(*) / sum(count(*)) over (), 1) as pct,
    round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1) as median_life_s,
    count(*) filter (where killer_kind = 'bot') as by_bots,
    count(*) filter (where life_index = 1) as first_lives
  from public.life_stats
  where created_at > now() - interval '7 days' and not room_private
  group by cause
  order by lives desc;

-- Tendance quotidienne (30 jours), pour suivre l'effet d'un réglage.
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
    round(100.0 * sum(throw_hits) / nullif(sum(throws), 0), 1) as throw_accuracy_pct
  from public.life_stats
  where created_at > now() - interval '30 days' and not room_private
  group by 1
  order by 1 desc;

revoke all on public.life_stats_summary, public.life_stats_causes, public.life_stats_daily
  from anon, authenticated;
