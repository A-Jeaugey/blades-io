-- blade.io — chute de processeurs (retours du owner du 2026-10-12, suite de
-- la tâche 4.4 du plan).
--
-- Nouvel évènement de carte : la colonne kind de map_events accepte
-- 'processors'. Le coffre-fort, qui remplace la caisse légendaire, garde
-- 'crate' : les lignes d'avant restent comparables. La vue
-- map_events_summary groupe par kind sans filtrer : rien à y changer.
--
-- Sans cette migration, le serveur continue de jouer et d'enregistrer les
-- autres évènements ; seules les lignes 'processors' sont refusées par la
-- contrainte (un avertissement par minute au plus dans les journaux).
--
-- Question de référence :
--   select * from public.map_events_summary;

alter table public.map_events drop constraint if exists map_events_kind_check;
alter table public.map_events add constraint map_events_kind_check
  check (kind in ('rain', 'crate', 'golden', 'processors'));
