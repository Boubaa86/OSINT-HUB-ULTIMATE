# Administration

The first administrator is controlled by the Render environment variable `ADMIN_EMAILS`, a comma-separated allowlist of account email addresses. Add the exact email used to register, then sign out and sign back in. The account receives effective `admin` permission without changing user data. Keep Render environment access restricted.

Roles are stored in PostgreSQL: `user`, `analyst`, `admin`. Admin-only endpoints:
- `GET /api/admin/overview`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/status`
- `PATCH /api/admin/users/:id/roles`
- `GET /api/admin/audit`

All writes require CSRF. Administrators cannot disable their own account or remove their own admin role through the API. Role and status changes are written to `audit_logs`. The admin panel is shown only when the authenticated account has the effective admin role.
