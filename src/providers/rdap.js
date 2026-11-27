export async function lookupRdapIp(address) {
  const endpoint = `https://rdap.org/ip/${encodeURIComponent(address)}`;
  const response = await fetch(endpoint, {
    headers: { 'Accept': 'application/rdap+json, application/json', 'User-Agent': 'OSINT-HUB-ULTIMATE/0.2' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`RDAP HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 750_000) throw new Error('Réponse RDAP trop volumineuse');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 750_000) throw new Error('Réponse RDAP trop volumineuse');
  const data = JSON.parse(text);

  return {
    name: data.name || null,
    handle: data.handle || null,
    country: data.country || null,
    startAddress: data.startAddress || null,
    endAddress: data.endAddress || null,
    ipVersion: data.ipVersion || null,
    type: data.type || null,
    events: Array.isArray(data.events) ? data.events.slice(0, 10).map(event => ({
      action: event.eventAction || null,
      date: event.eventDate || null
    })) : [],
    entityRoles: Array.isArray(data.entities)
      ? [...new Set(data.entities.flatMap(entity => Array.isArray(entity.roles) ? entity.roles : []))].slice(0, 20)
      : []
  };
}
