import test from 'node:test';
import assert from 'node:assert/strict';

const validDomain = value =>
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);

test('accepts a normal public domain', () => {
  assert.equal(validDomain('example.com'), true);
});

test('rejects malformed domains', () => {
  assert.equal(validDomain('not a domain'), false);
  assert.equal(validDomain('-bad.example'), false);
  assert.equal(validDomain('localhost'), false);
});
