# Architecture — V1

- Browser UI: static HTML/CSS/JS served by Express.
- Android package: static WebView-compatible copy in `www/`; API calls in that bundle still require a configured HTTPS backend URL when used outside the same origin.
- API: Express JSON endpoints under `/api`.
- DNS: Node.js `dns/promises`, passive resolver lookups only.
- Security baseline: Helmet, strict JSON body size, Zod validation, rate limiting, no secrets in source control.
- Persistence: PostgreSQL is reserved in `render.yaml`; V1 does not yet write user data.
- Future: auth/session layer, per-user investigations, provider adapters with explicit `configured` states, graph data model, audit log, exports.

## Data quality
Every provider result must carry provider/source, retrieval timestamp, and caveats. A relationship may be asserted only when supported by a source; correlation alone is not proof.
