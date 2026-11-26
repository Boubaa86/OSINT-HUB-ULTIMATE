# PostgreSQL migrations

Migrations are explicit; the web server does not modify the database at startup.

## Apply

1. Configure the OSINT-only `DATABASE_URL` in the OSINT Render service.
2. Confirm it points to the dedicated `osint_hub` database, never the Warworld database.
3. Run `npm run migrate` from a trusted deployment job.
4. Verify `schema_migrations` and the tables listed in each applied `src/migrations/*.up.sql` file.

The runner applies migrations in a fixed order under a PostgreSQL advisory lock. Each migration runs in its own transaction. Re-running an applied migration is a no-op.

Current migrations:
- `001_initial_schema`: users, sessions, roles, investigations, notes, sources, graph data, reports, integrations, notifications, automations, settings and audit log.
- `002_ai_conversations`: owner-scoped AI conversations and messages.
- `003_image_records`: owner-scoped image hashes and sanitized metadata (no image bytes).
- `004_automation_runs`: passive monitoring execution history.

## Rollback

Rollback is explicit and only targets the latest known migration:

```bash
CONFIRM_ROLLBACK=004_automation_runs npm run migrate:down
```

The command requires the exact latest migration name. Each down migration refuses to drop non-empty tables. Take and verify a backup before any production rollback. Never point the command at the Warworld database.

No migration is automatically applied during application boot.
