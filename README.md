# OperAI — Voice-First Kitchen Co-Pilot

> **Spot the risk. Compare the options. Keep the owner in control.**

**Amazon Developer Hackathon 2026 · Alexa+ Track**

Demo video: _add link_ · Live demo: _add link_ · Devpost: _add link_

OperAI helps small food businesses (cloud kitchens, home kitchens, tiffin services) catch ingredient shortages before they become failed orders. It shows what is at risk, compares recovery options against a do-nothing baseline, and changes the kitchen plan only after the owner explicitly approves.

## The problem

Small food businesses run orders, stock, pricing, and cooking schedules by hand. One missing ingredient can ripple across several orders, causing delays and eating into margins. Owners need a fast answer to "what is at risk, and what can I do?", usually while their hands are busy cooking.

## Our solution

OperAI pairs deterministic kitchen-planning logic with an AI-powered voice and text interface. It finds shortages, estimates the impact on orders, simulates recovery options, and lays out the trade-offs so the owner makes the final call.

**Core principle:** AI helps the owner understand and explore options. Deterministic backend services calculate costs and schedules. Consequential changes require explicit approval.

## Key capabilities

**Detect and plan**

- **Proactive risk brief:** compares stock with upcoming order requirements and highlights shortages, affected orders, and revenue at risk.
- **Kitchen scheduling:** plans around order deadlines, cook availability, burner capacity, and prep tasks, with a greedy fallback if the constraint solver is unavailable.

**Decide**

- **Recovery options:** approved substitutions, dish swaps, delays with customer notification, partial fulfilment, or emergency purchase where supported.
- **Impact comparison:** every option is compared with a do-nothing baseline (late orders, extra cost, margin impact).
- **Pricing analysis:** dish cost, margin, and a suggested price for a target margin.

**Act safely**

- **Explicit approval gate:** the owner confirms a specific option before anything changes.
- **Audit log and undo:** before/after snapshots for every change; undo goes through the same approval flow.

**Communicate**

- **Voice and text:** ask questions conversationally, hear the options explained, and fall back to text when speech is unavailable.
- **Order extraction:** turns pasted customer messages (e.g. WhatsApp text) into structured order drafts, flagging ambiguous details.
- **Customer message drafts:** prefilled `wa.me` links for affected customers. The owner sends the message.
- **Day-end summary:** completed orders and the recorded impact of executed recovery actions.

> **Data transparency:** Demo data is simulated unless explicitly labelled as verified. Illustrative numbers in screenshots or docs are not evidence of real-world business results.

## How it works

Many tools stop at costing or static recommendations. OperAI covers the full decision loop:

1. **Detect** a shortage before it causes an order failure.
2. **Estimate** what happens if the owner does nothing.
3. **Simulate and compare** feasible alternatives.
4. **Explain** the trade-offs in plain language or voice.
5. **Wait** for the owner's explicit approval.
6. **Replan** affected work, preserve tasks already in progress, and record the change.
7. **Summarise** the outcome.

## Architecture

One FastAPI service, one PostgreSQL database, one LLM provider.

```text
Owner (voice or text)
        |
        v
React + TypeScript + Vite
        |
        | REST / JSON
        v
FastAPI routers
        |
        +---------------------------+
        |                           |
        v                           v
Deterministic services          AI layer
- Pricing                       - Intent handling
- Risk analysis                 - Order extraction
- Scheduler                     - Explanations
- Recovery                      - Bedrock tool use
- Approval                      (read and propose only)
- Audit
        |                           |
        v                           v
OR-Tools / greedy fallback      Amazon Bedrock
        |
        v
Supabase PostgreSQL
```

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React, TypeScript, Vite | Dashboard, schedule board, order views, impact cards, approval UI |
| Backend | Python, FastAPI | REST API and application services |
| Database | Supabase-hosted PostgreSQL | Kitchen, ingredient, menu, order, plan, action, and audit data |
| DB access | SQLAlchemy 2.x, psycopg | Transactional database access |
| Scheduling | Google OR-Tools CP-SAT, greedy fallback | Constraint-based scheduling and replanning |
| AI | Amazon Bedrock (boto3 Converse API) | Intent handling, structured order extraction, explanations |
| Voice | Browser Web Speech APIs | Speech input/output with text fallback |
| Messaging | WhatsApp `wa.me` links | Prefilled customer message drafts |

### Repository layout

Intended monorepo structure; filenames may vary slightly.

```text
operai/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── routers/
│   │   ├── services/
│   │   └── ai/
│   ├── seed/
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── pages/
│   │   └── types/
│   └── .env.example
├── docs/
├── .gitignore
└── README.md
```

## Safety and correctness

- **The LLM never approves or executes changes.** Proposals are stored as pending actions; execution happens through a separate approval endpoint.
- **The backend owns the numbers.** All money, margin, and scheduling figures are computed by deterministic services; the LLM explains results rather than inventing them.
- **Approval revalidates.** The proposal is rechecked against the current plan and stock at approval time.
- **Idempotent.** Duplicate approvals cannot execute the same action twice.
- **Safe replanning.** Tasks already in progress are preserved.
- **Substitution checks.** Substitutions must pass approved-substitution, allergen, and dietary checks; customer consent is flagged where required.
- **Auditable and reversible.** Audit records keep before/after snapshots, and undo is approval-gated.

