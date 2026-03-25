-- Ensure upsert on analysis_cache(ticker) works by adding a unique constraint.
-- First, remove duplicate ticker rows while keeping the most recent entry.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY ticker
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM analysis_cache
)
DELETE FROM analysis_cache ac
USING ranked r
WHERE ac.id = r.id
  AND r.rn > 1;

ALTER TABLE analysis_cache
ADD CONSTRAINT analysis_cache_ticker_key UNIQUE (ticker);
