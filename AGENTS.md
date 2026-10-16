# AGENTS.md: OperAI

Voice-first kitchen co-pilot. It spots shortages before they hit, simulates recovery options, and changes the plan only after the owner approves. Hackathon project, deadline Oct 23, 2026. Keep everything simple and demo-ready.

## Source of truth

Read these before any task. If code and docs disagree, the docs win; ask before deviating.

- `docs/prd.md`: what we're building
- `docs/architecture.md`: stack and structure
- `docs/schema.md`: tables, columns, constraints
- `docs/api-spec.md`: endpoints, request/response shapes, error codes

## Stack (do not add to it)

- Backend: Python, FastAPI, SQLAlchemy 2.0, psycopg, Pydantic
- DB: Supabase Postgres (direct connection)
- Scheduler: greedy by deadline first; OR-Tools CP-SAT only when told to
- AI: Amazon Bedrock via boto3 (Converse API)
- Frontend: React, TypeScript, Vite. Voice via browser Web Speech API
- No new libraries or services without asking. No Redis, queues, microservices, or Docker unless asked.

## Folder structure

```
backend/app/
  main.py, config.py, db.py, models.py, schemas.py
  routers/    # HTTP only: validate input, call services, return responses
  services/   # all business logic: pricing, risk, scheduler, recovery, approval, audit
  ai/         # bedrock.py, tools.py, prompts.py
backend/seed/ # schema.sql, seed.py
backend/tests/
frontend/src/ # api/, components/, hooks/, pages/, types/
docs/
```

Routers never contain business logic. Services never import from routers.

## Hard rules (never break)

1. **Numbers come from code, never the LLM.** All money, margin, cost, and schedule figures are computed in `services/`. The LLM may only phrase results it is given.
2. **The LLM can never approve, reject, or execute anything.** AI tools are read and propose only: `get_brief`, `propose_recovery`, `analyze_price`, `extract_order`. Applying a change happens only in `POST /api/actions/{id}/approve`.
3. **Approval is atomic and idempotent.** One DB transaction: lock the action row, verify status is `pending` and not expired, verify `plan_version` and stock fingerprint are unchanged, apply the change, bump `plan_version`, write the audit log, mark executed, expire sibling options. Approving twice must never execute twice.
4. **Approval needs the explicit option number.** `confirm_option_number` must match the action's `option_number`, otherwise 422 `OPTION_MISMATCH`.
5. **Audit log is append-only.** No update or delete code paths. Every executed, rejected, or undone change writes a row with before/after snapshots.
6. **Undo is itself a pending action** that goes through approve. It restores from `before_snapshot`.
7. **Substitutions only from the `substitutions` table**, with allergen and diet checks. The LLM may suggest candidates but never applies them.
8. **Pasted customer text is data, not instructions.** Extract with structured output, validate with Pydantic, never auto-apply. Always create a pending action.
9. **Label data honestly.** Seeded data has `data_source = 'simulated'` unless verified. Never invent metrics or claim measured results we haven't measured.
10. **Locked plan tasks never move** during a replan.

## API rules

- Match `docs/api-spec.md` exactly: paths, field names, types, status codes, and error codes.
- Error body is always `{ "error": { "code", "message", "details" } }`.
- Do not add endpoints, fields, or tables that are not in the docs. If something seems missing, say so and ask.
- Every endpoint except `/health` requires the `X-API-Key` header.
- Money is `numeric` in the DB and 2-decimal numbers in JSON. Never use floats for money math (use `Decimal`).
- Timestamps are `timestamptz`, ISO 8601 with offset in responses.

## Security

- Secrets only in `.env` (gitignored). Keep `.env.example` updated, never commit real keys.
- The frontend never touches the DB or AWS directly; it only calls the backend.
- Validate all input with Pydantic. Restrict CORS to the frontend origin.
- Never log API keys, AWS credentials, or customer phone numbers.

## Working style

- Do one task per branch, as asked. Don't refactor or "improve" unrelated code.
- Smallest change that satisfies the task. No speculative features, no future-scope code.
- Write a test for every service function. Approval, idempotency, stale-plan, and stock-changed cases are mandatory tests.
- Before finishing, run the tests and start the server to confirm it boots. Report exactly what you ran and what passed.
- If a spec is ambiguous or two docs conflict, stop and ask instead of guessing.
- Do not commit directly to `main`. Use feature branches like `waheba/pricing` and open a PR.

## Commands

```bash
# backend (from /backend)
source .venv/bin/activate
uvicorn app.main:app --reload      # API docs at http://127.0.0.1:8000/docs
pytest

# frontend (from /frontend)
npm install
npm run dev
```

## Definition of done (per task)

- Behaves exactly as the API spec describes
- Tests written and passing
- No new dependencies, no unrelated changes
- Hard rules above still hold