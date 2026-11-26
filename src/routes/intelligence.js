import { Router } from 'express';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { lookupCertificateNames } from '../providers/certificate-transparency.js';
import { lookupRdapIp } from '../providers/rdap.js';

const domainSchema = z.string().trim().toLowerCase().max(253).regex(
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
  'Nom de domaine invalide'
);

function publicIpSchema(value) {
  if (typeof value !== 'string' || !ipaddr.isValid(value)) return false;
  try {
    return ipaddr.parse(value).range() === 'unicast';
  } catch {
    return false;
  }
}

async function dnsRecords(domain) {
  const types = [
    ['A', () => dns.resolve4(domain)],
    ['AAAA', () => dns.resolve6(domain)],
    ['MX', () => dns.resolveMx(domain)],
    ['NS', () => dns.resolveNs(domain)],
    ['TXT', () => dns.resolveTxt(domain)]
  ];
  const settled = await Promise.allSettled(types.map(([, run]) => run()));
  return Object.fromEntries(types.map(([type], index) => {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      const values = type === 'TXT' ? result.value.map(row => row.join('')) : result.value;
      return [type, { status: 'ok', values }];
    }
    return [type, { status: 'error', code: result.reason?.code || 'DNS_ERROR' }];
  }));
}

export function createIntelligenceRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/domain/:domain', async (req, res, next) => {
    const parsed = domainSchema.safeParse(req.params.domain);
    if (!parsed.success) return res.status(400).json({ error: 'Nom de domaine invalide.' });
    const domain = parsed.data;
    const [dnsResult, certificateResult] = await Promise.allSettled([
      dnsRecords(domain),
      lookupCertificateNames(domain)
    ]);
    res.json({
      target: domain,
      collectedAt: new Date().toISOString(),
      sources: [
        { name: 'DNS resolver', status: dnsResult.status === 'fulfilled' ? 'ok' : 'error' },
        { name: 'crt.sh Certificate Transparency', status: certificateResult.status === 'fulfilled' ? 'ok' : 'error' }
      ],
      dns: dnsResult.status === 'fulfilled' ? dnsResult.value : {},
      certificateNames: certificateResult.status === 'fulfilled' ? certificateResult.value : [],
      errors: [
        ...(dnsResult.status === 'rejected' ? [{ source: 'DNS', code: 'DNS_LOOKUP_FAILED' }] : []),
        ...(certificateResult.status === 'rejected' ? [{ source: 'crt.sh', code: 'CT_LOOKUP_FAILED' }] : [])
      ],
      caveat: 'Les certificats historiques indiquent des noms présents dans des journaux publics ; ils ne prouvent ni propriété actuelle ni contrôle actuel du domaine.'
    });
  });

  router.get('/ip/:address', async (req, res) => {
    const address = req.params.address;
    if (!publicIpSchema(address)) {
      return res.status(400).json({ error: 'Adresse IP publique valide requise. Les adresses privées, réservées et locales sont refusées.' });
    }
    const [rdapResult, reverseResult] = await Promise.allSettled([
      lookupRdapIp(address),
      dns.reverse(address)
    ]);
    res.json({
      target: address,
      collectedAt: new Date().toISOString(),
      sources: [
        { name: 'RDAP public', status: rdapResult.status === 'fulfilled' ? 'ok' : 'error' },
        { name: 'Reverse DNS', status: reverseResult.status === 'fulfilled' ? 'ok' : 'error' }
      ],
      registration: rdapResult.status === 'fulfilled' ? rdapResult.value : null,
      reverseDns: reverseResult.status === 'fulfilled' ? reverseResult.value : [],
      errors: [
        ...(rdapResult.status === 'rejected' ? [{ source: 'RDAP', code: 'RDAP_LOOKUP_FAILED' }] : []),
        ...(reverseResult.status === 'rejected' ? [{ source: 'Reverse DNS', code: 'PTR_LOOKUP_FAILED' }] : [])
      ],
      caveat: 'Les données RDAP et reverse DNS peuvent être incomplètes ou anciennes. Elles ne donnent pas une localisation précise d’une personne ou d’un appareil.'
    });
  });

  return router;
}
