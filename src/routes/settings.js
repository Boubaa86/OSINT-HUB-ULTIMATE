import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';

const defaults = { theme: 'dark', sidebarCollapsed: false, notificationsEnabled: true };
const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  sidebarCollapsed: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional()
}).refine(value => Object.keys(value).length > 0);

export function createSettingsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const result = await pool.query('SELECT preferences FROM user_settings WHERE user_id = $1', [req.user.id]);
      res.json({ preferences: { ...defaults, ...(result.rows[0]?.preferences || {}) } });
    } catch (error) { next(error); }
  });

  router.patch('/', requireCsrf, async (req, res, next) => {
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Préférences invalides.' });
    try {
      const result = await pool.query(
        `INSERT INTO user_settings(user_id, preferences) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET preferences = user_settings.preferences || EXCLUDED.preferences, updated_at = NOW()
         RETURNING preferences`,
        [req.user.id, parsed.data]
      );
      res.json({ preferences: { ...defaults, ...result.rows[0].preferences } });
    } catch (error) { next(error); }
  });

  return router;
}
