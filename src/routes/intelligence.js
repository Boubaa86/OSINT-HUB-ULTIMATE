import { Router } from 'express';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../auth.js';
import { lookupCertificateNames } from '../providers/certificate-transparency.js';
import { lookupRdapIp } from '../providers/rdap.js';

const emailSchema = z.string().trim().email().max(254);
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
  router.use(rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.post('/phone', async (req, res) => {
    const parsed = z.object({
      phone: z.string().trim().min(3).max(40),
      defaultCountry: z.string().trim().length(2).toUpperCase().optional()
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    const phone = parsePhoneNumberFromString(parsed.data.phone, parsed.data.defaultCountry);
    if (!phone || !phone.isPossible()) {
      return res.status(400).json({ error: 'Numéro impossible à interpréter avec les informations fournies.' });
    }
    res.json({
      input: parsed.data.phone,
      international: phone.formatInternational(),
      national: phone.formatNational(),
      country: phone.country || null,
      callingCode: phone.countryCallingCode,
      numberType: phone.getType() || 'unknown',
      validAccordingToNumberingPlan: phone.isValid(),
      source: 'libphonenumber-js numbering metadata',
      collectedAt: new Date().toISOString(),
      caveat: 'Ces métadonnées décrivent le plan de numérotation. Elles ne révèlent ni le propriétaire, ni la position, ni l’opérateur actuel du numéro.'
    });
  });

  router.post('/email', async (req, res) => {
    const parsed = z.object({ email: emailSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    const email = parsed.data.email.toLowerCase();
    const domain = email.split('@').at(-1);
    try {
      const mx = await dns.resolveMx(domain);
      res.json({
        email,
        syntaxValid: true,
        domain,
        mx: mx.sort((a, b) => a.priority - b.priority),
        mxStatus: mx.length ? 'found' : 'not_found',
        collectedAt: new Date().toISOString(),
        source: 'DNS MX resolver',
        caveat: 'Cette vérification confirme uniquement la syntaxe et la configuration MX du domaine. Elle ne vérifie pas l’existence de la boîte, son propriétaire ou une fuite de données.'
      });
    } catch (error) {
      res.json({
        email,
        syntaxValid: true,
        domain,
        mx: [],
        mxStatus: 'lookup_error',
        errorCode: error.code || 'DNS_ERROR',
        collectedAt: new Date().toISOString(),
        source: 'DNS MX resolver',
        caveat: 'Une erreur DNS ne prouve pas que la boîte e-mail existe ou non.'
      });
    }
  });

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
