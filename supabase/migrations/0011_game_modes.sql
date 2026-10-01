-- blade.io — modes de jeu (tâche 7.3 du plan).
--
-- Le mode de chaque partie enregistrée : 'ffa', l'arène sans fin, le seul
-- jusqu'ici ; les manches chronométrées (7.1) et les modes équipe (7.2)
-- suivent. Le serveur n'écrit la colonne que pour les autres modes : sans
-- cette migration, l'arène continue d'enregistrer ses parties et sa
-- télémétrie.
--
-- Question de référence (décision D5 : garder ou non les manches en public,
-- d'après la télémétrie) :
--   select * from public.life_stats_by_mode;

alter table public.matches
  add column if not exists game_mode text not null default 'ffa';

alter table public.life_stats
  add column if not exists game_mode text not null default 'ffa';

-- Nouvelle fin de vie : la partie d'un mode à fin se termine, la vie en
-- cours est enregistrée avec son score.
alter table public.life_stats drop constraint if exists life_stats_cause_check;
alter table public.life_stats add constraint life_stats_cause_check
  check (cause in ('blades', 'throw', 'wall', 'quit', 'disconnect', 'restart', 'match_end'));

-- Les modes côte à côte, 7 derniers jours, parties publiques : volume,
-- joueurs connectés distincts (les invités n'ont pas d'identifiant), durée
-- des vies, combats, départs en pleine vie.
create or replace view public.life_stats_by_mode
  with (security_invoker = on) as
  select
    game_mode,
    count(*) as lives,
    count(distinct user_id) as signed_in_players,
    round((percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric, 1) as median_life_s,
    round(avg(kills), 2) as avg_kills,
    round(avg(score), 1) as avg_score,
    round(100.0 * avg((cause = 'quit')::int), 1) as quit_pct
  from public.life_stats
  where created_at > now() - interval '7 days' and not room_private
  group by game_mode
  order by lives desc;

revoke all on public.life_stats_by_mode from anon, authenticated;
