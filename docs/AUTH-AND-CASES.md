# Authentication and case management

This phase adds a server-side session model and private investigation CRUD.

- Passwords are stored as PBKDF2-SHA256 hashes with per-user random salts.
- Session cookies are HttpOnly, SameSite=Lax and Secure in production.
- Only SHA-256 hashes of opaque session and CSRF tokens are stored.
- Mutating case routes require both an authenticated session and a CSRF header.
- Case, note and source queries are scoped to the authenticated owner and use parameterized SQL.
- Dossiers are archived instead of deleted. There is no hard-delete route.
- Registration and login have dedicated rate limits.

Before production use, configure HTTPS, the OSINT-only DATABASE_URL and APP_ORIGIN. The browser frontend must obtain a CSRF token from /api/auth/csrf before submitting changes. This phase has not been deployed because the separate OSINT PostgreSQL resource has not yet been provisioned.
