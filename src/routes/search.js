import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { lookupCertificateNames } from '../providers/certificate-transparency.js';
import { lookupRdapIp } from '../providers/rdap.js';

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const inputSchema = z.object({
  query: z.string().trim().min(1).max(2048),
  saveToHistory: z.boolean().optional().default(false)
});

function isPublicIp(value) {
  try { return ipaddr.isValid(value) && ipaddr.parse(value).range() === 'unicast'; }
  catch { return false; }
}

async function analyzeDomain(domain) {
  const types = [
    ['A', () => dns.resolve4(domain)],
    ['AAAA', () => dns.resolve6(domain)],
    ['MX', () => dns.resolveMx(domain)],
    ['NS', () => dns.resolveNs(domain)],
    ['TXT', () => dns.resolveTxt(domain)]
  ];
  const settled = await Promise.allSettled(types.map(([, run]) => run()));
  const records = Object.fromEntries(types.map(([type], index) => {
    const item = settled[index];
    if (item.status === 'rejected') return [type, { status: 'error', code: item.reason?.code || 'DNS_ERROR' }];
    return [type, { status: 'ok', values: type === 'TXT' ? item.value.map(row => row.join('')) : item.value }];
  }));
  const certificates = await lookupCertificateNames(domain).then(value => ({ status: 'ok', value })).catch(() => ({ status: 'error', value: [] }));
  return { domain, records, certificateTransparency: certificates, caveat: 'DNS et journaux de certificats publics ne prouvent pas la propriété actuelle du domaine.' };
}

async function analyzeIp(address) {
  const [rdap, ptr] = await Promise.allSettled([lookupRdapIp(address), dns.reverse(address)]);
  return {
    address,
    registration: rdap.status === 'fulfilled' ? rdap.value : null,
    reverseDns: ptr.status === 'fulfilled' ? ptr.value : [],
    sourceStatus: { rdap: rdap.status, reverseDns: ptr.status },
    caveat: 'Les données IP sont approximatives et ne permettent pas d’identifier ou de localiser précisément une personne.'
  };
}

async function analyzeEmail(email) {
  const domain = email.split('@').at(-1);
  try {
    const mx = await dns.resolveMx(domain);
    return { email, syntaxValid: true, domain, mx, mxStatus: mx.length ? 'found' : 'not_found', caveat: 'La boîte e-mail et son propriétaire ne sont pas vérifiés.' };
  } catch (error) {
    return { email, syntaxValid: true, domain, mx: [], mxStatus: ['ENODATA', 'ENOTFOUND'].includes(error.code) ? 'not_found' : 'lookup_error', caveat: 'La syntaxe est valide ; une réponse DNS ne prouve pas l’existence de la boîte.' };
  }
}

function analyzePhone(value) {
  const phone = parsePhoneNumberFromString(value);
  if (!phone || !phone.isPossible()) return null;
  return {
    international: phone.formatInternational(),
    national: phone.formatNational(),
    country: phone.country || null,
    callingCode: phone.countryCallingCode,
    numberType: phone.getType() || 'unknown',
    validAccordingToNumberingPlan: phone.isValid(),
    caveat: 'Métadonnées de numérotation uniquement : aucun propriétaire, opérateur actuel ou emplacement n’est recherché.'
  };
}

export function createSearchRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.get('/history', async (req, res, next) => {
    try {
      const result = await pool.query(
        'SELECT id, query_type, query_value, created_at FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
        [req.user.id]
      );
      res.json({ history: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/', async (req, res, next) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Recherche invalide.' });
    const query = parsed.data.query;
    let type = 'unsupported';
    let result = null;
    let sources = [];

    try {
      if (/^https?:\/\//i.test(query)) {
        let url;
        try { url = new URL(query); } catch { return res.status(400).json({ error: 'URL invalide.' }); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          return res.status(400).json({ error: 'URL HTTP(S) publique requise.' });
        }
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (ipaddr.isValid(host)) {
          if (!isPublicIp(host)) return res.status(400).json({ error: 'Les IP privées ou réservées sont refusées.' });
          type = 'ip';
          result = await analyzeIp(host);
          sources = ['RDAP public', 'Reverse DNS'];
        } else if (domainPattern.test(host)) {
          type = 'url';
          result = { url: url.toString(), hostAnalysis: await analyzeDomain(host) };
          sources = ['DNS resolver', 'crt.sh Certificate Transparency'];
        }
      } else if (ipaddr.isValid(query)) {
        if (!isPublicIp(query)) return res.status(400).json({ error: 'Les IP privées ou réservées sont refusées.' });
        type = 'ip';
        result = await analyzeIp(query);
        sources = ['RDAP public', 'Reverse DNS'];
      } else if (z.string().email().safeParse(query).success) {
        type = 'email';
        result = await analyzeEmail(query.toLowerCase());
        sources = ['DNS MX resolver'];
      } else if (/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(query)) {
        type = 'hash';
        result = { hash: query.toLowerCase(), status: 'classified', providerStatus: 'not_configured', note: 'Aucun fournisseur de réputation de hash n’est configuré.' };
        sources = [];
      } else if (domainPattern.test(query)) {
        type = 'domain';
        result = await analyzeDomain(query.toLowerCase());
        sources = ['DNS resolver', 'crt.sh Certificate Transparency'];
      } else {
        const phone = analyzePhone(query);
        if (phone) {
          type = 'phone';
          result = phone;
          sources = ['libphonenumber-js numbering metadata'];
        }
      }

      let historyId = null;
      if (parsed.data.saveToHistory) {
        const saved = await pool.query(
          'INSERT INTO search_history(user_id, query_type, query_value) VALUES ($1, $2, $3) RETURNING id',
          [req.user.id, type, query]
        );
        historyId = saved.rows[0].id;
        if (result) {
          await pool.query(
            'INSERT INTO search_results(search_id, source_name, result_data) VALUES ($1, $2, $3)',
            [historyId, sources.join(', ') || 'classification only', result]
          );
        }
      }

      res.json({
        query,
        type,
        status: result ? 'completed' : 'unsupported',
        result,
        sources,
        historyId,
        collectedAt: new Date().toISOString(),
        note: result ? 'Les résultats sont limités aux sources listées ; une absence de résultat ne prouve rien.' : 'Aucun module autorisé ne reconnaît encore cette recherche.'
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
