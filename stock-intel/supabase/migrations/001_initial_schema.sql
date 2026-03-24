-- Cache table: stores full analysis per ticker
CREATE TABLE analysis_cache (
	id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
	ticker        TEXT NOT NULL,
	exchange      TEXT,
	data          JSONB NOT NULL,
	created_at    TIMESTAMPTZ DEFAULT NOW(),
	expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON analysis_cache (ticker, expires_at);

-- Verdicts table: stores the final investment verdicts
CREATE TABLE verdicts (
	id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
	ticker        TEXT NOT NULL,
	long_term     JSONB NOT NULL,
	swing_trade   JSONB NOT NULL,
	day_trade     JSONB NOT NULL,
	created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Chat sessions: stores conversation history per ticker per user
CREATE TABLE chat_sessions (
	id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
	ticker        TEXT NOT NULL,
	user_id       UUID REFERENCES auth.users(id),
	messages      JSONB NOT NULL DEFAULT '[]',
	created_at    TIMESTAMPTZ DEFAULT NOW(),
	updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime on analysis_cache so frontend gets live updates
ALTER PUBLICATION supabase_realtime ADD TABLE analysis_cache;

-- API usage tracking for rate limit management
CREATE TABLE api_usage_log (
	id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
	api_name   TEXT NOT NULL,
	called_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON api_usage_log (api_name, called_at);