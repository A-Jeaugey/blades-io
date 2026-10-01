-- blade.io — défis quotidiens et hebdomadaires (tâche 5.3 du plan).
--
-- Progression par joueur (compte ou portefeuille invité), par période
-- (« 2026-10-01 » pour un jour, « 2026-W40 » pour une semaine, heure de
-- Paris) et par défi. Le catalogue et le tirage vivent dans
-- shared/src/challenges.ts : le serveur de jeu envoie, à chaque fin de vie
-- en room publique, ce que la vie apporte aux défis en cours.
--
-- RLS activée sans policy : ni lecture ni écriture depuis les clients ; le
-- serveur passe par le service role (GET /api/challenges et la fonction
-- advance_challenges ci-dessous).

create table if not exists public.challenge_progress (
  owner_id     uuid not null,
  owner_kind   text not null check (owner_kind in ('user', 'guest')),
  period       text not null,
  challenge    text not null,
  progress     integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (owner_id, period, challenge)
);

alter table public.challenge_progress enable row level security;

------------------------------------------------------------------------------
-- advance_challenges : fait avancer les défis d'un joueur et crédite, dans la
-- même transaction, ceux qui viennent d'être réussis (une seule fois : le
-- passage à completed_at est le verrou). p_items : tableau de
--   { period, challenge, value, mode ('add' | 'max'), target, reward }.
-- Renvoie les défis réussis par cet appel : [{ challenge, reward }].
------------------------------------------------------------------------------

create or replace function public.advance_challenges(
  p_owner uuid,
  p_kind  text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item       jsonb;
  v_target   integer;
  v_value    integer;
  v_progress integer;
  done       jsonb := '[]'::jsonb;
begin
  if p_kind not in ('user', 'guest') then
    raise exception 'invalid owner kind %', p_kind;
  end if;
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_target := greatest(1, (item->>'target')::integer);
    v_value := greatest(0, (item->>'value')::integer);
    if v_value = 0 then
      continue;
    end if;
    insert into public.challenge_progress as cp (owner_id, owner_kind, period, challenge, progress)
      values (p_owner, p_kind, item->>'period', item->>'challenge', least(v_value, v_target))
    on conflict (owner_id, period, challenge) do update
      set progress = least(v_target,
            case when item->>'mode' = 'max' then greatest(cp.progress, excluded.progress)
                 else cp.progress + excluded.progress end),
          updated_at = now()
    returning progress into v_progress;
    if v_progress >= v_target then
      update public.challenge_progress
         set completed_at = now()
       where owner_id = p_owner
         and period = item->>'period'
         and challenge = item->>'challenge'
         and completed_at is null;
      if found then
        if p_kind = 'user' then
          perform public.credit_wallet(p_owner, (item->>'reward')::bigint);
        else
          perform public.credit_guest_wallet(p_owner, (item->>'reward')::bigint);
        end if;
        done := done || jsonb_build_object('challenge', item->>'challenge', 'reward', (item->>'reward')::integer);
      end if;
    end if;
  end loop;
  -- Ménage : les périodes de plus de 60 jours de ce joueur ne servent plus.
  delete from public.challenge_progress
   where owner_id = p_owner and updated_at < now() - interval '60 days';
  return done;
end;
$$;

revoke all on function public.advance_challenges(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.advance_challenges(uuid, text, jsonb) to service_role;
