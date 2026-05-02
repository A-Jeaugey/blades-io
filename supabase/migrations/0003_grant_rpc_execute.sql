-- blade.io — fix RPC EXECUTE permissions
--
-- 0002 did `revoke all on function ... from public, anon, authenticated`
-- which is the right idea (no client should call these directly), but in
-- combination with the default `grant execute to public` Postgres applies
-- on `create function`, the cumulative effect can leave service_role
-- without EXECUTE rights depending on the order things were applied.
--
-- service_role bypasses RLS but still needs EXECUTE on functions. We grant
-- it here explicitly so the game server (which uses the service role key)
-- can call credit_wallet / spend_wallet.

grant execute on function public.credit_wallet(uuid, bigint, text, text) to service_role;
grant execute on function public.spend_wallet(uuid, bigint, text, text) to service_role;

-- Make sure the views are also reachable by service_role (they should be
-- by default, but in some Supabase projects RLS-on-views or revoke flows
-- can affect them).
grant select on public.wallets             to service_role;
grant select on public.wallet_transactions to service_role;
grant select on public.leaderboard_top_score to service_role, anon, authenticated;
grant select on public.leaderboard_top_coins to service_role, anon, authenticated;
