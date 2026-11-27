# Threat Intelligence

Routes (session requise):
- `GET /api/threat/ip/:address`
- `GET /api/threat/domain/:domain`
- `GET /api/threat/hash/:hash`

Providers:
- VirusTotal: IP, domain and file-hash lookups when `VIRUSTOTAL_API_KEY` is configured.
- AbuseIPDB: public IP reputation when `ABUSEIPDB_API_KEY` is configured.

Missing keys return `not_configured`; no placeholder score is fabricated. Provider errors are isolated. Requests are rate limited and have an 8-second timeout. Only selected reputation metadata is returned, never raw provider response bodies or keys. No file is downloaded or executed and no target is scanned.

A provider verdict is a signal, not proof of compromise or malicious intent. False positives and stale reports are possible.
