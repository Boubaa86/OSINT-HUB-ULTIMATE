DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM automation_runs) THEN
    RAISE EXCEPTION 'Rollback refused: automation_runs contains data.';
  END IF;
END $$;

DROP TABLE IF EXISTS automation_runs;
