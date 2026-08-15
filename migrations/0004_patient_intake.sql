-- Patient intake form: insurance info + medication receipt confirmation

ALTER TABLE patients ADD COLUMN insurance_info TEXT;
ALTER TABLE medications ADD COLUMN confirmed_at TEXT;