import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';

const createSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().max(5000).optional().default(''),
  objective: z.string().max(3000).optional().default('')
});
const updateSchema = z.object({
  title: z.string().trim().min(2).max(140).optional(),
  description: z.string().max(5000).optional(),
  objective: z.string().max(3000).optional(),
  status: z.enum(['open', 'paused', 'closed', 'archived']).optional()
}).refine(value => Object.keys(value).length > 0, 'Aucune modification fournie');
const noteSchema = z.object({ body: z.string().trim().min(1).max(10000) });
const sourceSchema = z.object({
  sourceName: z.string().trim().min(1).max(160),
  sourceUrl: z.string().url().max(2048).optional().nullable(),
  sourceType: z.enum(['web', 'api', 'document', 'other']).optional().default('web'),
  reliability: z.enum(['low', 'medium', 'high', 'unknown']).optional().default('unknown'),
  notes: z.string().max(3000).optional().default('')
});

export function createInvestigationsRouter() {
  const router = Router();
  router.param('id', (req, res, next, id) => {
    if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ error: 'Identifiant de dossier invalide.' });
    next();
  });
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, title, description, objective, status, created_at, updated_at, archived_at
         FROM investigations WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 100`,
        [req.user.id]
      );
      res.json({ investigations: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/', requireCsrf, async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Données du dossier invalides.' });
    try {
      const result = await pool.query(
        `INSERT INTO investigations(owner_id, title, description, objective)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, description, objective, status, created_at, updated_at`,
        [req.user.id, parsed.data.title, parsed.data.description, parsed.data.objective]
      );
      res.status(201).json({ investigation: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, title, description, objective, status, created_at, updated_at, archived_at
         FROM investigations WHERE id = $1 AND owner_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      res.json({ investigation: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.patch('/:id', requireCsrf, async (req, res, next) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Modifications invalides.' });
    const value = parsed.data;
    try {
      const result = await pool.query(
        `UPDATE investigations SET
           title = COALESCE($3, title),
           description = COALESCE($4, description),
           objective = COALESCE($5, objective),
           status = COALESCE($6, status),
           archived_at = CASE WHEN $6 = 'archived' THEN COALESCE(archived_at, NOW())
                              WHEN $6 IS NOT NULL THEN NULL ELSE archived_at END,
           updated_at = NOW()
         WHERE id = $1 AND owner_id = $2
         RETURNING id, title, description, objective, status, created_at, updated_at, archived_at`,
        [req.params.id, req.user.id, value.title ?? null, value.description ?? null, value.objective ?? null, value.status ?? null]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      res.json({ investigation: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/:id/notes', async (req, res, next) => {
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const result = await pool.query(
        'SELECT id, body, created_at, updated_at FROM investigation_notes WHERE investigation_id = $1 ORDER BY created_at DESC LIMIT 200',
        [req.params.id]
      );
      res.json({ notes: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/:id/notes', requireCsrf, async (req, res, next) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Note invalide.' });
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const result = await pool.query(
        'INSERT INTO investigation_notes(investigation_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at',
        [req.params.id, req.user.id, parsed.data.body]
      );
      res.status(201).json({ note: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/:id/sources', async (req, res, next) => {
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const result = await pool.query(
        'SELECT id, source_name, source_url, source_type, collected_at, reliability, notes FROM investigation_sources WHERE investigation_id = $1 ORDER BY collected_at DESC LIMIT 200',
        [req.params.id]
      );
      res.json({ sources: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/:id/sources', requireCsrf, async (req, res, next) => {
    const parsed = sourceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Source invalide.' });
    if (parsed.data.sourceUrl && !['http:', 'https:'].includes(new URL(parsed.data.sourceUrl).protocol)) {
      return res.status(400).json({ error: 'Seules les URL HTTP(S) sont acceptées.' });
    }
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const result = await pool.query(
        `INSERT INTO investigation_sources(investigation_id, source_name, source_url, source_type, reliability, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, source_name, source_url, source_type, collected_at, reliability, notes`,
        [req.params.id, parsed.data.sourceName, parsed.data.sourceUrl || null, parsed.data.sourceType, parsed.data.reliability, parsed.data.notes]
      );
      res.status(201).json({ source: result.rows[0] });
    } catch (error) { next(error); }
  });

  return router;
}
