# AI OSINT Assistant

The assistant uses the OpenAI Responses API (not the retired Assistants API). Default model: `gpt-6.2-astra`; override with `OPENAI_MODEL`. Set `OPENAI_API_KEY` only in Render environment variables.

Routes (authenticated; POST routes require CSRF):
- `GET /api/ai/conversations`
- `POST /api/ai/conversations`
- `GET /api/ai/conversations/:id`
- `POST /api/ai/conversations/:id/messages`

Conversation and message history is stored in this application's PostgreSQL database and scoped to its owner. The model request uses `store: false`. Dossier context is sent to OpenAI only when the user explicitly supplies an `investigationId` with a message. The assistant receives bounded source, note, entity and relationship context, and must separate observations, hypotheses and unknowns.

Without `OPENAI_API_KEY`, message generation returns an explicit 503 not-configured response; it does not fabricate a reply. Requests have a 30-second timeout and an 8/minute rate limit. Model output is treated as analysis, not evidence. The assistant is instructed not to identify or track private people, bypass access controls, or present correlation as proof.
