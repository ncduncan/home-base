-- Workload settings (#13): one shared row holding every time assumption the
-- workload engine (shared/src/workload.ts) uses, as JSON. Seeded with the same
-- neutral defaults as DEFAULT_WORKLOAD_SETTINGS (a vitest checks they match);
-- real household values are entered later in the app, never in this public repo.
--
-- RLS mirrors calendar_overrides: its policies aren't in this repo, so they
-- are copied from the live catalog (same roles, commands and predicates)
-- rather than guessed. If calendar_overrides has no policies, the migration
-- fails instead of leaving a table nobody, or everybody, can read.
--
-- The predicates are copied verbatim. If one names a column this table
-- doesn't have (anything but id, settings, updated_by, updated_at), the copy
-- fails with a message saying so and the whole migration rolls back; check
-- `select * from pg_policies where tablename = 'calendar_overrides'` before
-- applying.
--
-- One DO block plus DDL in a single migration transaction: all or nothing.

create table public.workload_settings (
  id smallint primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.workload_settings enable row level security;

do $$
declare
  p record;
  n int := 0;
begin
  for p in
    select policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'calendar_overrides'
  loop
    begin
      execute format(
        'create policy %I on public.workload_settings as %s for %s to %s%s%s',
        'workload_settings_' || p.policyname,
        p.permissive,
        p.cmd,
        (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
           from unnest(p.roles) as r),
        case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
        case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end
      );
    exception when undefined_column then
      raise exception 'calendar_overrides policy % uses a column workload_settings lacks (%); write this policy by hand',
        p.policyname, sqlerrm;
    end;
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'calendar_overrides has no RLS policies to mirror; refusing to create workload_settings policies';
  end if;
end
$$;

insert into public.workload_settings (id, settings) values (1, '{
  "shiftHours": {"day": 10, "night": 16, "24hr": 24, "training": 4, "research": 8, "backup": 0},
  "taskDefaultMinutes": 30,
  "taskKeywordMinutes": [],
  "dinnersPerWeek": 7,
  "minutesPerDinner": 45,
  "cookSplitNatPct": 50,
  "mealPlanningMinutesPerWeek": 60,
  "mealPlanningSplitNatPct": 50,
  "pickupMinutes": 30,
  "dropoffMinutes": 30,
  "appointmentMinutes": 90,
  "sleepHoursPerDay": 8
}'::jsonb);
