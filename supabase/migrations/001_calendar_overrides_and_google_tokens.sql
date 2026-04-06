-- Google refresh tokens for edge function token exchange
CREATE TABLE google_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own" ON google_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own" ON google_tokens
  FOR UPDATE USING (auth.uid() = user_id);

-- Calendar event overrides (for AMION and non-owned events)
CREATE TABLE calendar_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL,
  event_date DATE NOT NULL,
  hidden BOOLEAN DEFAULT false,
  title_override TEXT,
  start_override TEXT,
  end_override TEXT,
  amion_kind_override TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_key, event_date)
);

ALTER TABLE calendar_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authorized users" ON calendar_overrides
  FOR ALL USING (
    auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com')
  );
