import test from 'node:test';
import assert from 'node:assert/strict';
import ipaddr from 'ipaddr.js';

function publicIp(value) {
  if (typeof value !== 'string' || !ipaddr.isValid(value)) return false;
  try { return ipaddr.parse(value).range() === 'unicast'; } catch { return false; }
}

test('accepts public IPv4 and IPv6 addresses', () => {
  assert.equal(publicIp('8.8.8.8'), true);
  assert.equal(publicIp('2606:4700:4700::1111'), true);
});

test('rejects private, loopback, link-local and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fc00::1', 'fe80::1', '224.0.0.1']) {
    assert.equal(publicIp(address), false, address);
  }
});
