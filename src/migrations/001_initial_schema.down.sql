-- Reversal is intentionally guarded: never drop user research or accounts.
DO $$
DECLARE
  table_name TEXT;
  row_count BIGINT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_settings','audit_logs','automation_tasks','notifications','api_integrations',
    'reports','intelligence_relationships','intelligence_entities','search_results',
    'search_history','investigation_sources','investigation_notes','investigations',
    'user_sessions','user_roles','users','roles'
  ]
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I', table_name) INTO row_count;
    IF row_count > 0 THEN
      RAISE EXCEPTION 'Rollback refused: table % contains % rows. Export and explicitly review data before any destructive operation.', table_name, row_count;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS automation_tasks;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS api_integrations;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS intelligence_relationships;
DROP TABLE IF EXISTS intelligence_entities;
DROP TABLE IF EXISTS search_results;
DROP TABLE IF EXISTS search_history;
DROP TABLE IF EXISTS investigation_sources;
DROP TABLE IF EXISTS investigation_notes;
DROP TABLE IF EXISTS investigations;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
