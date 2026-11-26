import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';
import { renderReport, streamPdf } from '../reports/generator.js';

const formatSchema = z.object({ format: z.enum(['pdf', 'html', 'json', 'csv', 'markdown']) });

async function loadReportData(investigationId, userId) {
  const investigation = await pool.query(
    'SELECT id, title, description, objective, status, created_at, updated_at FROM investigations WHERE id = $1 AND owner_id = $2',
    [investigationId, userId]
  );
  if (!investigation.rowCount) return null;
  const [sources, notes, entities, relationships] = await Promise.all([
    pool.query('SELECT source_name, source_url, source_type, collected_at, reliability, notes FROM investigation_sources WHERE investigation_id = $1 ORDER BY collected_at ASC', [investigationId]),
    pool.query('SELECT body, created_at FROM investigation_notes WHERE investigation_id = $1 ORDER BY created_at ASC', [investigationId]),
    pool.query('SELECT id, entity_type, canonical_value, display_label, attributes, created_at FROM intelligence_entities WHERE investigation_id = $1 ORDER BY created_at ASC', [investigationId]),
    pool.query(
      `SELECT r.from_entity_id, r.to_entity_id, r.relation_type, r.confidence, r.rationale, r.created_at,
              a.display_label AS from_label, b.display_label AS to_label, s.source_name
       FROM intelligence_relationships r
       JOIN intelligence_entities a ON a.id = r.from_entity_id
       JOIN intelligence_entities b ON b.id = r.to_entity_id
       LEFT JOIN investigation_sources s ON s.id = r.source_id
       WHERE r.investigation_id = $1 ORDER BY r.created_at ASC`,
      [investigationId]
    )
  ]);
  return {
    title: `Rapport — ${investigation.rows[0].title}`,
    generatedAt: new Date().toISOString(),
    investigation: investigation.rows[0],
    sources: sources.rows,
    notes: notes.rows,
    entities: entities.rows,
    relationships: relationships.rows
  };
}

export function createReportsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/investigations/:id', async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant de dossier invalide.' });
    try {
      const owned = await pool.query('SELECT id FROM investigations WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
      if (!owned.rowCount) return res.status(404).json({ error: 'Dossier introuvable.' });
      const result = await pool.query(
        'SELECT id, title, format, created_at FROM reports WHERE investigation_id = $1 AND created_by = $2 ORDER BY created_at DESC LIMIT 50',
        [req.params.id, req.user.id]
      );
      res.json({ reports: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/investigations/:id', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant de dossier invalide.' });
    const parsed = formatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Format de rapport invalide.' });
    try {
      const report = await loadReportData(req.params.id, req.user.id);
      if (!report) return res.status(404).json({ error: 'Dossier introuvable.' });
      const saved = await pool.query(
        'INSERT INTO reports(investigation_id, created_by, title, format, report_data) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.params.id, req.user.id, report.title, parsed.data.format, {
          generatedAt: report.generatedAt,
          sourceCount: report.sources.length,
          entityCount: report.entities.length,
          relationshipCount: report.relationships.length,
          noteCount: report.notes.length
        }]
      );
      const reportId = saved.rows[0].id;
      const filename = `osint-report-${reportId}`;

      res.setHeader('X-Report-Id', reportId);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.${parsed.data.format === 'markdown' ? 'md' : parsed.data.format}`);

      if (parsed.data.format === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        return streamPdf(res, report);
      }
      const content = renderReport(parsed.data.format, report);
      const contentTypes = {
        html: 'text/html; charset=utf-8',
        json: 'application/json; charset=utf-8',
        csv: 'text/csv; charset=utf-8',
        markdown: 'text/markdown; charset=utf-8'
      };
      res.setHeader('Content-Type', contentTypes[parsed.data.format]);
      res.status(200).send(content);
    } catch (error) { next(error); }
  });

  return router;
}
