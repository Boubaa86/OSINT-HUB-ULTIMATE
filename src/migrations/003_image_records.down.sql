DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM image_records) THEN
    RAISE EXCEPTION 'Rollback refused: image_records contains data.';
  END IF;
END $$;

DROP TABLE IF EXISTS image_records;
