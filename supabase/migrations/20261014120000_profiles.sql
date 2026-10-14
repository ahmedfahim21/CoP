-- Trainer profiles, the trophy ladder and match history.
--
-- Only the game server touches this data, through the cop_* functions below called with
-- the project's secret key (supabase-js .rpc). Row level security is on with no policies
-- and the functions are not executable by anon/authenticated, so the publishable key can
-- read or change nothing here, credential hashes included.
--
-- Columns are camelCase to match the game's JSON; they are quoted everywhere.

create table if not exists profiles (
  "id" text primary key,
  "secretHash" text not null,
  "name" text not null,
  "trophies" integer not null,
  "bestTrophies" integer not null,
  "wins" integer not null default 0,
  "losses" integer not null default 0,
  "draws" integer not null default 0,
  "threeCrowns" integer not null default 0,
  "streak" integer not null default 0,
  "bestStreak" integer not null default 0,
  "battles" integer not null default 0,
  "deck" jsonb not null,
  "starters" jsonb not null,
  "createdAt" timestamptz not null default now(),
  "lastSeen" timestamptz not null default now()
);

-- The ladder only lists players who have played ranked.
create index if not exists profiles_ladder on profiles ("trophies" desc, "wins" desc, "createdAt" asc, "id" asc)
  where "wins" + "losses" + "draws" > 0;

create table if not exists matches (
  "id" integer generated always as identity primary key,
  "playedAt" timestamptz not null default now(),
  "mode" text not null,
  "winner" smallint,
  "reason" text not null
);

create table if not exists match_players (
  "matchId" integer not null references matches ("id") on delete cascade,
  "team" smallint not null,
  "profileId" text references profiles ("id") on delete set null,
  "name" text not null,
  "trophiesBefore" integer not null,
  "delta" integer not null,
  "crowns" smallint not null,
  primary key ("matchId", "team")
);

create index if not exists match_players_profile on match_players ("profileId", "matchId" desc);

alter table profiles enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;

-- ------------------------------------------------------------------ helpers

create or replace function cop_ms(t timestamptz) returns double precision
language sql immutable as $$ select extract(epoch from t) * 1000 $$;

-- 1-based ladder position: trophies, then wins, then who got there first.
create or replace function cop_rank(p profiles) returns integer
language sql stable as $$
  select case when p."wins" + p."losses" + p."draws" = 0 then null else 1 + (
    select count(*)::int from profiles o
    where o."wins" + o."losses" + o."draws" > 0 and (
      o."trophies" > p."trophies"
      or (o."trophies" = p."trophies" and o."wins" > p."wins")
      or (o."trophies" = p."trophies" and o."wins" = p."wins" and o."createdAt" < p."createdAt")
      or (o."trophies" = p."trophies" and o."wins" = p."wins" and o."createdAt" = p."createdAt" and o."id" < p."id")
    )
  ) end
$$;

-- A profile as the game's JSON (OwnProfile plus secretHash, which the server strips).
create or replace function cop_json(p profiles) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p."id", 'name', p."name", 'createdAt', cop_ms(p."createdAt"), 'rank', cop_rank(p),
    'trophies', p."trophies", 'bestTrophies', p."bestTrophies", 'wins', p."wins", 'losses', p."losses",
    'draws', p."draws", 'threeCrowns', p."threeCrowns", 'streak', p."streak", 'bestStreak', p."bestStreak",
    'battles', p."battles", 'deck', p."deck", 'starters', p."starters", 'secretHash', p."secretHash"
  )
$$;

-- ------------------------------------------------------------------ api

create or replace function cop_create_profile(p_id text, p_secret_hash text, p_name text, p_trophies integer, p_deck jsonb, p_starters jsonb, p_now double precision)
returns jsonb language plpgsql as $$
declare prof profiles;
begin
  insert into profiles ("id", "secretHash", "name", "trophies", "bestTrophies", "deck", "starters", "createdAt", "lastSeen")
  values (p_id, p_secret_hash, p_name, p_trophies, p_trophies, p_deck, p_starters, to_timestamp(p_now / 1000), to_timestamp(p_now / 1000))
  returning * into prof;
  return cop_json(prof);
end $$;

create or replace function cop_get_profile(p_id text) returns jsonb
language sql stable as $$ select cop_json(p) from profiles p where p."id" = p_id $$;

create or replace function cop_touch(p_id text, p_now double precision) returns void
language sql as $$ update profiles set "lastSeen" = to_timestamp(p_now / 1000) where "id" = p_id $$;

-- Null arguments leave a field as it is; the server validates the rest.
create or replace function cop_update_profile(p_id text, p_name text, p_deck jsonb, p_starters jsonb) returns jsonb
language plpgsql as $$
declare prof profiles;
begin
  update profiles set
    "name" = coalesce(p_name, "name"),
    "deck" = coalesce(p_deck, "deck"),
    "starters" = coalesce(p_starters, "starters")
  where "id" = p_id
  returning * into prof;
  return case when prof."id" is null then null else cop_json(prof) end;
