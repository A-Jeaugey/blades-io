-- blade.io — agents (docs/AGENTS.md).
--
-- L'agent de chaque vie enregistrée. Le serveur écrit la colonne ; tant
-- que cette migration n'est pas appliquée, il réécrit la ligne sans elle
-- (server/src/telemetry.ts) : la télémétrie continue de s'écrire.
--
-- Question de référence (équilibrage des agents sur des parties réelles) :
--   select * from public.life_stats_by_agent;

alter table public.life_stats
  add column if not exists agent text;

-- Les agents côte à côte, 7 derniers jours, parties publiques : volume,
-- durée des vies, éliminations, score, pic de lames, part des vies finies
-- avant 30 s.
create or replace view public.life_stats_by_agent
  with (security_invoker = on) as
  select
    agent,
    count(*) as lives,
    round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1) as median_life_s,
    round(avg(kills), 2) as avg_kills,
    round(avg(score), 1) as avg_score,
    round(avg(max_blades), 1) as avg_max_blades,
    round(100.0 * avg((duration_ms < 30000 and cause in ('blades', 'throw', 'wall'))::int), 1) as early_death_pct
  from public.life_stats
  where created_at > now() - interval '7 days' and not room_private and agent is not null
  group by agent
  order by lives desc;

revoke all on public.life_stats_by_agent from anon, authenticated;
