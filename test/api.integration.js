import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

test('account sessions and private case workflows are isolated by owner', { skip: !process.env.DATABASE_URL, timeout: 90_000 }, async t => {
  process.env.NODE_ENV = 'test';
  for (const key of ['VIRUSTOTAL_API_KEY', 'ABUSEIPDB_API_KEY', 'SHODAN_API_KEY', 'CENSYS_API_ID', 'CENSYS_API_SECRET', 'HIBP_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
  const { app } = await import('../src/server.js');
  const { pool } = await import('../src/db.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = randomUUID();
  const email1 = `analyst-${suffix}@example.test`;
  const email2 = `other-${suffix}@example.test`;
  let userId1 = null;
  let userId2 = null;

  async function request(path, { cookie, csrf, ...options } = {}) {
    const headers = new Headers(options.headers || {});
    if (cookie) headers.set('Cookie', cookie);
    if (csrf) headers.set('X-CSRF-Token', csrf);
    const response = await fetch(base + path, { ...options, headers, signal: AbortSignal.timeout(10_000) });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  t.after(async () => {
    if (userId1 || userId2) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId1, userId2].filter(Boolean)]);
    }
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });

  t.diagnostic('Checking health and database readiness');
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  const ready = await request('/api/ready');
  assert.equal(ready.response.status, 200);
  const aiSchema = await pool.query("SELECT to_regclass('public.ai_conversations') AS conversations, to_regclass('public.ai_messages') AS messages");
  assert.ok(aiSchema.rows[0].conversations);
  assert.ok(aiSchema.rows[0].messages);
  const imageSchema = await pool.query("SELECT to_regclass('public.image_records') AS images");
  assert.ok(imageSchema.rows[0].images);

  t.diagnostic('Registering first user');
  const reg1 = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email1, displayName: 'Analyste test', password: 'Correct-Horse-Battery-42!' })
  });
  assert.equal(reg1.response.status, 201, JSON.stringify(reg1.data));
  userId1 = reg1.data.user.id;
  const cookie1 = reg1.response.headers.get('set-cookie').split(';')[0];
  const csrf1 = reg1.data.csrfToken;

  const aiConversation = await request('/api/ai/conversations', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Analyse de test' })
  });
  assert.equal(aiConversation.response.status, 201);
  const aiConversationId = aiConversation.data.conversation.id;
  const aiUnavailable = await request(`/api/ai/conversations/${aiConversationId}/messages`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Analyse les éléments disponibles.' })
  });
  assert.equal(aiUnavailable.response.status, 503);
  const aiMessages = await request(`/api/ai/conversations/${aiConversationId}`, { cookie: cookie1 });
  assert.equal(aiMessages.response.status, 200);
  assert.equal(aiMessages.data.messages.length, 0);

  const threatHash = await request('/api/threat/hash/' + 'b'.repeat(64), { cookie: cookie1 });
  assert.equal(threatHash.response.status, 200);
  assert.equal(threatHash.data.status, 'not_configured');
  const privateThreatIp = await request('/api/threat/ip/127.0.0.1', { cookie: cookie1 });
  assert.equal(privateThreatIp.response.status, 400);

  const providers = await request('/api/integrations', { cookie: cookie1 });
  assert.equal(providers.response.status, 200);
  assert.ok(Array.isArray(providers.data.providers));
  assert.equal(JSON.stringify(providers.data).includes('sk-'), false);
  const providerTest = await request('/api/integrations/virustotal/test', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(providerTest.response.status, 200);
  assert.equal(providerTest.data.status, 'not_configured');

  const hashSearch = await request('/api/search', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'a'.repeat(64), saveToHistory: true })
  });
  assert.equal(hashSearch.response.status, 200);
  assert.equal(hashSearch.data.type, 'hash');
  assert.ok(hashSearch.data.historyId);
  const history = await request('/api/search/history', { cookie: cookie1 });
  assert.equal(history.response.status, 200);
  assert.equal(history.data.history.length, 1);

  const noCsrf = await request('/api/investigations', {
    method: 'POST', cookie: cookie1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Dossier sans CSRF' })
  });
  assert.equal(noCsrf.response.status, 403);

  t.diagnostic('Creating an investigation and checking CSRF');
  const createCase = await request('/api/investigations', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Audit domaine de test', objective: 'Vérifier les DNS publics' })
  });
  assert.equal(createCase.response.status, 201, JSON.stringify(createCase.data));
  const caseId = createCase.data.investigation.id;

  t.diagnostic('Registering second user and checking owner isolation');
  const reg2 = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email2, displayName: 'Autre utilisateur', password: 'Different-Horse-Battery-51!' })
  });
  assert.equal(reg2.response.status, 201, JSON.stringify(reg2.data));
  userId2 = reg2.data.user.id;
  const cookie2 = reg2.response.headers.get('set-cookie').split(';')[0];

  const forbidden = await request(`/api/investigations/${caseId}`, { cookie: cookie2 });
  assert.equal(forbidden.response.status, 404);

  t.diagnostic('Saving notes and sources');
  const note = await request(`/api/investigations/${caseId}/notes`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'Note de test vérifiée.' })
  });
  assert.equal(note.response.status, 201);

  const source = await request(`/api/investigations/${caseId}/sources`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceName: 'Documentation de test', sourceUrl: 'https://example.com', reliability: 'unknown' })
  });
  assert.equal(source.response.status, 201);

  const domainEntity = await request(`/api/investigations/${caseId}/entities`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType: 'domain', canonicalValue: 'example.com', displayLabel: 'example.com' })
  });
  assert.equal(domainEntity.response.status, 201);
  const technologyEntity = await request(`/api/investigations/${caseId}/entities`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType: 'technology', canonicalValue: 'nginx', displayLabel: 'nginx' })
  });
  assert.equal(technologyEntity.response.status, 201);
  const relationship = await request(`/api/investigations/${caseId}/relationships`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromEntityId: domainEntity.data.entity.id,
      toEntityId: technologyEntity.data.entity.id,
      relationType: 'uses_technology',
      sourceId: source.data.source.id,
      confidence: 0.85,
      rationale: 'La source de test documente cette technologie pour le domaine.'
    })
  });
  assert.equal(relationship.response.status, 201, JSON.stringify(relationship.data));
  const graph = await request(`/api/investigations/${caseId}/graph`, { cookie: cookie1 });
  assert.equal(graph.response.status, 200);
  assert.equal(graph.data.entities.length, 2);
  assert.equal(graph.data.relationships.length, 1);

  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 70, g: 110, b: 150 } } }).png().toBuffer();
  const imageForm = new FormData();
  imageForm.append('image', new Blob([png], { type: 'image/png' }), 'sample.png');
  imageForm.append('investigationId', caseId);
  const imageAnalysis = await request('/api/osint/image', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    body: imageForm
  });
  assert.equal(imageAnalysis.response.status, 201, JSON.stringify(imageAnalysis.data));
  assert.equal(imageAnalysis.data.file.mimeType, 'image/png');
  assert.ok(imageAnalysis.data.sha256);
  assert.equal(Object.hasOwn(imageAnalysis.data.metadata.exif, 'GPSLatitude'), false);

  const duplicateForm = new FormData();
  duplicateForm.append('image', new Blob([png], { type: 'image/png' }), 'sample-copy.png');
  duplicateForm.append('investigationId', caseId);
  const duplicateAnalysis = await request('/api/osint/image', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    body: duplicateForm
  });
  assert.equal(duplicateAnalysis.response.status, 201);
  assert.equal(duplicateAnalysis.data.duplicateCount, 1);

  const generatedReport = await request(`/api/reports/investigations/${caseId}`, {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'json' })
  });
  assert.equal(generatedReport.response.status, 200);
  assert.ok(generatedReport.data.investigation);
  const reportHistory = await request(`/api/reports/investigations/${caseId}`, { cookie: cookie1 });
  assert.equal(reportHistory.response.status, 200);
  assert.equal(reportHistory.data.reports.length, 1);

  const dashboard = await request('/api/dashboard/summary', { cookie: cookie1 });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.investigations, 1);
  assert.equal(dashboard.data.entities, 2);
  assert.equal(dashboard.data.reports, 1);

  const invalidId = await request('/api/investigations/not-a-uuid', { cookie: cookie1 });
  assert.equal(invalidId.response.status, 400);

  t.diagnostic('Archiving dossier and revoking session');
  const archived = await request(`/api/investigations/${caseId}`, {
    method: 'PATCH', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'archived' })
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.data.investigation.status, 'archived');

  const logout = await request('/api/auth/logout', {
    method: 'POST', cookie: cookie1, csrf: csrf1,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(logout.response.status, 200);
  const afterLogout = await request('/api/auth/me', { cookie: cookie1 });
  assert.equal(afterLogout.response.status, 401);
});
