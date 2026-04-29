-- blade.io — initial schema
--
-- profiles : 1-to-1 with auth.users, holds the public-facing username
-- matches  : one row per finished game (death or quit) for an authed user
-- view leaderboard_top : best score per user, joined with profile, top 100
--
-- RLS:
--   profiles : SELECT public, INSERT/UPDATE only by the owner
--   matches  : SELECT public (so the leaderboard is queryable from the client),
--              INSERT only via the service role (the game server). Clients
--              cannot forge scores.
--
-- The Colyseus server holds the SUPABASE_SERVICE_ROLE_KEY and is the only
-- writer for the matches table.

create extension if not exists "uuid-ossp";

------------------------------------------------------------------------------
-- profiles
------------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_.\-]{3,16}$')
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_public"  on public.profiles;
drop policy if exists "profiles_insert_self"    on public.profiles;
drop policy if exists "profiles_update_self"    on public.profiles;

create policy "profiles_select_public"
  on public.profiles for select
  using (true);

create policy "profiles_insert_self"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_self"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

------------------------------------------------------------------------------
-- matches
------------------------------------------------------------------------------

create table if not exists public.matches (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  score                 integer not null check (score >= 0),
  kills                 integer not null default 0 check (kills >= 0),
  max_blades            integer not null default 0 check (max_blades >= 0),
  survival_seconds      integer not null default 0 check (survival_seconds >= 0),
  crates_destroyed      integer not null default 0 check (crates_destroyed >= 0),
  powerups_collected    integer not null default 0 check (powerups_collected >= 0),
  room_code             text,
  created_at            timestamptz not null default now()
);

create index if not exists matches_user_id_idx on public.matches (user_id);
create index if not exists matches_score_idx   on public.matches (score desc);
create index if not exists matches_created_idx on public.matches (created_at desc);

alter table public.matches enable row level security;

drop policy if exists "matches_select_public" on public.matches;
drop policy if exists "matches_insert_none"   on public.matches;

-- Anyone (anon, authed) can read matches — needed to render the all-time
-- leaderboard from the client.
create policy "matches_select_public"
  on public.matches for select
  using (true);

-- No INSERT/UPDATE/DELETE policy = no row writes from anon or authed tokens.
-- Only the service role bypasses RLS, which the game server uses.

------------------------------------------------------------------------------
-- leaderboard view : best score per user, joined with profile
------------------------------------------------------------------------------

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

------------------------------------------------------------------------------
-- profile auto-create on signup
--
-- When auth.users gets a new row, we try to seed a profile row using either
-- the username sent by the client at signup (raw_user_meta_data->>'username')
-- or, for OAuth signups, a sanitized version of the provider full_name /
-- email-local-part. The profile row is only inserted if the candidate
-- username passes the format constraint AND is not already taken — otherwise
-- the user has to choose one explicitly via the client (POST /api/profile).
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
  if candidate is null then
    return new;
  end if;

  -- Strip any character not allowed by the format constraint, clamp length.
  candidate := regexp_replace(candidate, '[^A-Za-z0-9_.\-]', '', 'g');
  if length(candidate) < 3 then
    return new;
  end if;
  if length(candidate) > 16 then
    candidate := substr(candidate, 1, 16);
  end if;

  -- Fail silently on unique-violation : the user will pick a username later.
  begin
    insert into public.profiles (id, username) values (new.id, candidate);
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();