end $$;

-- Stores a finished battle. `p_sides` is two objects (team 0, team 1):
--   { profileId, name, crowns, trophiesBefore, delta }
-- For a rated battle the server computed `delta` from `trophiesBefore`; both profiles are
-- locked here and if either has moved since, the call fails with 'stale_trophies' and the
-- server recomputes and retries. That keeps the trophy formula in one place (TypeScript)
-- and the write atomic.
create or replace function cop_record_match(p_mode text, p_winner integer, p_reason text, p_rated boolean, p_sides jsonb, p_now double precision)
returns integer language plpgsql as $$
declare
  match_id integer;
  team integer;
  side jsonb;
  pid text;
  prof profiles;
  outcome text;
  new_trophies integer;
  new_streak integer;
begin
  -- Lock in a fixed order so two results for the same pair can't deadlock.
  perform 1 from profiles where "id" in (p_sides -> 0 ->> 'profileId', p_sides -> 1 ->> 'profileId') order by "id" for update;

  insert into matches ("playedAt", "mode", "winner", "reason") values (to_timestamp(p_now / 1000), p_mode, p_winner, p_reason)
  returning "id" into match_id;

  for team in 0..1 loop
    side := p_sides -> team;
    pid := side ->> 'profileId';
    prof := null;
    if pid is not null then
      select * into prof from profiles where "id" = pid;
    end if;
    insert into match_players ("matchId", "team", "profileId", "name", "trophiesBefore", "delta", "crowns")
    values (match_id, team, prof."id", side ->> 'name', (side ->> 'trophiesBefore')::int, (side ->> 'delta')::int, (side ->> 'crowns')::int);
    continue when prof."id" is null;

    if not p_rated then
      update profiles set "battles" = "battles" + 1 where "id" = prof."id";
      continue;
    end if;

    if prof."trophies" <> (side ->> 'trophiesBefore')::int then
      raise exception 'stale_trophies' using errcode = 'P0001';
    end if;
    outcome := case when p_winner is null then 'draw' when p_winner = team then 'win' else 'loss' end;
    new_trophies := prof."trophies" + (side ->> 'delta')::int;
    new_streak := case when outcome = 'win' then prof."streak" + 1 else 0 end;
    update profiles set
      "trophies" = new_trophies,
      "bestTrophies" = greatest("bestTrophies", new_trophies),
      "wins" = "wins" + (outcome = 'win')::int,
      "losses" = "losses" + (outcome = 'loss')::int,
      "draws" = "draws" + (outcome = 'draw')::int,
      "threeCrowns" = "threeCrowns" + (outcome = 'win' and (side ->> 'crowns')::int = 3)::int,
      "streak" = new_streak,
      "bestStreak" = greatest("bestStreak", new_streak),
      "battles" = "battles" + 1
    where "id" = prof."id";
  end loop;
  return match_id;
end $$;

-- Most recent battles first, from `p_id`'s side.
create or replace function cop_recent_matches(p_id text, p_limit integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.mid desc), '[]'::jsonb) from (
    select me."matchId" as mid, jsonb_build_object(
      'id', m."id", 'playedAt', cop_ms(m."playedAt"), 'mode', m."mode",
      'outcome', case when m."winner" is null then 'draw' when m."winner" = me."team" then 'win' else 'loss' end,
      'reason', m."reason", 'crowns', me."crowns", 'opponentCrowns', opp."crowns", 'delta', me."delta",
      'opponent', jsonb_build_object('id', opp."profileId", 'name', opp."name", 'trophies', opp."trophiesBefore")
    ) as j
    from match_players me
    join matches m on m."id" = me."matchId"
    join match_players opp on opp."matchId" = me."matchId" and opp."team" <> me."team"
    where me."profileId" = p_id
    order by me."matchId" desc
    limit p_limit
  ) x
$$;

create or replace function cop_leaderboard(p_limit integer, p_offset integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('rank', n, 'id', "id", 'name', "name", 'trophies', "trophies", 'wins', "wins", 'losses', "losses") order by n)
      from (
        select *, row_number() over (order by "trophies" desc, "wins" desc, "createdAt" asc, "id" asc)::int as n
        from profiles where "wins" + "losses" + "draws" > 0
        order by "trophies" desc, "wins" desc, "createdAt" asc, "id" asc
        limit p_limit offset p_offset
      ) ranked
    ), '[]'::jsonb),
    'total', (select count(*)::int from profiles where "wins" + "losses" + "draws" > 0)
  )
$$;

-- Only the server's secret key may call these (Supabase grants new functions to everyone).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'cop\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
