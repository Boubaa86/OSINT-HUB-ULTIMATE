import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, hashOpaqueToken, safeEqualBuffers, createOpaqueToken } from '../src/security/credentials.js';

test('password hashes verify without storing the original password', async () => {
  const password = 'Correct-Horse-Battery-42!';
  const encoded = await hashPassword(password);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('incorrect-password', encoded), false);
});

test('opaque tokens are random and stored as one-way hashes', () => {
  const token = createOpaqueToken();
  assert.ok(token.length >= 40);
  assert.equal(safeEqualBuffers(hashOpaqueToken(token), hashOpaqueToken(token)), true);
  assert.equal(safeEqualBuffers(hashOpaqueToken(token), hashOpaqueToken('different')), false);
});
