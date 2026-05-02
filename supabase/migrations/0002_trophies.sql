-- blade.io — trophées : wallet persistant + transfert depuis le mode invité.
--
-- wallets             : un solde par utilisateur authentifié + total cumulé,
--                       service-role only en écriture, RLS lecture pour le
--                       propriétaire (l'API dédiée passe quand même par le
--                       service role pour exposer balance/total au client).
-- guest_wallets       : un solde temporaire par guest_id signé HMAC. Une
--                       fois claimed_by != null la ligne est inerte.
-- credit_wallet       : RPC atomique appelé par le serveur de jeu à la mort
--                       d'un user authentifié.
-- credit_guest_wallet : symétrique pour les guests, refuse le credit si
--                       déjà claimed (évite tout credit fantôme post-claim).
-- claim_guest_wallet  : transfère atomiquement guest_wallets.balance vers
--                       wallets pour un user, marque claimed_by/_at.
--
-- Étend handle_new_auth_user pour seed un wallet à l'inscription, et
-- backfill les users existants.

------------------------------------------------------------------------------
-- wallets (authed users)
------------------------------------------------------------------------------

create table if not exists public.wallets (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  balance      bigint not null default 0 check (balance >= 0),
  total_earned bigint not null default 0 check (total_earned >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.wallets enable row level security;

drop policy if exists "wallets_select_self" on public.wallets;

-- Lecture limitée au propriétaire. Les écritures passent par service_role
-- (bypass RLS) pour empêcher le client de forger un balance.
create policy "wallets_select_self"
  on public.wallets for select
  using (auth.uid() = user_id);

------------------------------------------------------------------------------
-- guest_wallets (sessions invitées)
------------------------------------------------------------------------------

create table if not exists public.guest_wallets (
  guest_id    uuid primary key default uuid_generate_v4(),
  balance     bigint not null default 0 check (balance >= 0),
  claimed_by  uuid references auth.users(id) on delete cascade,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists guest_wallets_unclaimed_idx
  on public.guest_wallets (created_at)
  where claimed_by is null;

-- RLS activée sans policy = personne ne lit/écrit en dehors du service_role.
-- Le client ne touche jamais directement guest_wallets, tout passe par les
-- endpoints HTTP signés.
alter table public.guest_wallets enable row level security;

------------------------------------------------------------------------------
-- credit_wallet : credit atomique (insert ou increment) pour un user authed.
------------------------------------------------------------------------------

create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount  bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    return coalesce((select balance from public.wallets where user_id = p_user_id), 0);
  end if;

  insert into public.wallets (user_id, balance, total_earned, updated_at)
    values (p_user_id, p_amount, p_amount, now())
  on conflict (user_id) do update
    set balance      = public.wallets.balance + excluded.balance,
        total_earned = public.wallets.total_earned + excluded.total_earned,
        updated_at   = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;

revoke all on function public.credit_wallet(uuid, bigint) from public, anon, authenticated;
grant execute on function public.credit_wallet(uuid, bigint) to service_role;

------------------------------------------------------------------------------
-- credit_guest_wallet : credit atomique pour un guest. Refuse si claimed.
------------------------------------------------------------------------------

create or replace function public.credit_guest_wallet(
  p_guest_id uuid,
  p_amount   bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
  is_claimed  boolean;
begin
  if p_amount is null or p_amount <= 0 then
    return coalesce((select balance from public.guest_wallets where guest_id = p_guest_id), 0);
  end if;

  select claimed_by is not null into is_claimed
    from public.guest_wallets
    where guest_id = p_guest_id;

  if is_claimed is null then
    -- Le guest_id n'existe pas (token forgé ou ligne supprimée). On
    -- refuse silencieusement plutôt que de créer une ligne ici : la
    -- création doit passer par /api/guest/init pour rester traçable.
    return 0;
  end if;

  if is_claimed then
    return (select balance from public.guest_wallets where guest_id = p_guest_id);
  end if;

  update public.guest_wallets
    set balance    = balance + p_amount,
        updated_at = now()
    where guest_id = p_guest_id
      and claimed_by is null
    returning balance into new_balance;

  return coalesce(new_balance, 0);
end;
$$;

revoke all on function public.credit_guest_wallet(uuid, bigint) from public, anon, authenticated;
grant execute on function public.credit_guest_wallet(uuid, bigint) to service_role;

------------------------------------------------------------------------------
-- claim_guest_wallet : transfère atomiquement guest -> wallet user.
--
-- Idempotent :
--   - guest inexistant            -> { transferred: 0, new_balance: <user> }
--   - déjà claimed par ce user    -> { transferred: 0, new_balance: <user> }
--   - déjà claimed par un autre   -> exception 'guest_already_claimed'
--   - non claimed                 -> transfert + mark claimed
------------------------------------------------------------------------------

create or replace function public.claim_guest_wallet(
  p_user_id  uuid,
  p_guest_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  guest_row public.guest_wallets%rowtype;
  amount    bigint;
  new_bal   bigint;
begin
  select * into guest_row
    from public.guest_wallets
    where guest_id = p_guest_id
    for update;

  if not found then
    return jsonb_build_object(
      'transferred', 0,
      'new_balance', coalesce((select balance from public.wallets where user_id = p_user_id), 0)
    );
  end if;

  if guest_row.claimed_by is not null then
    if guest_row.claimed_by = p_user_id then
      return jsonb_build_object(
        'transferred', 0,
        'new_balance', coalesce((select balance from public.wallets where user_id = p_user_id), 0)
      );
    else
      raise exception 'guest_already_claimed';
    end if;
  end if;

  amount := guest_row.balance;

  if amount > 0 then
    insert into public.wallets (user_id, balance, total_earned, updated_at)
      values (p_user_id, amount, amount, now())
    on conflict (user_id) do update
      set balance      = public.wallets.balance + excluded.balance,
          total_earned = public.wallets.total_earned + excluded.total_earned,
          updated_at   = now()
    returning balance into new_bal;
  else
    new_bal := coalesce((select balance from public.wallets where user_id = p_user_id), 0);
  end if;

  update public.guest_wallets
    set claimed_by = p_user_id,
        claimed_at = now(),
        updated_at = now()
    where guest_id = p_guest_id;

  return jsonb_build_object(
    'transferred', amount,
    'new_balance', new_bal
  );
end;
$$;

revoke all on function public.claim_guest_wallet(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_wallet(uuid, uuid) to service_role;

------------------------------------------------------------------------------
-- handle_new_auth_user : étend la fonction de 0001 pour seed un wallet aussi.
------------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  candidate := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    nullif(new.raw_user_meta_data->>'preferred_username', ''),
    nullif(new.raw_user_meta_data->>'user_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  if candidate is not null then
    candidate := regexp_replace(candidate, '[^A-Za-z0-9_.\-]', '', 'g');
    if length(candidate) >= 3 then
      if length(candidate) > 16 then
        candidate := substr(candidate, 1, 16);
      end if;
      begin
        insert into public.profiles (id, username) values (new.id, candidate);
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  -- Toujours seed une ligne wallet (zéro balance) pour qu'on puisse y
  -- faire des UPDATE/upsert sans avoir à gérer le NULL ailleurs.
  insert into public.wallets (user_id) values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill : crée la ligne wallets manquante pour les users déjà inscrits.
insert into public.wallets (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;
