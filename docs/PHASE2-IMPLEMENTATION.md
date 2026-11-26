# Phase 2 — OSINT modules and workspace status

Date: 2026-11-26

## Implemented in source

- Domain: passive DNS and public Certificate Transparency names.
- IP: public-only RDAP registration metadata and reverse DNS.
- E-mail: syntax and MX checks only; no mailbox existence or owner lookup.
- Phone: international numbering-plan parsing only; no subscriber, operator or location lookup.
- Global Search: classifies domain, URL, public IP, e-mail, international phone and common file hashes. It runs only implemented providers. Hash reputation returns an explicit not-configured state until a provider key exists.
- Search history: opt-in only; query values are not stored unless the user checks the history option.
- IntelBase API: investigation-scoped entities and source-backed relationships with required rationale and confidence.
- IntelBase UI: node dragging, canvas pan, zoom, and SVG/PNG/JSON/CSV export.
- API Center: configured/not-configured status and bounded connection tests for VirusTotal, AbuseIPDB, Shodan, HIBP and OpenAI. Censys configuration is detected but its automatic test remains unavailable.
- Threat Intelligence: optional VirusTotal and AbuseIPDB lookups for public IPs, domains and hashes. Missing keys return not_configured, never fabricated scores.
- Reports: PDF, HTML, JSON, CSV and Markdown generation; report metadata is stored in PostgreSQL, while generated files are streamed and not retained server-side.

## Security controls

- All personal workspace APIs require authentication.
- State-changing operations require CSRF tokens.
- Investigation, graph and report queries are scoped to the authenticated owner.
- Public IP lookups reject private/reserved address ranges.
- Provider keys are read only from server environment variables and are never returned to the UI.
- External provider calls have bounded timeouts and rate limits.
- CSV output neutralizes spreadsheet formula prefixes.
- No face identification, phone tracking, private-address discovery, mailbox verification, account access or unapproved active scanning.

## Validation status

- PostgreSQL migrations 001 and 002 are applied in order by CI; guarded reverse migrations require explicit confirmation and refuse to drop non-empty data.
- API integration tests cover account registration, CSRF, owner isolation, notes, sources, graph entities/relations, search history, provider configuration, threat not-configured behavior and report generation.
- The first CI run completed migration but its API test process did not finish. The integration suite was then separated from unit tests, given request and test timeouts, and the workflow was updated. A fresh completed CI result is still required before calling the current branch fully tested.
- No OSINT Render service or database has been provisioned.
- No production or AppMint APK test has been performed.

## Still to implement

- Advanced graph filters, timelines and clustering.
- Image metadata, OCR, hashes and duplicate detection.
- Public profile research through official/authorized sources only.
- CERT/public threat feeds and richer reputation coverage.
-
- Automation task scheduling and notifications.
- Admin roles, quotas and audit event writes.
- Additional reports and visualizations.
- Android API base URL integration and real-device test.
- Render provisioning, migrations, deployment and post-deploy verification.
