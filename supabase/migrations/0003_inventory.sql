-- blade.io — boutique : inventaire d'items achetés + RPC d'achat atomique.
--
-- inventory       : (user_id, item_id) — un user possède un set d'items.
--                   Item_id = chaîne libre (ex: "sanctuaire", "forge-vermeille",
--                   plus tard les skins/épées). Pas d'enum côté DB pour
--                   pouvoir ajouter des items sans migration.
--
-- purchase_item   : RPC atomique appelée par le serveur quand l'user clique
--                   ACHETER. Vérifie le solde, débite, ajoute à l'inventaire,
--                   le tout dans une transaction. Returns { ok, error?, new_balance }.
--                   Idempotent : si déjà owned, retourne { ok: false,
--                   error: 'already_owned' } sans toucher au wallet.

------------------------------------------------------------------------------
-- inventory
------------------------------------------------------------------------------

create table if not exists public.inventory (
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index if not exists inventory_user_idx on public.inventory (user_id);

alter table public.inventory enable row level security;

drop policy if exists "inventory_select_self" on public.inventory;

-- Lecture limitée au propriétaire. Écritures via service_role uniquement
-- (le client ne peut pas forger un item dans son inventaire).
create policy "inventory_select_self"
  on public.inventory for select
  using (auth.uid() = user_id);

------------------------------------------------------------------------------
-- purchase_item : achat atomique
--
-- Returns jsonb :
--   - { ok: true,  new_balance }                                   → succès
--   - { ok: false, error: 'invalid_price' }                        → prix < 0
--   - { ok: false, error: 'no_wallet' }                            → wallet absent
--   - { ok: false, error: 'already_owned', new_balance }           → déjà possédé
--   - { ok: false, error: 'insufficient_funds', new_balance }      → solde insuffisant
--
-- Verrou FOR UPDATE sur la ligne wallets pour éviter les doubles-spend
-- en cas de double-clic réseau (deux requêtes simultanées qui débitent
-- chacune le solde brut sans attendre l'autre).
------------------------------------------------------------------------------

create or replace function public.purchase_item(
  p_user_id uuid,
  p_item_id text,
  p_price   bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance bigint;
  already_owned   boolean;
  new_balance     bigint;
begin
  if p_price is null or p_price < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_price');
  end if;

  if p_item_id is null or length(p_item_id) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_item');
  end if;

  -- Idempotency : déjà possédé ? Pas de débit, on retourne owned.
  select exists(
    select 1 from public.inventory
    where user_id = p_user_id and item_id = p_item_id
  ) into already_owned;

  if already_owned then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_owned',
      'new_balance', coalesce(
        (select balance from public.wallets where user_id = p_user_id),
        0
      )
    );
  end if;

  -- Verrouille le wallet pour éviter le double-spend en cas de requêtes
  -- concurrentes.
  select balance into current_balance
    from public.wallets
    where user_id = p_user_id
    for update;

  if current_balance is null then
    return jsonb_build_object('ok', false, 'error', 'no_wallet');
  end if;

  if current_balance < p_price then
    return jsonb_build_object(
      'ok', false,
      'error', 'insufficient_funds',
      'new_balance', current_balance
    );
  end if;

  -- Débite + ajoute à l'inventaire dans la même transaction.
  update public.wallets
    set balance    = balance - p_price,
        updated_at = now()
    where user_id = p_user_id
    returning balance into new_balance;

  insert into public.inventory (user_id, item_id)
    values (p_user_id, p_item_id);

  return jsonb_build_object(
    'ok', true,
    'new_balance', new_balance
  );
end;
$$;

revoke all on function public.purchase_item(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.purchase_item(uuid, text, bigint) to service_role;
