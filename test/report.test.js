import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { renderReport, streamPdf } from '../src/reports/generator.js';

const sample = {
  title: 'Rapport de test',
  generatedAt: '2026-11-26T12:00:00.000Z',
  investigation: { title: 'Dossier test', description: '<script>alert(1)</script>', objective: 'Vérifier les sources' },
  sources: [{ source_name: 'Source publique', source_url: 'https://example.com', source_type: 'web', collected_at: '2026-11-26T10:00:00.000Z', reliability: 'high', notes: '' }],
  notes: [{ body: 'Note de test', created_at: '2026-11-26T11:00:00.000Z' }],
  entities: [{ id: '1', entity_type: 'domain', canonical_value: 'example.com', display_label: 'example.com', attributes: {}, created_at: '2026-11-26T10:00:00.000Z' }],
  relationships: [{ from_label: 'example.com', to_label: 'nginx', relation_type: 'uses_technology', confidence: 0.8, source_name: 'Source publique', rationale: 'La source décrit cette technologie.', created_at: '2026-11-26T10:00:00.000Z' }]
};

test('renders escaped HTML and structured Markdown, JSON and CSV reports', () => {
  const html = renderReport('html', sample);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(renderReport('markdown', sample), /## Sources/);
  assert.match(renderReport('json', sample), /"investigation"/);
  assert.match(renderReport('csv', sample), /"relationship"/);
});

test('renders a valid PDF stream', async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const ended = once(output, 'end');
  streamPdf(output, sample);
  await ended;
  const pdf = Buffer.concat(chunks);
  assert.ok(pdf.subarray(0, 5).toString('ascii') === '%PDF-');
});
