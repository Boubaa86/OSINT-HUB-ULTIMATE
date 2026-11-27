import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireCsrf } from '../auth.js';
import { listProviders, testProvider } from '../providers/registry.js';

export function createIntegrationsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json({
      providers: listProviders(),
      note: 'Les clés ne sont jamais renvoyées au navigateur. Configure-les dans les variables d’environnement Render.'
    });
  });

  router.post('/:provider/test', requireCsrf, rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const result = await testProvider(req.params.provider);
    if (result.status === 'unknown_provider') return res.status(404).json({ error: 'Fournisseur inconnu.' });
    res.json(result);
  });

  return router;
}
