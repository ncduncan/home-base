-- Retire the goals table and the read-only role created for the finance
-- forecaster (#8). Goals now live in that app; nothing here reads or writes
-- this table any more (#5), and the forecaster no longer reads it.
--
-- One DO block, so it applies all or nothing. No CASCADE: dropping the table
-- also drops its policies and column grants, and anything else that still
-- depended on it makes the drop fail instead of being dropped silently.
-- Safe to re-run: every step checks first.
do $$
begin
  drop table if exists public.goals;
  if exists (select 1 from pg_roles where rolname = 'finance_agent_ro') then
    revoke all on schema public from finance_agent_ro;
    drop role finance_agent_ro;
  end if;
end
$$;
