import pg from 'pg';

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined,
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000
    })
  : null;

export async function getDatabaseStatus() {
  if (!pool) return { configured: false, connected: false };
  try {
    await pool.query('SELECT 1');
    return { configured: true, connected: true };
  } catch {
    return { configured: true, connected: false };
  }
}
