-- Progression and single-player modes: per-trainer progress (XP, League stars, quests,
-- streaks, bests), score boards for the Daily Challenge and the Gauntlet, ghost battles
-- against real trainers' decks, replays, and monthly ladder seasons.
--
-- The rules for all of it are TypeScript (packages/shared): the server reads progress,
-- applies a battle and writes it back with an optimistic version check.

-- ------------------------------------------------------------------ seasons (tables first: cop_json reads them)

create table if not exists cop_meta (
  "key" text primary key,
  "value" jsonb not null
);
alter table cop_meta enable row level security;

create table if not exists season_results (
  "season" text not null,
  "profileId" text not null references profiles ("id") on delete cascade,
  "trophies" integer not null,
  "rank" integer not null,
  primary key ("season", "profileId")
);
alter table season_results enable row level security;

-- ------------------------------------------------------------------ progress

alter table profiles add column if not exists "progress" jsonb not null default '{}'::jsonb;
alter table profiles add column if not exists "progressVersion" integer not null default 0;

-- Trainers who played before card unlocks existed keep every card.
update profiles set "progress" = jsonb_build_object('legacy', true) where "progress" = '{}'::jsonb;

-- A profile as the game's JSON, now with progress and past seasons.
create or replace function cop_json(p profiles) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p."id", 'name', p."name", 'createdAt', cop_ms(p."createdAt"), 'rank', cop_rank(p),
    'trophies', p."trophies", 'bestTrophies', p."bestTrophies", 'wins', p."wins", 'losses', p."losses",
    'draws', p."draws", 'threeCrowns', p."threeCrowns", 'streak', p."streak", 'bestStreak', p."bestStreak",
    'battles', p."battles", 'deck', p."deck", 'starters', p."starters", 'secretHash', p."secretHash",
    'progress', p."progress", 'progressVersion', p."progressVersion",
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object('season', s."season", 'trophies', s."trophies", 'rank', s."rank") order by s."season" desc)
      from season_results s where s."profileId" = p."id"
    ), '[]'::jsonb)
  )
$$;

-- Writes progress if nobody else has since `p_version`; otherwise 'stale_progress' and the
-- server re-reads and re-applies.
create or replace function cop_save_progress(p_id text, p_progress jsonb, p_version integer) returns jsonb
language plpgsql as $$
declare prof profiles;
begin
  update profiles set "progress" = p_progress, "progressVersion" = "progressVersion" + 1
  where "id" = p_id and "progressVersion" = p_version
  returning * into prof;
  if prof."id" is null then
    if exists (select 1 from profiles where "id" = p_id) then
      raise exception 'stale_progress' using errcode = 'P0001';
    end if;
    return null;
  end if;
  return cop_json(prof);
end $$;

-- ------------------------------------------------------------------ battles

alter table matches add column if not exists "replay" jsonb;

-- Stores a finished battle; each side says what it does to its profile:
--   'rated'  trophies and ladder stats move (delta computed by the server from trophiesBefore,
--            refused with 'stale_trophies' if they moved since),
--   'count'  only the battle count goes up,
--   'none'   nothing (a ghost's owner: the battle shows in their history, nothing else).
-- p_sides: [{ profileId, name, crowns, trophiesBefore, delta, apply }, …] for team 0 and 1.
create or replace function cop_record_battle(p_mode text, p_winner integer, p_reason text, p_sides jsonb, p_replay jsonb, p_now double precision)
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
  perform 1 from profiles where "id" in (p_sides -> 0 ->> 'profileId', p_sides -> 1 ->> 'profileId') order by "id" for update;

  insert into matches ("playedAt", "mode", "winner", "reason", "replay") values (to_timestamp(p_now / 1000), p_mode, p_winner, p_reason, p_replay)
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
    continue when prof."id" is null or side ->> 'apply' = 'none';

    if side ->> 'apply' = 'count' then
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

-- History now says which battles have a replay.
create or replace function cop_recent_matches(p_id text, p_limit integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.mid desc), '[]'::jsonb) from (
    select me."matchId" as mid, jsonb_build_object(
      'id', m."id", 'playedAt', cop_ms(m."playedAt"), 'mode', m."mode",
      'outcome', case when m."winner" is null then 'draw' when m."winner" = me."team" then 'win' else 'loss' end,
      'reason', m."reason", 'crowns', me."crowns", 'opponentCrowns', opp."crowns", 'delta', me."delta",
      'opponent', jsonb_build_object('id', opp."profileId", 'name', opp."name", 'trophies', opp."trophiesBefore"),
      'hasReplay', m."replay" is not null, 'team', me."team"
    ) as j
    from match_players me
    join matches m on m."id" = me."matchId"
    join match_players opp on opp."matchId" = me."matchId" and opp."team" <> me."team"
    where me."profileId" = p_id
    order by me."matchId" desc
    limit p_limit
  ) x
$$;

create or replace function cop_replay(p_match_id integer) returns jsonb
language sql stable as $$
  select case when m."replay" is null then null else jsonb_build_object(
    'id', m."id", 'playedAt', cop_ms(m."playedAt"), 'mode', m."mode", 'winner', m."winner", 'reason', m."reason",
    'replay', m."replay",
    'players', (select jsonb_agg(jsonb_build_object('team', mp."team", 'name', mp."name", 'profileId', mp."profileId", 'crowns', mp."crowns") order by mp."team")
                from match_players mp where mp."matchId" = m."id")
  ) end
  from matches m where m."id" = p_match_id
