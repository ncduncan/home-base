-- Standalone events created from inside home-base. Lives only in Supabase
-- (not synced to Google Calendar) so it doesn't pollute either user's primary
-- calendar. Both Nat and Caitie see these in home-base via shared RLS.

CREATE TABLE homebase_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,    -- ISO datetime "YYYY-MM-DDTHH:MM:SS" or date "YYYY-MM-DD" for all-day
  end_time TEXT NOT NULL,
  all_day BOOLEAN DEFAULT false,
  location TEXT,
  notes TEXT,
  owner TEXT NOT NULL,         -- 'nat' | 'caitie'
  created_by TEXT NOT NULL,    -- email of creator
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX homebase_events_start_idx ON homebase_events(start_time);

ALTER TABLE homebase_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authorized users" ON homebase_events
  FOR ALL
  USING (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'))
  WITH CHECK (auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com'));
