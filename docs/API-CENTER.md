# API Center

`GET /api/integrations` returns provider names, supported capabilities and whether the required Render environment variables are present. Secret values are never returned.

`POST /api/integrations/:provider/test` runs a small, bounded test request for configured providers. It uses a fixed public test target or provider metadata endpoint, an 8-second timeout and no redirect following. The result includes status, HTTP code and latency only; response bodies and credentials are not exposed.

Supported connection tests:
- VirusTotal: public IP metadata endpoint.
- AbuseIPDB: public IP check endpoint.
- Shodan: API info endpoint.
- Have I Been Pwned: breach catalogue endpoint.
- OpenAI: models endpoint.

Censys configuration is detected but an automated connection test is not yet implemented. API keys are supplied only through Render environment variables; the UI cannot read or reveal them. Never commit secrets to Git.
