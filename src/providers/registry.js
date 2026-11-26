const PROVIDERS = [
  { id: 'virustotal', name: 'VirusTotal', env: ['VIRUSTOTAL_API_KEY'], capabilities: ['IP', 'domain', 'URL', 'hash'], testable: true },
  { id: 'abuseipdb', name: 'AbuseIPDB', env: ['ABUSEIPDB_API_KEY'], capabilities: ['IP reputation'], testable: true },
  { id: 'shodan', name: 'Shodan', env: ['SHODAN_API_KEY'], capabilities: ['Internet-exposed asset metadata'], testable: true },
  { id: 'censys', name: 'Censys', env: ['CENSYS_API_ID', 'CENSYS_API_SECRET'], capabilities: ['Internet asset metadata'], testable: false },
  { id: 'hibp', name: 'Have I Been Pwned', env: ['HIBP_API_KEY'], capabilities: ['Authorized breach-notification checks'], testable: true },
  { id: 'openai', name: 'OpenAI', env: ['OPENAI_API_KEY'], capabilities: ['AI analysis'], testable: true }
];

export function listProviders() {
  return PROVIDERS.map(provider => ({
    id: provider.id,
    name: provider.name,
    capabilities: provider.capabilities,
    configured: provider.env.every(name => Boolean(process.env[name])),
    testable: provider.testable,
    configuration: provider.env.map(name => ({ variable: name, configured: Boolean(process.env[name]) }))
  }));
}

export async function testProvider(providerId) {
  const provider = PROVIDERS.find(item => item.id === providerId);
  if (!provider) return { status: 'unknown_provider' };
  if (!provider.env.every(name => Boolean(process.env[name]))) {
    return { status: 'not_configured', provider: provider.id };
  }
  if (!provider.testable) {
    return { status: 'manual_test_required', provider: provider.id, message: 'La configuration est détectée ; le test automatique n’est pas encore disponible.' };
  }

  const started = Date.now();
  let url;
  const headers = { 'User-Agent': 'OSINT-HUB-ULTIMATE/0.2', 'Accept': 'application/json' };

  if (provider.id === 'virustotal') {
    url = 'https://www.virustotal.com/api/v3/ip_addresses/8.8.8.8';
    headers['x-apikey'] = process.env.VIRUSTOTAL_API_KEY;
  } else if (provider.id === 'abuseipdb') {
    url = 'https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=90';
    headers.Key = process.env.ABUSEIPDB_API_KEY;
  } else if (provider.id === 'shodan') {
    const endpoint = new URL('https://api.shodan.io/api-info');
    endpoint.searchParams.set('key', process.env.SHODAN_API_KEY);
    url = endpoint;
  } else if (provider.id === 'hibp') {
    url = 'https://haveibeenpwned.com/api/v3/breaches';
    headers['hibp-api-key'] = process.env.HIBP_API_KEY;
  } else if (provider.id === 'openai') {
    url = 'https://api.openai.com/v1/models';
    headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
  }

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000), redirect: 'error' });
    const latencyMs = Date.now() - started;
    return {
      provider: provider.id,
      status: response.ok ? 'connected' : response.status === 401 || response.status === 403 ? 'invalid_key_or_forbidden' : 'http_error',
      httpStatus: response.status,
      latencyMs
    };
  } catch (error) {
    return {
      provider: provider.id,
      status: 'unreachable',
      latencyMs: Date.now() - started,
      errorCode: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR'
    };
  }
}
