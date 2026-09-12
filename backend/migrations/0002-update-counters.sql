-- Update-lifecycle counters, added without a schema bump (DECK-74). Clients up to
-- 1.2.0 never send the field, so their rows and every existing row read as an
-- empty object. Counts only, keyed by the closed set in src/payload.mjs.
ALTER TABLE usage_days ADD COLUMN updates TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(updates));

ALTER TABLE usage_aggregates ADD COLUMN updates TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(updates));
