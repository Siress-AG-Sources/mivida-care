-- Pair each call with the encounter it generated, so correcting a call's
-- date/time can move the contact record with it. Without this the call log and
-- the contact clock silently disagree after any edit.
ALTER TABLE encounters ADD COLUMN call_id INTEGER REFERENCES call_log(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_encounters_call ON encounters(call_id);

-- How many days before a prescription's order-by date to start reminding.
INSERT OR IGNORE INTO settings (key, value) VALUES ('order_lead_days', '7');
