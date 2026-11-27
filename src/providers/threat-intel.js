const USER_AGENT = 'OSINT-HUB-ULTIMATE/0.2';

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(8_000),
    redirect: 'error'
  });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 750_000) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new Error('PROVIDER_INVALID_JSON'); }
  return { response, body };
}

export async function lookupVirusTotal(kind, value) {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) return { status: 'not_configured' };
  const path = kind === 'ip' ? `ip_addresses/${encodeURIComponent(value)}`
    : kind === 'domain' ? `domains/${encodeURIComponent(value)}`
    : `files/${encodeURIComponent(value)}`;
  try {
    const { response, body } = await fetchJson(`https://www.virustotal.com/api/v3/${path}`, { 'x-apikey': key });
    if (!response.ok) return { status: response.status === 401 || response.status === 403 ? 'invalid_key_or_forbidden' : 'http_error', httpStatus: response.status };
    const attributes = body.data?.attributes || {};
    return {
      status: 'ok',
      httpStatus: response.status,
      data: {
        reputation: attributes.reputation ?? null,
        lastAnalysisStats: attributes.last_analysis_stats || null,
        country: attributes.country || null,
        asOwner: attributes.as_owner || null,
        network: attributes.network || null,
        registrar: attributes.registrar || null,
        categories: attributes.categories || null,
        typeDescription: attributes.type_description || null,
        size: attributes.size || null,
        firstSubmissionDate: attributes.first_submission_date || null,
        lastAnalysisDate: attributes.last_analysis_date || null
      }
    };
  } catch (error) {
    return { status: 'unreachable', errorCode: error.name === 'TimeoutError' ? 'TIMEOUT' : error.message || 'NETWORK_ERROR' };
  }
}

export async function lookupAbuseIp(address) {
  const key = process.env.ABUSEIPDB_API_KEY;
  if (!key) return { status: 'not_configured' };
  const url = new URL('https://api.abuseipdb.com/api/v2/check');
  url.searchParams.set('ipAddress', address);
  url.searchParams.set('maxAgeInDays', '90');
  try {
    const { response, body } = await fetchJson(url, { Key: key });
    if (!response.ok) return { status: response.status === 401 || response.status === 403 ? 'invalid_key_or_forbidden' : 'http_error', httpStatus: response.status };
    const data = body.data || {};
    return {
      status: 'ok',
      httpStatus: response.status,
      data: {
        ipAddress: data.ipAddress || address,
        isPublic: data.isPublic ?? null,
        abuseConfidenceScore: data.abuseConfidenceScore ?? null,
        countryCode: data.countryCode || null,
        usageType: data.usageType || null,
        isp: data.isp || null,
        domain: data.domain || null,
        totalReports: data.totalReports ?? null,
        lastReportedAt: data.lastReportedAt || null
      }
    };
  } catch (error) {
    return { status: 'unreachable', errorCode: error.name === 'TimeoutError' ? 'TIMEOUT' : error.message || 'NETWORK_ERROR' };
  }
}

export async function lookupThreatIntel(kind, value) {
  const checks = [lookupVirusTotal(kind, value)];
  if (kind === 'ip') checks.push(lookupAbuseIp(value));
  const names = kind === 'ip' ? ['VirusTotal', 'AbuseIPDB'] : ['VirusTotal'];
  const results = await Promise.all(checks);
  const configured = results.some(result => result.status !== 'not_configured');
  return {
    status: configured ? (results.some(result => result.status === 'ok') ? 'completed' : 'provider_error') : 'not_configured',
    providers: results.map((result, index) => ({ name: names[index], ...result }))
  };
}
