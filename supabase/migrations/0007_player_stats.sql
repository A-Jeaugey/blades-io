-- blade.io — profil joueur (tâche 5.1 du plan).
--
-- Statistiques cumulées d'un compte, tirées de `matches` : une ligne par vie
-- en room publique (les lignes privées d'avant la tâche 0.2 sont écartées,
-- comme au classement). Le serveur de jeu les lit en service role pour
-- GET /api/profile/stats ; la vue applique les droits de l'appelant
-- (security_invoker) et son accès est retiré à anon et authenticated.

-- Dernières parties d'un joueur (et, plus tard, classements temporaires).
create index if not exists matches_user_created_idx
  on public.matches (user_id, created_at desc);

create or replace view public.player_stats
  with (security_invoker = true) as
  select
    m.user_id,
    count(*)::bigint                              as games,
    coalesce(sum(m.kills), 0)::bigint             as kills,
    coalesce(max(m.score), 0)                     as best_score,
    coalesce(max(m.kills), 0)                     as best_kills,
    coalesce(max(m.max_blades), 0)                as best_blades,
    coalesce(sum(m.survival_seconds), 0)::bigint  as survival_seconds,
    coalesce(max(m.survival_seconds), 0)          as best_survival_seconds,
    coalesce(sum(m.crates_destroyed), 0)::bigint  as crates,
    coalesce(sum(m.powerups_collected), 0)::bigint as powerups,
    min(m.created_at)                             as first_played_at
  from public.matches m
  where m.room_code is null
  group by m.user_id;

revoke all on public.player_stats from anon, authenticated;
