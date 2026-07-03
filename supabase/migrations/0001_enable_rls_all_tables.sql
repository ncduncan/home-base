-- Row-Level Security for every table the public anon key can reach.
--
-- WHY THIS EXISTS: the web app ships the Supabase anon key in a public GitHub
-- Pages bundle, so RLS is the ONLY boundary protecting household data. The
-- original migration that defined RLS for calendar_overrides/google_tokens was
-- deleted (commit 78954dd), leaving the live posture undocumented and
-- drift-prone. This restores a single, reviewable, idempotent source of truth.
--
-- SAFE TO RE-RUN and SAFE IF A TABLE IS MISSING. It only enables RLS (a no-op if
-- already enabled) and (re)creates policies, and it SKIPS any table that doesn't
-- exist (raising a NOTICE) instead of aborting. Not every table below exists in
-- every environment (e.g. calendar_cache/todos back the currently-dormant TRMNL
-- endpoint). Apply by pasting into the Supabase SQL editor, or `supabase db push`.
--
-- After applying, run the verify query at the bottom: every listed table must
-- show relrowsecurity = t.

DO $$
DECLARE
  t text;
  -- Household-shared tables reached by the browser (anon key); both allow-listed
  -- users may read/write. (calendar_cache/todos backed the now-removed TRMNL
  -- edge function and are being dropped — not listed here.)
  shared_tables text[] := ARRAY['homebase_events', 'calendar_overrides'];
BEGIN
  FOREACH t IN ARRAY shared_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skip %  (table does not exist)', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'household allow-list', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      || 'USING (auth.jwt()->>''email'' IN (''ncduncan@gmail.com'', ''caitante@gmail.com'')) '
      || 'WITH CHECK (auth.jwt()->>''email'' IN (''ncduncan@gmail.com'', ''caitante@gmail.com''))',
      'household allow-list', t
    );
    RAISE NOTICE 'RLS enabled + policy set on %', t;
  END LOOP;

  -- google_tokens: per-user refresh tokens. RLS on, NO SELECT policy, so only the
  -- service_role (which bypasses RLS) can ever read a refresh token. Users may
  -- only insert/update their OWN row.
  IF to_regclass('public.google_tokens') IS NULL THEN
    RAISE NOTICE 'skip google_tokens  (table does not exist)';
  ELSE
    EXECUTE 'ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "users insert own" ON public.google_tokens';
    EXECUTE 'CREATE POLICY "users insert own" ON public.google_tokens FOR INSERT WITH CHECK (auth.uid() = user_id)';
    EXECUTE 'DROP POLICY IF EXISTS "users update own" ON public.google_tokens';
    EXECUTE 'CREATE POLICY "users update own" ON public.google_tokens FOR UPDATE USING (auth.uid() = user_id)';
    RAISE NOTICE 'RLS enabled + policies set on google_tokens';
  END IF;
END $$;

-- Note: `goals` RLS is defined in supabase/goals_table.sql and already applied;
-- it is intentionally not duplicated here.

-- ── Verify (run separately; every row must show relrowsecurity = t) ────────────
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname IN ('homebase_events','calendar_overrides','goals','google_tokens')
-- ORDER BY relname;
