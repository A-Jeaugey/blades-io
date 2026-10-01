-- blade.io — signalements de joueurs (tâche 5.6 du plan).
--
-- Un joueur en signale un autre depuis le chat (/report <pseudo> [motif]).
-- Le serveur de jeu écrit la ligne (service role) avec les derniers
-- messages du joueur visé, texte d'origine (le chat, lui, les masque). Les
-- clients n'y ont aucun accès : lecture depuis l'éditeur SQL.
--
--   select * from reports order by created_at desc limit 50;
--   select * from reports_by_target;

create table if not exists public.reports (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  room_id           text not null,
  room_private      boolean not null default false,
  reporter_name     text not null,
  reporter_user_id  uuid references auth.users(id) on delete set null,
  reporter_guest_id uuid,
  target_name       text not null,
  target_user_id    uuid references auth.users(id) on delete set null,
  target_guest_id   uuid,
  reason            text check (reason is null or char_length(reason) <= 200),
  recent_messages   jsonb not null default '[]'::jsonb
);

create index if not exists reports_created_idx on public.reports (created_at desc);
create index if not exists reports_target_user_idx on public.reports (target_user_id, created_at desc)
  where target_user_id is not null;

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- Joueurs les plus signalés sur 30 jours, par compte (ou par portefeuille
-- invité, sinon par pseudo), avec le nombre de joueurs distincts qui les
-- ont signalés : un seul plaignant acharné pèse moins que dix.
create or replace view public.reports_by_target
with (security_invoker = true) as
select
  coalesce(target_user_id::text, target_guest_id::text, 'name:' || target_name) as target,
  max(target_name)                                                              as last_name,
  count(*)                                                                      as reports,
  count(distinct coalesce(reporter_user_id::text, reporter_guest_id::text, reporter_name)) as reporters,
  max(created_at)                                                               as last_report
from public.reports
where created_at > now() - interval '30 days'
group by 1
order by reporters desc, reports desc;

revoke all on public.reports_by_target from anon, authenticated;
