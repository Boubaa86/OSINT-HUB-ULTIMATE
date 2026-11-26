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
``

Ouvrir http://localhost:3000.

## Routes existantes

- `GET /api/health` — état de vie HTTP (ne dépend pas de PostgreSQL).
- `GET /api/ready` — état de préparation, renvoie 503 si PostgreSQL n'est pas joignable.
- `GET /api/modules` — catalogue honnête des modules.
- `POST /api/osint/dns` — résolution DNS passive A/AAAA/MX/NS/TXT.
- `GET /api/osint/domain/:domain` — DNS détaillé et noms de certificats CT publics (session requise).
- `GET /api/osint/ip/:address` — RDAP et reverse DNS d'une IP publique (session requise).
- `POST /api/osint/email` — syntaxe e-mail et enregistrements MX du domaine (session requise ; aucune vérification de boîte).
- `POST /api/auth/register` — création de compte.
- `POST /api/auth/login` — ouverture de session.
- `GET /api/auth/me` — compte et rôles de la session.
- `GET /api/auth/csrf` — renouvellement du jeton CSRF.
- `POST /api/auth/logout` — fermeture de session (CSRF requis).
- `GET /api/investigations` — liste privée des dossiers.
- `POST /api/investigations` — création (session + CSRF requis).
- `GET /api/investigations/:id` — détail d'un dossier appartenant à l'utilisateur.
- `PATCH /api/investigations/:id` — modification / archivage (session + CSRF requis).
- `GET|POST /api/investigations/:id/notes` — notes privées.
- `GET|POST /api/investigations/:id/sources` — sources et fiabilité déclarée.

Les mutations nécessitent le cookie de session et l'en-tête `x-csrf-token`. La session est conservée dans un cookie HttpOnly. Les dossiers ne disposent pas de route de suppression définitive : ils peuvent être archivés.

## PostgreSQL et migrations

Les migrations sont explicites, transactionnelles et verrouillées par advisory lock. Elles ne s'exécutent jamais automatiquement au démarrage.

```bash
npm run migrate
``

Voir [DB-MIGRATIONS.md](docs/DB-MIGRATIONS.md). La base doit être une base dédiée à OSINT HUB. Ne jamais utiliser la base Warworld/Dust Siege.

## Déploiement Render

Le fichier `render.yaml` propose un service Node et une base PostgreSQL distincte en région Frankfurt. Le Blueprint existe mais aucune ressource OSINT n'a encore été provisionnée. Examiner la durée de conservation de l'offre PostgreSQL gratuite avant validation. Les secrets restent dans les variables d'environnement Render.

## Tests

```bash
npm test
``

Le workflow GitHub Actions vérifie la syntaxe JavaScript et exécute les tests unitaires à chaque push sur la branche de développement et sur main.

## État actuel

- [x] Tableau de bord et résolution DNS passive
- [x] Audit technique et branches de sauvegarde / développement
- [x] Pool PostgreSQL facultatif et endpoint de readiness
- [x] Première migration additive pour comptes, sessions, dossiers, notes, sources, graphes, rapports, intégrations, notifications, automatisations et audit
- [x] Inscription / connexion avec hachage PBKDF2-SHA256, sessions HttpOnly et jetons CSRF
- [x] API de dossiers, notes, sources et archivage avec cloisonnement par propriétaire
- [x] Analyse passive de domaines via DNS et Certificate Transparency
- [x] Analyse d'IP publiques via RDAP et reverse DNS
- [x] Vérification e-mail limitée à la syntaxe et aux DNS MX
- [x] Tests unitaires pour les identifiants et tokens
- [ ] Exécution des migrations sur la base Render OSINT
- [ ] Tests d'intégration avec PostgreSQL et vérification multi-utilisateur
- [ ] Interface utilisateur de connexion et gestion des dossiers
- [ ] Téléphone, pseudonymes, image et veille de menaces
- [ ] IntelBase, recherche globale, IA, automatisations et rapports
- [ ] Déploiement et tests de production

## Confidentialité et usage

Utiliser uniquement des sources ouvertes ou des données auxquelles tu es autorisé à accéder. Pas de recherche d'adresses privées, de suivi de localisation, d'accès à des comptes, de reconnaissance faciale, de contournement des règles des plateformes ou de scan actif non autorisé. Les relations et hypothèses doivent toujours être accompagnées de leurs sources, dates et limites.
