CREATE TABLE IF NOT EXISTS image_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  investigation_id UUID REFERENCES investigations(id) ON DELETE SET NULL,
  sha256 CHAR(64) NOT NULL,
  dhash CHAR(16) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 8388608),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/tiff')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_records_owner_sha
  ON image_records(owner_id, sha256);
CREATE INDEX IF NOT EXISTS idx_image_records_owner_created
  ON image_records(owner_id, created_at DESC);
