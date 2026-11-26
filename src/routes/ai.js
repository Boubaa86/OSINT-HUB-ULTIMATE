import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireCsrf } from '../auth.js';

const conversationSchema = z.object({ title: z.string().trim().min(1).max(180).optional() });
const messageSchema = z.object({
  message: z.string().trim().min(3).max(4000),
  investigationId: z.string().uuid().optional()
});

const instructions = `Tu es l'assistant d'analyse OSINT de OSINT HUB ULTIMATE.
Règles impératives :
- Analyse uniquement les données explicitement fournies et les sources citées.
- Distingue clairement les faits observés, les hypothèses et les informations inconnues.
- Pour chaque affirmation issue du dossier, cite le nom de la source et sa date si disponible.
- Ne présente jamais une corrélation comme une preuve de propriété, de causalité ou d'identité.
- Signale les contradictions, les limites, les faux positifs possibles et les données manquantes.
- Ne cherche pas à identifier ou localiser une personne privée, à accéder à un compte ou à contourner une restriction.
- Propose des pistes de vérification légitimes, passives et proportionnées.
- Si les données ne permettent pas de conclure, dis-le clairement.
Réponds en français, de façon structurée et concise.`;

async function loadCaseContext(investigationId, userId) {
  const investigation = await pool.query(
    'SELECT id, title, description, objective, status, created_at FROM investigations WHERE id = $1 AND owner_id = $2',
    [investigationId, userId]
  );
  if (!investigation.rowCount) return null;
  const [sources, notes, entities, relationships] = await Promise.all([
    pool.query('SELECT source_name, source_url, source_type, collected_at, reliability FROM investigation_sources WHERE investigation_id = $1 ORDER BY collected_at DESC LIMIT 30', [investigationId]),
    pool.query('SELECT body, created_at FROM investigation_notes WHERE investigation_id = $1 ORDER BY created_at DESC LIMIT 30', [investigationId]),
    pool.query('SELECT entity_type, canonical_value, display_label, attributes FROM intelligence_entities WHERE investigation_id = $1 ORDER BY created_at DESC LIMIT 50', [investigationId]),
    pool.query(
      `SELECT r.relation_type, r.confidence, r.rationale, s.source_name, a.display_label AS from_label, b.display_label AS to_label
       FROM intelligence_relationships r
       JOIN intelligence_entities a ON a.id = r.from_entity_id
       JOIN intelligence_entities b ON b.id = r.to_entity_id
       LEFT JOIN investigation_sources s ON s.id = r.source_id
       WHERE r.investigation_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [investigationId]
    )
  ]);
  return {
    investigation: investigation.rows[0],
    sources: sources.rows,
    notes: notes.rows,
    entities: entities.rows,
    relationships: relationships.rows
  };
}

function extractOutputText(body) {
  return (body.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

async function requestModel(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'not_configured' };
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-6.2-sol',
        instructions,
        input,
        max_output_tokens: 1400,
        store: false
      }),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error'
    });
  } catch (error) {
    return { status: 'unreachable', errorCode: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 1_000_000) return { status: 'response_too_large' };
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 1_000_000) return { status: 'response_too_large' };
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { return { status: 'invalid_provider_response' }; }
  if (!response.ok) {
    return {
      status: response.status === 401 || response.status === 403 ? 'invalid_key_or_forbidden'
        : response.status === 429 ? 'rate_limited_or_quota'
        : 'provider_error',
      httpStatus: response.status
    };
  }
  const outputText = extractOutputText(body);
  if (!outputText) return { status: 'empty_response' };
  return { status: 'ok', text: outputText, responseId: body.id || null, model: body.model || process.env.OPENAI_MODEL || 'gpt-6.2-sol' };
}

export function createAiRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.get('/conversations', async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 50',
        [req.user.id]
      );
      res.json({ conversations: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/conversations', requireCsrf, async (req, res, next) => {
    const parsed = conversationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Titre de conversation invalide.' });
    try {
      const result = await pool.query(
        'INSERT INTO ai_conversations(owner_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at',
        [req.user.id, parsed.data.title || 'Nouvelle conversation']
      );
      res.status(201).json({ conversation: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.get('/conversations/:id', async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const owned = await pool.query(
        'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = $1 AND owner_id = $2',
        [req.params.id, req.user.id]
      );
      if (!owned.rowCount) return res.status(404).json({ error: 'Conversation introuvable.' });
      const messages = await pool.query(
        'SELECT id, role, content, metadata, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 100',
        [req.params.id]
      );
      res.json({ conversation: owned.rows[0], messages: messages.rows });
    } catch (error) { next(error); }
  });

  router.post('/conversations/:id/messages', requireCsrf, async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identifiant invalide.' });
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Message invalide.' });
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Assistant IA non configuré. Ajoute OPENAI_API_KEY dans les variables Render.' });

    try {
      const owned = await pool.query(
        'SELECT id FROM ai_conversations WHERE id = $1 AND owner_id = $2',
        [req.params.id, req.user.id]
      );
      if (!owned.rowCount) return res.status(404).json({ error: 'Conversation introuvable.' });

      let caseContext = null;
      if (parsed.data.investigationId) {
        caseContext = await loadCaseContext(parsed.data.investigationId, req.user.id);
        if (!caseContext) return res.status(404).json({ error: 'Dossier associé introuvable.' });
      }

      const previous = await pool.query(
        'SELECT role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12',
        [req.params.id]
      );
      const history = previous.rows.reverse().map(item => ({ role: item.role, content: item.content }));
      const userContent = caseContext
        ? `Question : ${parsed.data.message}\n\nDonnées du dossier que l'utilisateur a choisi de transmettre pour cette analyse :\n${JSON.stringify(caseContext).slice(0, 18000)}`
        : parsed.data.message;
      const input = [...history, { role: 'user', content: userContent }];
      const modelResult = await requestModel(input);
      if (modelResult.status !== 'ok') {
        const statusCode = modelResult.status === 'not_configured' ? 503 : modelResult.status === 'rate_limited_or_quota' ? 429 : 502;
        return res.status(statusCode).json({ error: 'La requête IA n’a pas abouti.', providerStatus: modelResult.status });
      }

      const userMessage = await pool.query(
        'INSERT INTO ai_messages(conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4) RETURNING id, role, content, created_at',
        [req.params.id, 'user', parsed.data.message, { investigationId: parsed.data.investigationId || null }]
      );
      const assistantMessage = await pool.query(
        'INSERT INTO ai_messages(conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4) RETURNING id, role, content, metadata, created_at',
        [req.params.id, 'assistant', modelResult.text, { model: modelResult.model, responseId: modelResult.responseId }]
      );
      await pool.query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1', [req.params.id]);
      res.json({ conversationId: req.params.id, userMessage: userMessage.rows[0], assistantMessage: assistantMessage.rows[0] });
    } catch (error) { next(error); }
  });

  return router;
}
