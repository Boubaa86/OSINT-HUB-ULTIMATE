# IntelBase — données sourcées

Les routes IntelBase sont imbriquées dans un dossier et héritent de son contrôle d'accès propriétaire.

- `GET /api/investigations/:id/graph`: renvoie les entités et les relations du dossier.
- `POST /api/investigations/:id/entities`: ajoute ou met à jour une entité.
- `POST /api/investigations/:id/relationships`: crée une relation entre deux entités.

Types d'entités autorisés : organisation, domaine, IP publique, URL HTTP(S), hash, technologie et certificat. Les personnes ne sont pas un type d'entité disponible.

Chaque relation doit relier deux entités du même dossier et référencer une source enregistrée dans ce dossier. Une justification et une confiance comprise entre 0 et 1 sont obligatoires. Les liens sans source, les liens vers d'autres dossiers et les relations d'une entité vers elle-même sont refusés.

Les relations sont des observations documentées, pas des preuves automatiques de propriété ou de causalité. L'API de données est disponible. Le premier graphe web est maintenant interactif : déplacement des nœuds, déplacement de la vue, zoom molette et exports SVG/PNG/JSON/CSV. Les filtres avancés, la chronologie et le regroupement automatique restent à développer.
