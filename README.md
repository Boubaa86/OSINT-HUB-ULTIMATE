# OSINT HUB ULTIMATE — V1 foundation

Privacy-respecting OSINT workspace scaffold. V1 includes a responsive dashboard, an Express API, health/status endpoints, a module catalogue, and passive public DNS lookups.

## Requirements
- Node.js 20+
- npm

## Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000. Health: `GET /api/health`. Modules: `GET /api/modules`. DNS: `POST /api/osint/dns` with `{"domain":"example.com"}`.

## Deployment
The `render.yaml` Blueprint describes an independent Frankfurt web service and PostgreSQL database. Review the Render Blueprint plan before applying it. It must not reuse the existing Warworld database. Secrets belong in Render environment variables only.

## Current implementation status
- [x] Project structure and Render Blueprint
- [x] Responsive dark dashboard
- [x] API health and module catalogue
- [x] Passive DNS A/AAAA/MX/NS/TXT lookup
- [x] Input validation, security headers, JSON size limit, API rate limit
- [x] Android WebView-compatible static bundle in `www/`
- [ ] Runtime dependency install and live server test
- [ ] Render deployment and PostgreSQL provisioning
- [ ] Authentication, persistent investigations, graph, provider connectors, AI and exports

This is a foundation, not yet the complete OSINT platform. Planned features are not presented as operational.

## Safety
Only investigate information you are authorized to process. DNS results are observations, not proof of ownership or relationships. Do not use this project to identify private people, access accounts, track live locations, or bypass platform restrictions. Keep all API keys server-side.
