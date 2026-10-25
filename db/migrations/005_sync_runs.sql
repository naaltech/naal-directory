-- Panelden başlatılan kuyruk çalıştırmaları (deneme ya da gerçek)
CREATE TABLE sync_runs (
  id             INTEGER PRIMARY KEY,
  mode           TEXT NOT NULL CHECK (mode IN ('DRY', 'LIVE')),
  job_limit      INTEGER,
  status         TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED', 'STOPPED')),
  total          INTEGER,
  processed      INTEGER NOT NULL DEFAULT 0,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  report         TEXT,
  error          TEXT,
  started_by     INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT
);

CREATE INDEX sync_runs_started ON sync_runs (started_at);