$$;

-- Ladder entries carry XP so the client can show levels.
create or replace function cop_leaderboard(p_limit integer, p_offset integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', n, 'id', "id", 'name', "name", 'trophies', "trophies", 'wins', "wins", 'losses', "losses",
        'battles', "battles", 'rated', "wins" + "losses" + "draws" > 0,
        'xp', coalesce(("progress" ->> 'xp')::numeric, 0)::int
      ) order by n)
      from (
        select *, row_number() over (order by "trophies" desc, "wins" desc, ("wins" + "losses" + "draws") > 0 desc, "createdAt" asc, "id" asc)::int as n
        from profiles where "battles" > 0
        order by n
        limit p_limit offset p_offset
      ) ranked
    ), '[]'::jsonb),
    'total', (select count(*)::int from profiles where "battles" > 0)
  )
$$;

-- ------------------------------------------------------------------ ghosts

-- Real trainers near `p_trophies` who've played lately, in random order, to be fought as
-- ghosts (the bot plays their deck and towers).
create or replace function cop_ghosts(p_trophies integer, p_window integer, p_exclude text, p_since double precision, p_limit integer) returns jsonb
language sql volatile as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g."id", 'name', g."name", 'trophies', g."trophies", 'deck', g."deck", 'starters', g."starters")), '[]'::jsonb)
  from (
    select * from profiles
    where "id" <> coalesce(p_exclude, '') and "battles" > 0 and "lastSeen" >= to_timestamp(p_since / 1000)
      and abs("trophies" - p_trophies) <= p_window
    order by random()
    limit p_limit
  ) g
$$;

-- ------------------------------------------------------------------ score boards

-- Best score per trainer per board and period: 'daily' by day, 'gauntlet' by season.
create table if not exists scores (
  "board" text not null,
  "period" text not null,
  "profileId" text not null references profiles ("id") on delete cascade,
  "name" text not null,
  "score" integer not null,
  "detail" jsonb not null default '{}'::jsonb,
  "at" timestamptz not null default now(),
  primary key ("board", "period", "profileId")
);
create index if not exists scores_board on scores ("board", "period", "score" desc, "at" asc);
alter table scores enable row level security;

-- Keeps the better of the old and new score; returns the best and its rank.
create or replace function cop_submit_score(p_board text, p_period text, p_id text, p_name text, p_score integer, p_detail jsonb, p_now double precision)
returns jsonb language plpgsql as $$
declare best scores;
begin
  insert into scores ("board", "period", "profileId", "name", "score", "detail", "at")
  values (p_board, p_period, p_id, p_name, p_score, p_detail, to_timestamp(p_now / 1000))
  on conflict ("board", "period", "profileId") do update set
    "score" = excluded."score", "detail" = excluded."detail", "at" = excluded."at", "name" = excluded."name"
    where excluded."score" > scores."score";
  select * into best from scores where "board" = p_board and "period" = p_period and "profileId" = p_id;
  return jsonb_build_object('best', best."score", 'rank', 1 + (
    select count(*)::int from scores o where o."board" = p_board and o."period" = p_period
      and (o."score" > best."score" or (o."score" = best."score" and o."at" < best."at"))
  ));
end $$;

create or replace function cop_scoreboard(p_board text, p_period text, p_limit integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('rank', n, 'id', "profileId", 'name', "name", 'score', "score", 'detail', "detail") order by n)
      from (
        select *, row_number() over (order by "score" desc, "at" asc)::int as n
        from scores where "board" = p_board and "period" = p_period
        order by n limit p_limit
      ) ranked
    ), '[]'::jsonb),
    'total', (select count(*)::int from scores where "board" = p_board and "period" = p_period)
  )
$$;

-- ------------------------------------------------------------------ seasons

-- Ends the stored season if `p_season` is a new one: records every ranked trainer's
-- trophies and rank, then softly resets trophies above `p_floor` halfway down to it.
-- The very first call only records the season. Safe to call any number of times.
create or replace function cop_season_rollover(p_season text, p_floor integer) returns jsonb
language plpgsql as $$
declare
  current_season text;
  n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cop_season'));
  select "value" ->> 'season' into current_season from cop_meta where "key" = 'season';
  if current_season is null then
    insert into cop_meta ("key", "value") values ('season', jsonb_build_object('season', p_season))
    on conflict ("key") do update set "value" = excluded."value";
    return jsonb_build_object('rolled', false, 'season', p_season);
  end if;
  if current_season = p_season then
    return jsonb_build_object('rolled', false, 'season', p_season);
  end if;

  insert into season_results ("season", "profileId", "trophies", "rank")
  select current_season, p."id", p."trophies", cop_rank(p) from profiles p
  where p."wins" + p."losses" + p."draws" > 0
  on conflict do nothing;
  get diagnostics n = row_count;

  update profiles set "trophies" = p_floor + ("trophies" - p_floor) / 2 where "trophies" > p_floor;
  update cop_meta set "value" = jsonb_build_object('season', p_season) where "key" = 'season';
  return jsonb_build_object('rolled', true, 'season', p_season, 'ended', current_season, 'trainers', n);
end $$;

-- ------------------------------------------------------------------ access

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
