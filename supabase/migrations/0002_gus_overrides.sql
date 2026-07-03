-- Manual Gus pickup/dropoff assignment overrides.
--
-- WHY THIS EXISTS: Gus pickup/dropoff is computed from Caitie's shifts by
-- computeGusCare(). When Nat & Caitie agree offline that a specific day should
-- go the other way, they need a manual override that ALWAYS wins over the
-- algorithm. This table stores one override per (date, role); computeGusCare
-- consults it and the dashboard + Sunday agent re-sync the calendar invite for
-- the new owner.
--
-- Reached by the browser (anon key) via shared/src/gus-overrides.ts, so RLS is
-- the boundary — same household allow-list as calendar_overrides.
--
-- SAFE TO RE-RUN: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.
-- Apply by pasting into the Supabase SQL editor, or `supabase db push`.

CREATE TABLE IF NOT EXISTS gus_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date       date NOT NULL,
  role       text NOT NULL CHECK (role IN ('pickup', 'dropoff')),
  owner      text NOT NULL CHECK (owner IN ('nat', 'caitie')),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, role)
);

ALTER TABLE gus_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household allow-list" ON gus_overrides;
CREATE POLICY "household allow-list" ON gus_overrides
  FOR ALL
  USING      (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'))
  WITH CHECK (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'));
