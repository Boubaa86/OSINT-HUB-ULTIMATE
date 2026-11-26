# PostgreSQL migrations

Migrations are explicit; the web server does not modify the database at startup.

## Apply

1. Configure the OSINT-only `DATABASE_URL` in the OSINT Render service.
2. Confirm it points to the dedicated `osint_hub` database, never the Warworld database.
3. Run `npm run migrate` from the service shell or a trusted deployment job.
4. Verify `schema_migrations` and the tables listed in `001_initial_schema.up.sql`.

The runner uses a PostgreSQL advisory lock and a transaction. Re-running an applied migration is a no-op.

## Rollback

`001_initial_schema.down.sql` is supplied for review only. It refuses to drop any table containing rows. Do not run it against production without a verified backup and an explicit data-retention decision.

No migration is automatically applied during application boot.
