# OSINT HUB ULTIMATE

Plateforme OSINT en développement progressif. Les modules annoncés comme disponibles correspondent à des routes réellement implémentées ; les autres restent explicitement marqués « à venir ».

## Exigences

- Node.js 20+
- PostgreSQL 14+
- npm

## Développement local

```bash
npm install
cp .env.example .env
# Renseigner DATABASE_URL avec une base OSINT dédiée
npm run migrate
npm run dev
```

Ouvrir http://localhost:3000.

## Routes principales

- `GET /api/health` — état de vie HTTP.
- `GET /api/dashboard/summary` — statistiques réelles et privées du compte connecté.
- `GET|POST /api/automations`, `PATCH /api/automations/:id`, `POST /api/automations/:id/run`, `GET /api/automations/:id/runs` — surveillance passive.
- `POST /api/automations/run-due` — worker planifié protégé par secret Bearer.
- `GET /api/notifications`, `PATCH /api/notifications/:id/read` — boîte de notifications.
- `GET /api/ready` — readiness PostgreSQL.
- `GET /api/modules` — catalogue honnête des modules.
- `POST /api/osint/dns` — DNS passif A/AAAA/MX/NS/TXT.
- `GET /api/osint/domain/:domain` — DNS et noms de certificats CT publics.
- `GET /api/osint/ip/:address` — RDAP et reverse DNS d'une IP publique.
- `POST /api/osint/email` — syntaxe et DNS MX uniquement, aucune vérification de boîte.
- `POST /api/osint/phone` — formatage et plan de numérotation, sans propriétaire ni localisation.
- `POST /api/osint/image` — EXIF filtré, dimensions, SHA-256, dHash et détection de doublons.
- `POST /api/search` — recherche universelle sur les modules disponibles.
- `GET /api/search/history` — historique personnel, uniquement si l'utilisateur l'a demandé.
- `GET /api/integrations` et `POST /api/integrations/:provider/test` — état des fournisseurs et tests bornés.
- `GET /api/threat/ip/:address`, `/api/threat/domain/:domain`, `/api/threat/hash/:hash` — VirusTotal/AbuseIPDB si les clés sont configurées.
- `GET /api/reports/investigations/:id` et `POST /api/reports/investigations/:id` — historique et génération PDF, HTML, JSON, CSV ou Markdown.
- `GET /api/ai/conversations`, `POST /api/ai/conversations`, `GET /api/ai/conversations/:id`, `POST /api/ai/conversations/:id/messages` — assistant IA et historique privé.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/auth/csrf`, `POST /api/auth/logout` — authentification.
- `GET|POST /api/investigations`, `GET|PATCH /api/investigations/:id` — dossiers privés.
- `GET|POST /api/investigations/:id/notes` et `GET|POST /api/investigations/:id/sources` — notes et sources.
- `GET /api/investigations/:id/graph`, `POST /api/investigations/:id/entities`, `POST /api/investigations/:id/relationships` — données IntelBase sourcées.

Les mutations nécessitent le cookie de session et l'en-tête `x-csrf-token`. Les dossiers sont cloisonnés par propriétaire et ne disposent pas de route de suppression définitive : ils peuvent être archivés.

## AI Assistant

Le modèle par défaut est `gpt-6.2-sol`, configurable avec `OPENAI_MODEL`. Ajoute `OPENAI_API_KEY` uniquement dans les variables d'environnement Render. Sans cette clé, l'assistant renvoie explicitement « non configuré ». Le contexte d'un dossier n'est envoyé au modèle que si l'utilisateur coche l'option dédiée. L'historique de conversation est stocké dans PostgreSQL ; la requête API utilise `store: false`.

## PostgreSQL et migrations

Les migrations sont additives, ordonnées, transactionnelles et verrouillées par advisory lock. Elles ne s'exécutent jamais automatiquement au démarrage.

```bash
npm run migrate
# Rollback explicite de la dernière migration, uniquement si ses tables sont vides :
CONFIRM_ROLLBACK=004_automation_runs npm run migrate:down
```

Le rollback refuse de supprimer les tables si elles contiennent des données. Voir [DB-MIGRATIONS.md](docs/DB-MIGRATIONS.md). Utilise une base OSINT dédiée, jamais la base Warworld/Dust Siege.

## Tests

```bash
npm test
npm run test:integration # nécessite PostgreSQL
```

La CI installe PostgreSQL temporaire, applique les migrations, vérifie la syntaxe et exécute les tests unitaires et d'intégration.

## Déploiement Render

Le Blueprint propose un service Node et une base PostgreSQL distincte en région Frankfurt. Le Blueprint existe, mais aucune ressource OSINT n'a encore été provisionnée. Vérifie la durée de conservation de l'offre PostgreSQL gratuite avant validation. Les clés API restent dans les variables d'environnement Render.

## État actuel

- [x] Dashboard et DNS passif.
- [x] Comptes, sessions HttpOnly, hachage PBKDF2-SHA256 et CSRF.
- [x] Dossiers, notes, sources et archivage avec contrôle du propriétaire.
- [x] Analyse de domaines DNS/Certificate Transparency et IP publiques RDAP/PTR.
- [x] Vérification e-mail syntaxe/MX et métadonnées téléphoniques.
- [x] Image Intelligence : EXIF sans GPS, SHA-256, dHash et doublons.
- [x] Global Search avec historique facultatif.
- [x] IntelBase API et graphe interactif avec déplacement, pan, zoom et exports SVG/PNG/JSON/CSV.
- [x] API Center et tests de connexion des fournisseurs.
- [x] Threat Intelligence optionnelle via VirusTotal/AbuseIPDB.
- [x] Rapports PDF, HTML, JSON, CSV et Markdown.
- [x] Assistant IA Responses API avec historique privé et contexte dossier sur consentement explicite.
- [x] Migrations 001–004 et rollback protégé.
- [x] Automatisations passives DNS/CT, historique d'exécution et notifications ; planification GitHub Actions activable par secrets.
- [ ] Résultat CI final complet de la branche courante.
- [ ] Exécution des migrations sur la base Render OSINT.
- [ ] Déploiement et tests de production.
- [ ] Tests AppMint sur Android.
- [ ] OCR, recherche de pseudonymes par sources autorisées, filtres/chronologie avancés, flux CERT, automatisations et administration.

## Confidentialité et usage

Utiliser uniquement des sources ouvertes ou des données auxquelles tu es autorisé à accéder. Pas de recherche d'adresses privées, de suivi de localisation, d'accès à des comptes, de reconnaissance faciale, de contournement des règles des plateformes ou de scan actif non autorisé. Les relations et hypothèses doivent toujours être accompagnées de leurs sources, dates et limites.
