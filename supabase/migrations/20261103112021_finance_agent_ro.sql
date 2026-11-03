-- Read-only login for the finance forecaster (a separate personal app) to read
-- goals. Least privilege: it can select the listed columns of `goals`, only the
-- rows below, and nothing else.
--
-- The password is NOT set here (this repo is public). After applying, run once
-- in the SQL editor:  alter role finance_agent_ro password '<from a password manager>';
-- Pooler username: finance_agent_ro.<project_ref>

create role finance_agent_ro login noinherit;

grant usage on schema public to finance_agent_ro;

grant select (id, text, category, status, visibility, owner, notes, created_at, updated_at)
  on public.goals to finance_agent_ro;

-- Shared goals plus the primary owner's private ones; other owners' private goals are excluded.
create policy finance_agent_ro_select on public.goals
  as permissive for select to finance_agent_ro
  using (visibility = 'shared' or owner = 'nat');

-- The same predicate as a restrictive policy. Permissive policies are OR'd, so
-- if an existing goals policy is granted `to public`, it would otherwise widen
-- what this role sees. Restrictive policies are AND'd onto every query.
create policy finance_agent_ro_select_guard on public.goals
  as restrictive for select to finance_agent_ro
  using (visibility = 'shared' or owner = 'nat');
