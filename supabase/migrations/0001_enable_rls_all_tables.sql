-- Row-Level Security for every table the public anon key can reach.
--
-- WHY THIS EXISTS: the web app ships the Supabase anon key in a public GitHub
-- Pages bundle, so RLS is the ONLY boundary protecting household data. The
-- original migration that defined RLS for calendar_overrides/google_tokens was
-- deleted (commit 78954dd), leaving the live posture undocumented and
-- drift-prone. This restores a single, reviewable, idempotent source of truth.
--
-- SAFE TO RE-RUN. It does NOT create/alter table columns — it only enables RLS
-- (a no-op if already enabled) and (re)creates policies via DROP ... IF EXISTS.
-- Apply by pasting into the Supabase SQL editor, or `supabase db push`.
--
-- After applying, verify:
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('homebase_events','calendar_overrides','calendar_cache',
--                     'todos','goals','google_tokens');
-- Every relrowsecurity must be `t`. Then confirm an anonymous read is empty:
--   curl "$VITE_SUPABASE_URL/rest/v1/homebase_events?select=*" -H "apikey: $ANON"
-- should return [] or 401 — never rows.

-- ── Household-shared tables: both allow-listed users may read/write ───────────
-- homebase_events + calendar_overrides are reached by the browser (anon key)
-- via shared/src/{homebase-events,overrides}.ts. calendar_cache + todos are
-- service-role-only today (Python TRMNL pipeline + trmnl edge function), which
-- bypasses RLS; the allow-list policy is defence-in-depth if a browser path is
-- ever added, and denies the anon key regardless.

ALTER TABLE homebase_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household allow-list" ON homebase_events;
CREATE POLICY "household allow-list" ON homebase_events
  FOR ALL
  USING      (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'))
  WITH CHECK (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'));

DROP POLICY IF EXISTS "household allow-list" ON calendar_overrides;
CREATE POLICY "household allow-list" ON calendar_overrides
  FOR ALL
  USING      (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'))
  WITH CHECK (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'));

DROP POLICY IF EXISTS "household allow-list" ON calendar_cache;
CREATE POLICY "household allow-list" ON calendar_cache
  FOR ALL
  USING      (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'))
  WITH CHECK (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'));

DROP POLICY IF EXISTS "household allow-list" ON todos;
CREATE POLICY "household allow-list" ON todos
  FOR ALL
  USING      (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'))
  WITH CHECK (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'));

-- ── google_tokens: per-user refresh tokens (restored from deleted migration) ──
-- Never readable by anyone via the API: RLS is enabled and there is NO SELECT
-- policy, so only the service_role (which bypasses RLS) can read refresh tokens.
-- Users may only insert/update their OWN row. Kept for compatibility even though
-- the active calendar path (calendar-ops) no longer uses this table.

ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users insert own" ON google_tokens;
CREATE POLICY "users insert own" ON google_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own" ON google_tokens;
CREATE POLICY "users update own" ON google_tokens
  FOR UPDATE USING (auth.uid() = user_id);

-- Note: `goals` RLS is defined in supabase/goals_table.sql and is already
-- applied; it is intentionally not duplicated here.
