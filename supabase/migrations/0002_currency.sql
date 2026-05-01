-- blade.io — currency & multi-leaderboards
--
-- Adds:
--   wallets               : per-user persistent coin balance + lifetime earnings.
--   wallet_transactions   : append-only ledger for every credit/debit.
--   credit_wallet()       : RPC the game server calls to atomically grant
--                           match rewards or claim guest coins.
--   spend_wallet()        : RPC for future shop/transaction features (skins,
--                           cosmetics) — refuses if balance would go negative.
--   leaderboard_top_score : renamed/aliased view for the existing best-score
--                           ranking (kept backwards-compatible via a view).
--   leaderboard_top_coins : top players by lifetime earnings (total_earned).
--
-- Score → coins conversion happens server-side in matches.ts: 1 point = 1 coin.
-- The existing matches table already records `score`; the credit is performed
-- in the same transaction-style flow (best effort, see server code).

------------------------------------------------------------------------------
-- wallets
------------------------------------------------------------------------------

create table if not exists public.wallets (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  balance       bigint not null default 0 check (balance >= 0),
  total_earned  bigint not null default 0 check (total_earned >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists wallets_total_earned_idx on public.wallets (total_earned desc);

alter table public.wallets enable row level security;

drop policy if exists "wallets_select_public" on public.wallets;
drop policy if exists "wallets_select_self"   on public.wallets;

-- Public read so clients can render the "richest players" leaderboard
-- without needing a session. Writes are service-role only.
create policy "wallets_select_public"
  on public.wallets for select
  using (true);

------------------------------------------------------------------------------
-- wallet_transactions (ledger)
------------------------------------------------------------------------------

create table if not exists public.wallet_transactions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  delta           bigint not null,        -- + earned, - spent
  kind            text not null,          -- match_reward | guest_claim | purchase | grant | refund
  ref_id          text,                   -- match_id, sku, ...
  balance_after   bigint not null check (balance_after >= 0),
  created_at      timestamptz not null default now()
);

create index if not exists wallet_tx_user_idx on public.wallet_transactions (user_id, created_at desc);
create index if not exists wallet_tx_kind_idx on public.wallet_transactions (kind);

alter table public.wallet_transactions enable row level security;

drop policy if exists "wallet_tx_select_self" on public.wallet_transactions;

-- Only the owner can read their own ledger. Write is service-role only.
create policy "wallet_tx_select_self"
  on public.wallet_transactions for select
  using (auth.uid() = user_id);

------------------------------------------------------------------------------
-- RPC: credit_wallet(user_id, amount, kind, ref_id) -> bigint (new balance)
--
-- Atomic upsert + ledger entry. Refuses negative or zero amounts (use
-- spend_wallet for debits).
------------------------------------------------------------------------------

create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount  bigint,
  p_kind    text,
  p_ref_id  text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit_wallet: amount must be > 0 (got %)', p_amount;
  end if;

  insert into public.wallets (user_id, balance, total_earned, updated_at)
    values (p_user_id, p_amount, p_amount, now())
  on conflict (user_id) do update
    set balance      = public.wallets.balance + excluded.balance,
        total_earned = public.wallets.total_earned + excluded.total_earned,
        updated_at   = now()
  returning balance into new_balance;

  insert into public.wallet_transactions (user_id, delta, kind, ref_id, balance_after)
    values (p_user_id, p_amount, p_kind, p_ref_id, new_balance);

  return new_balance;
end;
$$;

revoke all on function public.credit_wallet(uuid, bigint, text, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- RPC: spend_wallet(user_id, amount, kind, ref_id) -> bigint (new balance)
--
-- Atomic debit. Returns -1 if insufficient funds (no row written) — the
-- caller must check and surface the error to the client.
------------------------------------------------------------------------------

create or replace function public.spend_wallet(
  p_user_id uuid,
  p_amount  bigint,
  p_kind    text,
  p_ref_id  text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'spend_wallet: amount must be > 0 (got %)', p_amount;
  end if;

  update public.wallets
     set balance    = balance - p_amount,
         updated_at = now()
   where user_id = p_user_id
     and balance >= p_amount
   returning balance into new_balance;

  if new_balance is null then
    return -1;
  end if;

  insert into public.wallet_transactions (user_id, delta, kind, ref_id, balance_after)
    values (p_user_id, -p_amount, p_kind, p_ref_id, new_balance);

  return new_balance;
end;
$$;

revoke all on function public.spend_wallet(uuid, bigint, text, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- Auto-create a wallet row on signup (extends handle_new_auth_user).
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

  -- Always seed an empty wallet so the rest of the app can assume the row exists.
  insert into public.wallets (user_id) values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill wallets for users that pre-date this migration.
insert into public.wallets (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;

------------------------------------------------------------------------------
-- Leaderboards : two named views.
--   leaderboard_top_score : best single-match score, joined to profile.
--                          Identical to the legacy leaderboard_top.
--   leaderboard_top_coins : top earners by lifetime total_earned.
------------------------------------------------------------------------------

create or replace view public.leaderboard_top_score as
  with best as (
    select
      m.user_id,
      max(m.score)            as best_score,
      max(m.kills)            as best_kills,
      max(m.max_blades)       as best_max_blades,
      max(m.survival_seconds) as best_survival,
      count(*)                as games_played
    from public.matches m
    group by m.user_id
  )
  select
    p.id              as user_id,
    p.username        as username,
    b.best_score      as score,
    b.best_kills      as kills,
    b.best_max_blades as max_blades,
    b.best_survival   as survival_seconds,
    b.games_played    as games_played
  from best b
  join public.profiles p on p.id = b.user_id
  order by b.best_score desc;

-- Keep the original name as an alias for any client still pointing at it.
create or replace view public.leaderboard_top as
  select * from public.leaderboard_top_score;

create or replace view public.leaderboard_top_coins as
  select
    p.id           as user_id,
    p.username     as username,
    w.balance      as balance,
    w.total_earned as total_earned,
    w.updated_at   as updated_at
  from public.wallets w
  join public.profiles p on p.id = w.user_id
  where w.total_earned > 0
  order by w.total_earned desc;
