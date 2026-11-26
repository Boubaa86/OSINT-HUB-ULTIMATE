import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireCsrf, requireRole } from '../auth.js';

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) });
const rolesSchema = z.object({ roles: z.array(z.enum(['user', 'analyst', 'admin'])).min(1).max(3) });

export function createAdminRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('admin'));
  router.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.get('/overview', async (_req, res, next) => {
    try {
      const [users, cases, reports, tasks, recentErrors] = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM users"),
        pool.query('SELECT COUNT(*)::int AS total FROM investigations'),
        pool.query('SELECT COUNT(*)::int AS total FROM reports'),
        pool.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE enabled = TRUE)::int AS enabled FROM automation_tasks'),
        pool.query("SELECT COUNT(*)::int AS total FROM automation_runs WHERE status = 'failed' AND finished_at > NOW() - INTERVAL '24 hours'")
      ]);
      res.json({
        users: users.rows[0],
        investigations: cases.rows[0].total,
        reports: reports.rows[0].total,
        automations: tasks.rows[0],
        failedAutomationRunsLast24h: recentErrors.rows[0].total,
        collectedAt: new Date().toISOString()
      });
    } catch (error) { next(error); }
  });

  router.get('/users', async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.display_name, u.status, u.created_at,
                COALESCE(array_agg(r.role_key) FILTER (WHERE r.role_key IS NOT NULL), ARRAY[]::text[]) AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT 200`
      );
      res.json({ users: result.rows });
    } catch (error) { next(error); }
  });

  router.patch('/users/:id/status', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Statut invalide.' });
    if (req.params.id === req.user.id && parsed.data.status === 'disabled') {
      return res.status(400).json({ error: 'Un administrateur ne peut pas désactiver son propre compte.' });
    }
    try {
      const result = await pool.query(
        'UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, email, status',
        [req.params.id, parsed.data.status]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      await pool.query(
        'INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'admin.user.status', 'user', req.params.id, { status: parsed.data.status }]
      );
      res.json({ user: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.patch('/users/:id/roles', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    const parsed = rolesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Rôles invalides.' });
    if (req.params.id === req.user.id && !parsed.data.roles.includes('admin')) {
      return res.status(400).json({ error: 'Un administrateur ne peut pas retirer son propre rôle admin.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
      if (!target.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Utilisateur introuvable.' });
      }
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.params.id]);
      await client.query(
        'INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE role_key = ANY($2::text[])',
        [req.params.id, [...new Set(parsed.data.roles)]]
      );
      await client.query(
        'INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'admin.user.roles', 'user', req.params.id, { roles: [...new Set(parsed.data.roles)] }]
      );
      await client.query('COMMIT');
      res.json({ userId: req.params.id, roles: [...new Set(parsed.data.roles)] });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally { client.release(); }
  });

  router.get('/audit', async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT a.id, a.action, a.resource_type, a.resource_id, a.details, a.created_at, u.email AS actor_email
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
         ORDER BY a.created_at DESC LIMIT 100`
      );
      res.json({ events: result.rows });
    } catch (error) { next(error); }
  });

  return router;
}