## Quick start

Variable names and scripts live in each folder's `.env.example` and `package.json`. If anything here differs from your branch, the repo files win.

**Prerequisites:** Git, Python (version supported by `requirements.txt`), Node.js and npm, a Supabase PostgreSQL project, and an AWS account with Amazon Bedrock model access enabled in your region.

### 1. Clone

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd operai
```

### 2. Backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
source .venv/bin/activate
```

Then install, configure, and run:

```bash
pip install -r requirements.txt
cp .env.example .env     # fill in DB URL, shared API key, and AWS/Bedrock settings
uvicorn app.main:app --reload
```

The API runs at `http://localhost:8000`, with interactive docs at `http://localhost:8000/docs`. Verify it:

```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

### 3. Frontend

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env     # set the API base URL and any mock-mode flag
npm run dev
```

Open the local URL that Vite prints.

### 4. Seed demo data

Run the project's seed scripts (see `backend/seed/`) to create the demo kitchen, menu, ingredients, recipes, and orders. Generate a baseline schedule before testing recovery proposals.

Never commit `.env` files or real credentials.

## API overview

All endpoints except `GET /health` require the shared `X-API-Key` header (MVP).

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/ingredients` | Read current stock |
| `GET` | `/api/menu` | Menu costs, profit, and margins |
| `POST` | `/api/pricing/analyze` | Analyse a dish price; optionally create a pending proposal |
| `GET` | `/api/orders` | List orders |
| `POST` | `/api/orders/extract` | Extract an order draft from pasted message text |
| `POST` | `/api/plan/generate` | Generate a daily schedule |
| `GET` | `/api/plan` | Read the schedule |
| `GET` | `/api/brief` | Shortages and orders at risk |
| `POST` | `/api/recovery/propose` | Generate and score recovery options |
| `GET` | `/api/actions` | List proposed actions |
| `POST` | `/api/actions/{id}/approve` | Approve and execute a pending action |
| `POST` | `/api/actions/{id}/reject` | Reject a pending proposal |
| `GET` | `/api/audit` | Change history |
| `POST` | `/api/audit/{id}/undo` | Create an approval-gated undo proposal |
| `POST` | `/api/agent/chat` | Voice/text assistant (read and propose only) |
| `GET` | `/api/summary` | Day-end summary |

Example authenticated call:

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:8000/api/ingredients
```

Set `API_KEY` to the local development key configured for the backend. Full schemas and example payloads are in [`docs/Rest_API_Spec.md`](docs/Rest_API_Spec.md).

## Demo walkthrough

Suggested scenario: a **paneer shortage affecting multiple upcoming orders**.

1. Generate the baseline plan for the day.
2. Open the risk brief and spot the shortage.
3. Generate recovery options and compare them with the do-nothing baseline.
4. Review delivery, cost, margin, and customer-consent implications.
5. Confirm one specific option by button or voice.
6. Review the updated schedule and the customer message drafts.
7. Inspect the audit log and, if you like, propose and approve an undo.
8. Review the day-end summary.

All figures in the demo are simulated unless labelled otherwise.

## Testing

```bash
cd backend
pytest
```

Test coverage should include:

- Invalid inputs and missing configuration
- Schedule feasibility and greedy fallback behaviour
- Proposal approval and rejection
- Duplicate approval (idempotency)
- Revalidation when plan or stock has changed
- Audit entries and approval-gated undo
- Order extraction validation and ambiguous messages
- Simulated-versus-verified data labels

## Security notes

- Never commit AWS credentials, database passwords, API keys, or `.env` files.
- The frontend must not contain database credentials or AWS secrets.
- Restrict CORS to the intended frontend origin in deployed environments.
- Validate all API inputs.
- Treat pasted customer messages as untrusted data, never as instructions to the AI.
- Keep approval separate from AI proposal generation.
- The MVP uses a shared API key and a single demo kitchen. This is not a substitute for production-grade authentication or multi-tenant authorisation.

## Scope and future work

**MVP scope:** risk detection, scheduling, recovery simulation, impact comparison, explicit approval, order intake, customer message drafts, audit/undo, pricing analysis, and day-end reporting.

**Next steps:**

- Real Alexa+ device integration and an MCP wrapper (subject to hackathon-track rules)
- Demand forecasting from real, labelled order history
- Live inventory and supplier integrations
- WhatsApp Business API and delivery-platform integrations
- Multi-kitchen accounts, staff roles, and stronger authentication
- Personalised option ranking from owner approval history

Forecasting or accuracy claims should not be made from simulated history alone.

## Documentation

- [`docs/PRD.md`](docs/PRD.md): product requirements and user journeys
- [`docs/System_Architecture.md`](docs/System_Architecture.md): architecture and technology choices
- [`docs/Rest_API_Spec.md`](docs/Rest_API_Spec.md): REST API contracts
- [`docs/Database_Schema.md`](docs/Database_Schema.md): schema, relationships, and integrity rules

## Team

Built by the OperAI team for the **Amazon Developer Hackathon 2026, Alexa+ track**.

Team members: _add names and roles_

---

**OperAI — Spot the risk. Compare the options. Keep the owner in control.**
