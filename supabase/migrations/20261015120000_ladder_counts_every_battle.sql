-- The ladder lists every trainer who has battled, not only those with a ranked game.
-- Trophies still move only in ranked battles, so players who've only fought the bot (or
-- friends) sit at 0 trophies, below every ranked player. Entries now say whether the trainer
-- has played ranked (`rated`) and how many battles they've fought.
--
-- Order: trophies, ranked wins, ranked before unrated, then who got there first.

drop index if exists profiles_ladder;
create index if not exists profiles_ladder
  on profiles ("trophies" desc, "wins" desc, (("wins" + "losses" + "draws") > 0) desc, "createdAt" asc, "id" asc)
  where "battles" > 0;

-- 1-based ladder position, in the order above.
create or replace function cop_rank(p profiles) returns integer
language sql stable as $$
  select case when p."battles" = 0 then null else 1 + (
    select count(*)::int from profiles o
    where o."battles" > 0 and (
      (o."trophies", o."wins", (o."wins" + o."losses" + o."draws") > 0, -extract(epoch from o."createdAt"))
        > (p."trophies", p."wins", (p."wins" + p."losses" + p."draws") > 0, -extract(epoch from p."createdAt"))
      or (o."trophies" = p."trophies" and o."wins" = p."wins"
          and ((o."wins" + o."losses" + o."draws") > 0) = ((p."wins" + p."losses" + p."draws") > 0)
          and o."createdAt" = p."createdAt" and o."id" < p."id")
    )
  ) end
$$;

create or replace function cop_leaderboard(p_limit integer, p_offset integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', n, 'id', "id", 'name', "name", 'trophies', "trophies", 'wins', "wins", 'losses', "losses",
        'battles', "battles", 'rated', "wins" + "losses" + "draws" > 0
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
