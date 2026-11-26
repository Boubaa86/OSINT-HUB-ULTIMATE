import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:']
    }
  }
}));
app.use(express.json({ limit: '32kb' }));
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

const domainSchema = z.object({
  domain: z.string().trim().min(1).max(253).transform(value => value.toLowerCase())
});
const validDomain = value =>
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'osint-hub-ultimate',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/modules', (_req, res) => {
  res.json({ modules: [
    { id: 'domain-dns', name: 'DNS public', status: 'available', scope: 'Résolution DNS passive' },
    { id: 'ip-intel', name: 'Renseignement IP', status: 'planned', scope: 'Sources publiques et géolocalisation approximative' },
    { id: 'email', name: 'Analyse e-mail', status: 'planned', scope: 'Syntaxe, domaine et API autorisées' },
    { id: 'username', name: 'Pseudonymes publics', status: 'planned', scope: 'Profils publics via sources autorisées' },
    { id: 'image', name: 'Analyse d’images', status: 'planned', scope: 'Métadonnées, dimensions et SHA-256' },
    { id: 'graph', name: 'Graphe de relations', status: 'planned', scope: 'Relations sourcées et niveaux de confiance' }
  ] });
});

app.post('/api/osint/dns', async (req, res) => {
  const parsed = domainSchema.safeParse(req.body);
  if (!parsed.success || !validDomain(parsed.data?.domain || '')) {
    return res.status(400).json({ error: 'Nom de domaine invalide.' });
  }

  const domain = parsed.data.domain;
  const results = await Promise.allSettled([
    dns.resolve4(domain),
    dns.resolve6(domain),
    dns.resolveMx(domain),
    dns.resolveNs(domain),
    dns.resolveTxt(domain)
  ]);
  const value = result => result.status === 'fulfilled' ? result.value : [];
  const records = {
    A: value(results[0]),
    AAAA: value(results[1]),
    MX: value(results[2]),
    NS: value(results[3]),
    TXT: value(results[4]).map(row => row.join(''))
  };

  res.json({
    domain,
    records,
    source: 'DNS resolver',
    collectedAt: new Date().toISOString(),
    caveat: 'Résultats DNS publics ; ils ne prouvent pas une propriété ou une relation entre entités.'
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OSINT HUB listening on ${PORT}`);
});
