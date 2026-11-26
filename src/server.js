import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabaseStatus } from './db.js';
import { createAuthRouter } from './auth.js';
import { createInvestigationsRouter } from './routes/investigations.js';
import { createIntelligenceRouter } from './routes/intelligence.js';
import { createSearchRouter } from './routes/search.js';
import { createIntegrationsRouter } from './routes/integrations.js';
import { createThreatRouter } from './routes/threat.js';
import { createReportsRouter } from './routes/reports.js';
import { createAiRouter } from './routes/ai.js';
import { createImageRouter } from './routes/images.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createAutomationsRouter } from './routes/automations.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createAdminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
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
app.use('/api/auth', createAuthRouter());
app.use('/api/investigations', createInvestigationsRouter());
app.use('/api/search', createSearchRouter());
app.use('/api/integrations', createIntegrationsRouter());
app.use('/api/threat', createThreatRouter());
app.use('/api/reports', createReportsRouter());
app.use('/api/ai', createAiRouter());
app.use('/api/dashboard', createDashboardRouter());
app.use('/api/automations', createAutomationsRouter());
app.use('/api/notifications', createNotificationsRouter());
app.use('/api/admin', createAdminRouter());

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

app.get('/api/ready', async (_req, res) => {
  const database = await getDatabaseStatus();
  if (!database.configured || !database.connected) {
    return res.status(503).json({ ready: false, database, timestamp: new Date().toISOString() });
  }
  return res.json({ ready: true, database, timestamp: new Date().toISOString() });
});

app.get('/api/modules', (_req, res) => {
  res.json({ modules: [
    { id: 'domain-dns', name: 'DNS public', status: 'available', scope: 'Résolution DNS passive' },
    { id: 'domain-ct', name: 'Certificats de domaine', status: 'available', scope: 'Noms de certificats dans les journaux CT publics' },
    { id: 'ip-intel', name: 'Renseignement IP', status: 'available', scope: 'RDAP public et reverse DNS pour IP publiques' },
    { id: 'email-mx', name: 'E-mail syntaxe & MX', status: 'available', scope: 'Validation de syntaxe et DNS MX uniquement' },
    { id: 'phone-format', name: 'Téléphone international', status: 'available', scope: 'Format, pays et type selon le plan de numérotation' },
    { id: 'username', name: 'Pseudonymes publics', status: 'planned', scope: 'Profils publics via sources autorisées' },
    { id: 'image-metadata', name: 'Image metadata & hash', status: 'available', scope: 'EXIF sans GPS, dimensions, SHA-256, dHash et doublons' },
    { id: 'image-ocr', name: 'OCR image', status: 'planned', scope: 'OCR à intégrer via moteur autorisé' },
    { id: 'graph', name: 'Graphe interactif', status: 'planned', scope: 'Visualisation graphique à développer' },
    { id: 'intelbase-api', name: 'IntelBase — données sourcées', status: 'available', scope: 'Entités, relations, sources et confiance' },
    { id: 'global-search', name: 'Global Search', status: 'available', scope: 'Classification et recherches DNS, IP, e-mail, téléphone et hash' },
    { id: 'api-center', name: 'API Center', status: 'available', scope: 'État des clés et tests de connexion des fournisseurs' },
    { id: 'threat-intel', name: 'Threat Intelligence', status: 'available', scope: 'VirusTotal et AbuseIPDB si les clés sont configurées' },
    { id: 'report-generator', name: 'Report Generator', status: 'available', scope: 'PDF, HTML, JSON, CSV et Markdown' },
    { id: 'ai-assistant', name: 'AI OSINT Assistant', status: process.env.OPENAI_API_KEY ? 'available' : 'planned', scope: 'Assistant source-grounded via Responses API' },
    { id: 'auth', name: 'Comptes & sessions', status: 'available', scope: 'Inscription, connexion, sessions sécurisées' },
    { id: 'case-management', name: 'Gestion des dossiers', status: 'available', scope: 'Dossiers privés, notes et sources' }
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

app.use('/api/osint/image', createImageRouter());
app.use('/api/osint', createIntelligenceRouter());

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OSINT HUB listening on ${PORT}`);
  });
}
