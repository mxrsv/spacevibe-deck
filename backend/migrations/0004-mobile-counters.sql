-- Phone-companion counters (MOB27), added without a schema bump like the update
-- counters. Clients before the companion never send the field, so their rows and
-- every existing row read as an empty object. Counts only, keyed by the closed set
-- in src/payload.mjs. `pairedPhones` is a daily gauge that the aggregate sums into
-- phone-days. Apply with `npm run migrate` BEFORE the client release that sends it.
ALTER TABLE usage_days ADD COLUMN mobile TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mobile));

ALTER TABLE usage_aggregates ADD COLUMN mobile TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mobile));
