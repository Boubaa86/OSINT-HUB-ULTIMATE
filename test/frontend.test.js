import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8')
]);

test('static frontend applies a restrictive CSP and loads its API config first', () => {
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(csp, 'Content Security Policy meta tag should exist');
  assert.match(csp[1], /default-src 'self'/);
  assert.match(csp[1], /script-src 'self'/);
  assert.match(csp[1], /object-src 'none'/);
  assert.match(csp[1], /https:\/\/osint-hub-api\.onrender\.com/);
  const configPosition = html.indexOf('<script src="/config.js"></script>');
  const appPosition = html.indexOf('<script src="/app.js" defer></script>');
  assert.ok(configPosition >= 0 && appPosition > configPosition);
});

test('dashboard stat IDs match the frontend implementation', () => {
  for (const id of ['module-count', 'investigation-count', 'entity-count', 'entity-report-summary', 'system-state', 'system-state-detail']) {
    assert.ok(html.includes(`id="${id}"`), `missing HTML node: ${id}`);
  }
  for (const id of ['investigation-count', 'entity-count', 'entity-report-summary', 'system-state', 'system-state-detail']) {
    assert.ok(app.includes(`$('#${id}')`), `frontend does not update: ${id}`);
  }
  assert.doesNotMatch(app, /#stat-investigations|#stat-entities|#stat-reports/);
});
