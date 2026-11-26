import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { lookupThreatIntel } from '../providers/threat-intel.js';

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const hashPattern = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;

export function createThreatRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }));

  router.get('/ip/:address', async (req, res) => {
    const address = req.params.address;
    try {
      if (!ipaddr.isValid(address) || ipaddr.parse(address).range() !== 'unicast') {
        return res.status(400).json({ error: 'Une IP publique est requise.' });
      }
    } catch { return res.status(400).json({ error: 'Adresse IP invalide.' }); }
    const result = await lookupThreatIntel('ip', address);
    res.json({ target: address, type: 'ip', collectedAt: new Date().toISOString(), ...result, caveat: 'La réputation est fournie par les fournisseurs et peut contenir des faux positifs. Elle ne prouve pas une activité malveillante.' });
  });

  router.get('/domain/:domain', async (req, res) => {
    const domain = z.string().trim().toLowerCase().max(253).regex(domainPattern).safeParse(req.params.domain);
    if (!domain.success) return res.status(400).json({ error: 'Nom de domaine invalide.' });
    const result = await lookupThreatIntel('domain', domain.data);
    res.json({ target: domain.data, type: 'domain', collectedAt: new Date().toISOString(), ...result, caveat: 'Les scores et catégories sont des signaux de fournisseurs, pas une preuve de compromission.' });
  });

  router.get('/hash/:hash', async (req, res) => {
    const hash = req.params.hash.toLowerCase();
    if (!hashPattern.test(hash)) return res.status(400).json({ error: 'Hash MD5, SHA-1 ou SHA-256 attendu.' });
    const result = await lookupThreatIntel('hash', hash);
    res.json({ target: hash, type: 'hash', collectedAt: new Date().toISOString(), ...result, caveat: 'Aucun fichier n’est téléchargé ni exécuté. Les verdicts externes peuvent être incomplets.' });
  });

  return router;
}
