-- Manual check for supabase/migrations/20261103000000_finance_agent_ro.sql.
-- Run in the SQL editor as postgres AFTER applying the migration. Every
-- statement after `set role` should succeed, or fail where it says so.

-- 0. Record the goals policies (paste the result into the PR description).
select policyname, permissive, roles, cmd, qual, with_check
  from pg_policies where schemaname = 'public' and tablename = 'goals';

begin;
set local role finance_agent_ro;

-- 1. Expect: zero rows (no other owner's private goals).
select count(*) as leaked_other_private
  from public.goals where visibility = 'private' and owner <> 'nat';

-- 2. Expect: the shared count plus Nat's private count, as postgres sees them.
select visibility, owner, count(*) from public.goals group by 1, 2 order by 1, 2;

-- 3. Expect: ERROR permission denied (column not granted).
-- select created_by from public.goals limit 1;

-- 4. Expect: ERROR permission denied on another table.
-- select * from public.calendar_overrides limit 1;

-- 5. Expect: ERROR permission denied (no write grants).
-- update public.goals set text = text where false;

rollback;

-- 6. Pooler login (from a laptop, after setting the password):
--   psql "postgresql://finance_agent_ro.<project_ref>:<password>@<pooler-host>:6543/postgres" \
--     -c "select count(*) from public.goals"
--   If the pooler rejects a custom role, stop and report on #1. Don't fall back
--   to the service-role key.
