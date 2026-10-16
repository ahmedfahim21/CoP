-- Seasons no longer reset trophies. A new month still archives every ranked trainer's final
-- trophies and rank to season_results, but nobody's trophies change: the soft reset that
-- halved trophies above 1,000 is gone, and with it the floor argument.

drop function if exists cop_season_rollover(text, integer);

create or replace function cop_season_rollover(p_season text) returns jsonb
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

  update cop_meta set "value" = jsonb_build_object('season', p_season) where "key" = 'season';
  return jsonb_build_object('rolled', true, 'season', p_season, 'ended', current_season, 'trainers', n);
end $$;

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
