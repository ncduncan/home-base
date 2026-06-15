-- Long-term life goals shared between Nat and Caitie. Surfaced in the Goals
-- tab of the web app. Each row is a single goal grouped under a life-domain
-- category (Meaningful Work / Family & Friends / Health / Fun / Financial).
--
-- Visibility:
--   'shared'  — both allow-listed users can read and write.
--   'private' — only the creator can read or write.
--
-- Apply by pasting the SQL below into the Supabase dashboard SQL editor.

CREATE TABLE goals (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  text         TEXT NOT NULL,
  category     TEXT NOT NULL,                    -- 'meaningful_work' | 'family_friends' | 'health' | 'fun' | 'financial'
  achieved     BOOLEAN NOT NULL DEFAULT false,   -- DEPRECATED — superseded by `status` (kept for backfill history)
  status       TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'on_track' | 'achieved'
  visibility   TEXT NOT NULL DEFAULT 'shared',   -- 'shared' | 'private'
  owner        TEXT NOT NULL,                    -- 'nat' | 'caitie'
  created_by   TEXT NOT NULL,                    -- email of creator
  notes        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX goals_category_position_idx ON goals(category, position);

-- ---------------------------------------------------------------------------
-- Migration (run once on an existing table that predates the `status` column).
-- The checkbox is now tri-state: open → on_track → achieved. `achieved` is left
-- in place (non-destructive) but is no longer read or written by the app.
-- Paste into the Supabase SQL editor:
--
--   ALTER TABLE goals ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
--   UPDATE goals SET status = 'achieved' WHERE achieved = true;
-- ---------------------------------------------------------------------------

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read shared or own"
  ON goals FOR SELECT
  USING (
    auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com')
    AND (visibility = 'shared' OR created_by = auth.jwt()->>'email')
  );

CREATE POLICY "write shared or own"
  ON goals FOR ALL
  USING (
    auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com')
    AND (visibility = 'shared' OR created_by = auth.jwt()->>'email')
  )
  WITH CHECK (
    auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com')
    AND (visibility = 'shared' OR created_by = auth.jwt()->>'email')
  );
