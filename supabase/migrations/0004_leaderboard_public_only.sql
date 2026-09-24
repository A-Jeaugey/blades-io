-- blade.io — classement : parties publiques uniquement.
--
-- Les parties en room privée ne créditent plus de trophées et ne sont plus
-- enregistrées par le serveur de jeu (cf. ArenaRoom.persistMatchIfAuthed).
-- Cette migration retire du classement les lignes privées déjà présentes
-- dans `matches` (room_code non nul), qui pouvaient être farmées sans
-- risque (seul dans sa room, densité de loot ×2,5).
--
-- Les lignes restent dans `matches` (historique), seule la vue les ignore.
-- Mêmes colonnes et même ordre que la vue d'origine (0001_init.sql) :
-- `create or replace view` l'exige.

create or replace view public.leaderboard_top as
  with best as (
    select
      m.user_id,
      max(m.score) as best_score,
      max(m.kills) as best_kills,
      max(m.max_blades) as best_max_blades,
      max(m.survival_seconds) as best_survival,
      count(*) as games_played
    from public.matches m
    where m.room_code is null
    group by m.user_id
  )
  select
    p.id            as user_id,
    p.username      as username,
    b.best_score    as score,
    b.best_kills    as kills,
    b.best_max_blades as max_blades,
    b.best_survival as survival_seconds,
    b.games_played  as games_played
  from best b
  join public.profiles p on p.id = b.user_id
  order by b.best_score desc;
