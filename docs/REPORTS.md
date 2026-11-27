# Report generator

Authenticated, owner-scoped routes:
- `GET /api/reports/investigations/:id` lists generated report metadata.
- `POST /api/reports/investigations/:id` with `{ "format": "pdf|html|json|csv|markdown" }` generates a report (CSRF required).

Reports include the case description and objective, methodology, sources with reliability and collection dates, entities, source-backed relationships with confidence, notes, generation timestamp and analysis limitations. Generated report metadata and counts are saved in PostgreSQL. The generated file is streamed to the user and is not permanently stored on the server in this phase.
