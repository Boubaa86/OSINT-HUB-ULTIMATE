DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_messages) THEN
    RAISE EXCEPTION 'Rollback refused: ai_messages contains data.';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_conversations) THEN
    RAISE EXCEPTION 'Rollback refused: ai_conversations contains data.';
  END IF;
END $$;

DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_conversations;
