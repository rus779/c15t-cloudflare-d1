CREATE TABLE consent_receipts (
  subject_id TEXT NOT NULL,
  action_at_ms INTEGER NOT NULL,
  measurement INTEGER NOT NULL CHECK (measurement IN (0, 1)),
  policy_id TEXT NOT NULL,
  policy_revision TEXT NOT NULL,
  policy_fingerprint TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (subject_id, action_at_ms, measurement, policy_fingerprint)
) STRICT, WITHOUT ROWID;
