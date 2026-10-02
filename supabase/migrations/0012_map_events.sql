-- blade.io — évènements de carte (tâche 4.4 du plan).
--
-- Une ligne par évènement fini (pluie de lames, caisse légendaire, zone
-- dorée), écrite par le serveur de jeu (service role, cf.
-- server/src/telemetry.ts) : combien de joueurs étaient là pendant
-- l'évènement, combien sont venus jusqu'à sa zone (ou à 12 u de la
-- caisse). Critère de la tâche : une part mesurable des joueurs converge
-- vers chaque évènement.
--
-- RLS activée sans aucune policy, comme life_stats : on l'interroge depuis
-- l'éditeur SQL du dashboard.
--
-- Question de référence :
--   select * from public.map_events_summary;

create table if not exists public.map_events (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  room_private    boolean     not null,
  game_mode       text        not null default 'ffa',
  kind            text        not null check (kind in ('rain', 'crate', 'golden')),
  -- De l'annonce à la fin (caisse : jusqu'à sa destruction).
  duration_ms     integer     not null,
  -- Joueurs en vie à un moment de l'évènement, et ceux venus jusqu'à lui.
  humans          smallint    not null default 0,
  humans_reached  smallint    not null default 0,
  bots            smallint    not null default 0,
  bots_reached    smallint    not null default 0
);

create index if not exists map_events_created_at_idx
  on public.map_events (created_at desc);

alter table public.map_events enable row level security;

-- Par type d'évènement, 7 derniers jours, parties publiques : nombre,
-- durée médiane, part des joueurs humains (et des bots) venus jusqu'à lui.
create or replace view public.map_events_summary
  with (security_invoker = on) as
  select
    kind,
    count(*) as events,
    round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1) as median_duration_s,
    sum(humans) as humans,
    round(100.0 * sum(humans_reached) / nullif(sum(humans), 0), 1) as humans_reached_pct,
    round(100.0 * sum(bots_reached) / nullif(sum(bots), 0), 1) as bots_reached_pct
  from public.map_events
  where created_at > now() - interval '7 days' and not room_private
  group by kind
  order by kind;

revoke all on public.map_events_summary from anon, authenticated;
