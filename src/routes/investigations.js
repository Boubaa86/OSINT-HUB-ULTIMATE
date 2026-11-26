import { Router } from 'express';
import { z } from 'zod';
import ipaddr from 'ipaddr.js';
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
const entitySchema = z.object({
  entityType: z.enum(['organization', 'domain', 'ip', 'url', 'hash', 'technology', 'certificate']),
  canonicalValue: z.string().trim().min(1).max(2048),
  displayLabel: z.string().trim().min(1).max(160),
  attributes: z.record(z.string(), z.string().max(500)).optional().default({})
});
const relationshipSchema = z.object({
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  relationType: z.enum(['resolves_to', 'hosts', 'uses_technology', 'certificate_for', 'same_organization', 'observed_on', 'references']),
  sourceId: z.string().uuid(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(10).max(2000)
});
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

  router.get('/:id/graph', async (req, res, next) => {
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const [entities, relationships] = await Promise.all([
        pool.query(
          'SELECT id, entity_type, canonical_value, display_label, attributes, created_at, updated_at FROM intelligence_entities WHERE investigation_id = $1 ORDER BY created_at ASC',
          [req.params.id]
        ),
        pool.query(
          `SELECT r.id, r.from_entity_id, r.to_entity_id, r.relation_type, r.confidence, r.rationale, r.created_at,
                  s.source_name, s.source_url, s.collected_at AS source_collected_at
           FROM intelligence_relationships r
           LEFT JOIN investigation_sources s ON s.id = r.source_id
           WHERE r.investigation_id = $1 ORDER BY r.created_at ASC`,
          [req.params.id]
        )
      ]);
      res.json({ entities: entities.rows, relationships: relationships.rows });
    } catch (error) { next(error); }
  });

  router.post('/:id/entities', requireCsrf, async (req, res, next) => {
    const parsed = entitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Entité invalide.' });
    const value = parsed.data;
    if (value.entityType === 'domain' && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/i.test(value.canonicalValue)) {
      return res.status(400).json({ error: 'Nom de domaine invalide.' });
    }
    if (value.entityType === 'ip') {
      try {
        if (!ipaddr.isValid(value.canonicalValue) || ipaddr.parse(value.canonicalValue).range() !== 'unicast') {
          return res.status(400).json({ error: 'Seules les IP publiques sont acceptées dans IntelBase.' });
        }
      } catch { return res.status(400).json({ error: 'Adresse IP invalide.' }); }
    }
    if (value.entityType === 'hash' && !/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.canonicalValue)) {
      return res.status(400).json({ error: 'Hash MD5, SHA-1 ou SHA-256 attendu.' });
    }
    if (value.entityType === 'url') {
      try {
        const parsedUrl = new URL(value.canonicalValue);
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.hostname === 'localhost') {
          return res.status(400).json({ error: 'URL publique HTTP(S) requise.' });
        }
        const hostForRangeCheck = parsedUrl.hostname.replace(/^\\[|\\]$/g, '');
        if (ipaddr.isValid(hostForRangeCheck) && ipaddr.parse(hostForRangeCheck).range() !== 'unicast') {
          return res.status(400).json({ error: 'Les URL vers des IP privées ou réservées sont refusées.' });
        }
      } catch { return res.status(400).json({ error: 'URL invalide.' }); }
    }
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const result = await pool.query(
        `INSERT INTO intelligence_entities(investigation_id, entity_type, canonical_value, display_label, attributes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (investigation_id, entity_type, canonical_value)
         DO UPDATE SET display_label = EXCLUDED.display_label, attributes = EXCLUDED.attributes, updated_at = NOW()
         RETURNING id, entity_type, canonical_value, display_label, attributes, created_at, updated_at`,
        [req.params.id, value.entityType, value.canonicalValue, value.displayLabel, value.attributes]
      );
      res.status(201).json({ entity: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.post('/:id/relationships', requireCsrf, async (req, res, next) => {
    const parsed = relationshipSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Relation invalide. Une source et une justification sont obligatoires.' });
    const value = parsed.data;
    if (value.fromEntityId === value.toEntityId) return res.status(400).json({ error: 'Une relation doit relier deux entités différentes.' });
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const evidence = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM intelligence_entities WHERE id = ANY($1::uuid[]) AND investigation_id = $3) AS entity_count,
           (SELECT COUNT(*) FROM investigation_sources WHERE id = $2 AND investigation_id = $3) AS source_count`,
        [[value.fromEntityId, value.toEntityId], value.sourceId, req.params.id]
      );
      if (Number(evidence.rows[0].entity_count) !== 2 || Number(evidence.rows[0].source_count) !== 1) {
        return res.status(400).json({ error: 'Les deux entités et la source doivent appartenir à ce dossier.' });
      }
      const result = await pool.query(
        `INSERT INTO intelligence_relationships(investigation_id, from_entity_id, to_entity_id, relation_type, source_id, confidence, rationale)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, from_entity_id, to_entity_id, relation_type, source_id, confidence, rationale, created_at`,
        [req.params.id, value.fromEntityId, value.toEntityId, value.relationType, value.sourceId, value.confidence, value.rationale]
      );
      res.status(201).json({ relationship: result.rows[0] });
    } catch (error) { next(error); }
  });

  return router;
}
