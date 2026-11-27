import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';

export function createDashboardRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/summary', async (req, res, next) => {
    try {
      const ownerId = req.user.id;
      const [investigations, entities, sources, reports, automations] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM investigations WHERE owner_id = $1', [ownerId]),
        pool.query('SELECT COUNT(*)::int AS count FROM intelligence_entities e JOIN investigations i ON i.id = e.investigation_id WHERE i.owner_id = $1', [ownerId]),
        pool.query('SELECT COUNT(*)::int AS count FROM investigation_sources s JOIN investigations i ON i.id = s.investigation_id WHERE i.owner_id = $1', [ownerId]),
        pool.query('SELECT COUNT(*)::int AS count FROM reports WHERE created_by = $1', [ownerId]),
        pool.query('SELECT COUNT(*)::int AS count FROM automation_tasks WHERE owner_id = $1 AND enabled = TRUE', [ownerId])
      ]);
      res.json({
        investigations: investigations.rows[0].count,
        entities: entities.rows[0].count,
        sources: sources.rows[0].count,
        reports: reports.rows[0].count,
        activeAutomations: automations.rows[0].count,
        collectedAt: new Date().toISOString()
      });
    } catch (error) { next(error); }
  });

  return router;
}
