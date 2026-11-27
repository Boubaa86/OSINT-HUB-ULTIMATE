# OSINT Automation

Supported task types are deliberately passive:
- `dns_change`: public A/AAAA/MX/NS/TXT snapshots.
- `certificate_change`: public Certificate Transparency names.

Task management (authenticated; mutations require CSRF):
- `GET /api/automations`
- `POST /api/automations` with task type, domain, frequency, optional case ID and `authorized: true` attestation.
- `PATCH /api/automations/:id` to enable/disable.
- `POST /api/automations/:id/run` for a manual run.
- `GET /api/automations/:id/runs` for execution history.

The due-task worker is `POST /api/automations/run-due`, protected by a timing-safe Bearer secret. It processes at most 20 due tasks per call. A snapshot is stored for each run; a notification is created when a subsequent snapshot differs from the previous successful snapshot.

## Periodic scheduling

The GitHub Actions workflow `.github/workflows/automations.yml` calls the worker every 30 minutes. After the Render service exists:

1. Copy the generated Render `AUTOMATION_SECRET` value.
2. In GitHub repository Settings → Secrets and variables → Actions, add `OSINT_BASE_URL` (the deployed HTTPS service URL) and `OSINT_AUTOMATION_SECRET` (the exact Render secret).
3. Run the workflow manually once to verify it.

Until those two GitHub secrets exist, the scheduled workflow deliberately skips execution. Render and GitHub never receive the secret in source code. The worker performs only passive DNS and public certificate-log lookups; no port scanning or target crawling.
