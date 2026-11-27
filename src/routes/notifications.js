import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';

export function createNotificationsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT id, kind, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
        [req.user.id]
      );
      res.json({ notifications: result.rows, unreadCount: result.rows.filter(item => !item.read_at).length });
    } catch (error) { next(error); }
  });

  router.patch('/:id/read', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const result = await pool.query(
        'UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2 RETURNING id, read_at',
        [req.params.id, req.user.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Notification introuvable.' });
      res.json({ notification: result.rows[0] });
    } catch (error) { next(error); }
  });

  return router;
}
