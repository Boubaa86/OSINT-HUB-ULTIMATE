CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  changed BOOLEAN NOT NULL DEFAULT FALSE,
  result_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_task_created
  ON automation_runs(task_id, finished_at DESC);
