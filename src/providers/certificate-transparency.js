const MAX_RESPONSE_BYTES = 1_500_000;

export async function lookupCertificateNames(domain) {
  const endpoint = new URL('https://crt.sh/');
  endpoint.searchParams.set('q', `%.${domain}`);
  endpoint.searchParams.set('output', 'json');

  const response = await fetch(endpoint, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'OSINT-HUB-ULTIMATE/0.2' },
    signal: AbortSignal.timeout(8_000),
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`crt.sh HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Réponse CT trop volumineuse');

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Réponse CT trop volumineuse');
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('Format CT inattendu');

  const suffix = `.${domain.toLowerCase()}`;
  const names = new Map();
  for (const row of rows) {
    const candidates = String(row.name_value || '').split(/\r?\n/);
    for (const raw of candidates) {
      const name = raw.trim().toLowerCase().replace(/^\*\./, '');
      if (!name || (name !== domain.toLowerCase() && !name.endsWith(suffix))) continue;
      if (!names.has(name)) names.set(name, {
        name,
        issuer: String(row.issuer_name || '').slice(0, 240),
        firstSeen: row.not_before || null,
        lastSeen: row.not_after || null
      });
    }
  }
  return [...names.values()].slice(0, 150);
}
