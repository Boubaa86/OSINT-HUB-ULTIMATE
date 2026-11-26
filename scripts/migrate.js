import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.join(here, '..', 'src', 'migrations');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. No database has been changed.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined,
  max: 1,
  connectionTimeoutMillis: 5000
});

const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(731904260)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const version = '001_initial_schema';
  const alreadyApplied = await client.query(
    'SELECT version FROM schema_migrations WHERE version = $1',
    [version]
  );

  if (alreadyApplied.rowCount) {
    console.log(`Migration ${version} already applied; no changes made.`);
  } else {
    const sql = await readFile(path.join(migrationDir, `${version}.up.sql`), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`Applied migration ${version}.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  try { await client.query('SELECT pg_advisory_unlock(731904260)'); } catch {}
  client.release();
  await pool.end();
}
