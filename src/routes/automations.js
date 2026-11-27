import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';
import { lookupCertificateNames } from '../providers/certificate-transparency.js';

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const createSchema = z.object({
  taskType: z.enum(['dns_change', 'certificate_change']),
  domain: z.string().trim().toLowerCase().max(253).regex(domainPattern),
  frequency: z.enum(['hourly', 'daily', 'weekly']),
  investigationId: z.string().uuid().optional(),
  authorized: z.literal(true)
});
const updateSchema = z.object({ enabled: z.boolean() });
const frequencyMinutes = { hourly: 60, daily: 1440, weekly: 10080 };

function nextRun(frequency) {
  return new Date(Date.now() + frequencyMinutes[frequency] * 60_000);
}

async function collectTaskData(task) {
  const domain = task.config.domain;
  if (task.task_type === 'certificate_change') {
    const names = await lookupCertificateNames(domain);
    return { source: 'Certificate Transparency (crt.sh)', domain, names: [...names].sort() };
  }
  const definitions = [
    ['A', () => dns.resolve4(domain)],
    ['AAAA', () => dns.resolve6(domain)],
    ['MX', () => dns.resolveMx(domain)],
    ['NS', () => dns.resolveNs(domain)],
    ['TXT', () => dns.resolveTxt(domain)]
  ];
  const settled = await Promise.allSettled(definitions.map(([, run]) => run()));
  const records = Object.fromEntries(definitions.map(([name], index) => {
    const item = settled[index];
    if (item.status === 'rejected') return [name, { status: 'error', code: item.reason?.code || 'DNS_ERROR' }];
    const values = name === 'TXT' ? item.value.map(row => row.join('')) : [...item.value];
    values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return [name, { status: 'ok', values }];
  }));
  return { source: 'Public DNS resolver', domain, records };
}

async function executeTask(task) {
  const startedAt = new Date();
  try {
    const data = await collectTaskData(task);
    const previous = await pool.query(
      'SELECT result_data FROM automation_runs WHERE task_id = $1 AND status = $2 ORDER BY finished_at DESC LIMIT 1',
      [task.id, 'completed']
    );
    const changed = previous.rowCount > 0 && JSON.stringify(previous.rows[0].result_data.data) !== JSON.stringify(data);
    const resultData = { data, collectedAt: new Date().toISOString() };
    const saved = await pool.query(
      'INSERT INTO automation_runs(task_id, status, changed, result_data, started_at, finished_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, status, changed, finished_at',
      [task.id, 'completed', changed, resultData, startedAt]
    );
    await pool.query(
      'UPDATE automation_tasks SET last_run_at = NOW(), last_status = $2, next_run_at = CASE WHEN enabled THEN $3 ELSE NULL END, updated_at = NOW() WHERE id = $1',
      [task.id, 'completed', nextRun(task.frequency)]
    );
    if (changed) {
      await pool.query(
        'INSERT INTO notifications(user_id, kind, title, body) VALUES ($1, $2, $3, $4)',
        [task.owner_id, 'automation_change', 'Changement détecté', `Le suivi ${task.config.domain} a détecté une modification des données publiques.`]
      );
    }
    return { ...saved.rows[0], taskId: task.id };
  } catch (error) {
    const errorCode = error.code || (error.name === 'TimeoutError' ? 'TIMEOUT' : 'SOURCE_ERROR');
    const saved = await pool.query(
      'INSERT INTO automation_runs(task_id, status, changed, result_data, error_code, started_at, finished_at) VALUES ($1, $2, FALSE, $3, $4, $5, NOW()) RETURNING id, status, changed, error_code, finished_at',
      [task.id, 'failed', {}, errorCode, startedAt]
    );
    await pool.query(
      'UPDATE automation_tasks SET last_run_at = NOW(), last_status = $2, next_run_at = CASE WHEN enabled THEN $3 ELSE NULL END, updated_at = NOW() WHERE id = $1',
      [task.id, 'failed', nextRun(task.frequency)]
    );
    return { ...saved.rows[0], taskId: task.id };
  }
}

function validSecret(req) {
  const expected = process.env.AUTOMATION_SECRET || '';
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAutomationsRouter() {
  const router = Router();

  router.post('/run-due', rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    if (!validSecret(req)) return res.status(401).json({ error: 'Secret d’automatisation invalide ou non configuré.' });
    const client = await pool.connect();
    let tasks = [];
    try {
      await client.query('BEGIN');
      const due = await client.query(
        'SELECT * FROM automation_tasks WHERE enabled = TRUE AND next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED'
      );
      tasks = due.rows;
      for (const task of tasks) {
        await client.query('UPDATE automation_tasks SET next_run_at = NOW() + INTERVAL \'5 minutes\', last_status = $2 WHERE id = $1', [task.id, 'running']);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const results = [];
    for (const task of tasks) results.push(await executeTask(task));
    res.json({ processed: results.length, results, collectedAt: new Date().toISOString() });
  });

  router.use(requireAuth);
  router.use(rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.get('/', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT t.id, t.task_type, t.config, t.frequency, t.enabled, t.next_run_at, t.last_run_at, t.last_status, t.created_at,
                r.status AS last_run_status, r.changed AS last_run_changed, r.finished_at AS last_run_finished
         FROM automation_tasks t
         LEFT JOIN LATERAL (SELECT status, changed, finished_at FROM automation_runs WHERE task_id = t.id ORDER BY finished_at DESC LIMIT 1) r ON TRUE
         WHERE t.owner_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
        [req.user.id]
      );
      res.json({ tasks: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/', requireCsrf, async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Tâche invalide. Une confirmation d’autorisation du domaine est requise.' });
    try {
      if (parsed.data.investigationId) {
        const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [parsed.data.investigationId, req.user.id]);
        if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      }
      const result = await pool.query(
        'INSERT INTO automation_tasks(owner_id, investigation_id, task_type, config, frequency, enabled, next_run_at) VALUES ($1, $2, $3, $4, $5, TRUE, NOW()) RETURNING id, task_type, config, frequency, enabled, next_run_at, created_at',
        [req.user.id, parsed.data.investigationId || null, parsed.data.taskType, { domain: parsed.data.domain }, parsed.data.frequency]
      );
      res.status(201).json({ task: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.patch('/:id', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'État invalide.' });
    try {
      const result = await pool.query(
        'UPDATE automation_tasks SET enabled = $3, next_run_at = CASE WHEN $3 THEN COALESCE(next_run_at, NOW()) ELSE NULL END, updated_at = NOW() WHERE id = $1 AND owner_id = $2 RETURNING id, enabled, next_run_at',
        [req.params.id, req.user.id, parsed.data.enabled]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Tâche introuvable.' });
      res.json({ task: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.post('/:id/run', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const owned = await pool.query('SELECT * FROM automation_tasks WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Tâche introuvable.' });
      const result = await executeTask(owned.rows[0]);
      res.json({ result });
    } catch (error) { next(error); }
  });

  router.get('/:id/runs', async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const owned = await pool.query('SELECT id FROM automation_tasks WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Tâche introuvable.' });
      const runs = await pool.query('SELECT id, status, changed, result_data, error_code, started_at, finished_at FROM automation_runs WHERE task_id = $1 ORDER BY finished_at DESC LIMIT 50', [req.params.id]);
      res.json({ runs: runs.rows });
    } catch (error) { next(error); }
  });

  return router;
}
