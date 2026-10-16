# OperAI: REST API Specification

Companion to the OperAI PRD, System Architecture and Database Schema. All example data is **simulated**. Ids are shown as readable placeholders; real values are UUIDs.

## 1. Conventions

- **Base URL:** `http://localhost:8000` locally. Every endpoint lives under `/api`, except `GET /health`.
- **Authentication (MVP):** every endpoint except `/health` requires the header `X-API-Key: <key>` (shared secret from an env var, single demo kitchen). A missing or wrong key returns 401. FUTURE: JWT, with `kitchen_id` taken from the token.
- **Format:** JSON in and out, `Content-Type: application/json`. Lists are returned as `{ "data": [...], "count": n }`.
- **Types:** ids are UUID strings. Timestamps are ISO 8601 with offset (`2026-10-17T12:30:00+05:30`). `date` parameters are `YYYY-MM-DD` in IST. Money is INR as numbers with 2 decimals. All money, margin and schedule numbers are computed by the backend, never by the LLM.
- **Status codes:** 200 = success, nothing new stored. 201 = a record or pending action was created. 401, 404, 409 (state conflict), 422 (invalid input), 500, 502 (AI service down).
- **Error body (all errors):**

```json
{ "error": { "code": "ACTION_NOT_PENDING", "message": "Action a1 was already executed.", "details": {} } }
```

- **Approval rule:** the AI chat endpoint can only read or create pending proposals. Applying any proposed change happens only through `POST /api/actions/{id}/approve`, which requires the owner's explicit option number. The one other state-changing call is the initial plan generation.
- **Idempotency:** approving the same action twice never executes twice. The second call returns 409.

## 2. Endpoint overview

| # | Method | URL | Purpose |
| --- | --- | --- | --- |
| 1 | GET | `/health` | Liveness check |
| 2 | GET | `/api/ingredients` | Current stock |
| 3 | GET | `/api/menu` | Dishes with cost, profit and margin |
| 4 | POST | `/api/pricing/analyze` | Price what-if, suggested price, optional price proposal |
| 5 | GET | `/api/orders` | List orders |
| 6 | POST | `/api/orders/extract` | Turn a pasted WhatsApp message into a pending order |
| 7 | POST | `/api/plan/generate` | Generate the daily schedule |
| 8 | GET | `/api/plan` | Read the current schedule |
| 9 | GET | `/api/brief` | Proactive risk brief (stock vs orders) |
| 10 | POST | `/api/recovery/propose` | Generate scored recovery options |
| 11 | GET | `/api/actions` | List proposed actions |
| 12 | POST | `/api/actions/{id}/approve` | Approve and execute |
| 13 | POST | `/api/actions/{id}/reject` | Reject a proposal |
| 14 | GET | `/api/audit` | Change history |
| 15 | POST | `/api/audit/{id}/undo` | Propose an undo |
| 16 | POST | `/api/agent/chat` | Voice/text assistant (read and propose only) |
| 17 | GET | `/api/summary` | Day-end summary |

## 3. Endpoints

### 3.1 GET /health

- **Method:** GET
- **URL:** `/health`
- **Purpose:** Check the backend is running (used by the host and for demo warm-up).
- **Auth:** None
- **Request parameters:** None
- **Request body:** None

**Example request**

```bash
curl http://localhost:8000/health
```

**Example success response (200)**

```json
{ "status": "ok" }
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.2 GET /api/ingredients

- **Method:** GET
- **URL:** `/api/ingredients`
- **Purpose:** Show current stock, used for the shortage selector and stock view.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:8000/api/ingredients
```

**Example success response (200)**

```json
{
  "data": [
    { "id": "ing_paneer", "name": "Paneer", "unit": "kg", "stock_qty": 1.0, "cost_per_unit": 380.00,
      "allergen_tags": ["dairy"], "diet_tags": ["veg"], "data_source": "simulated" },
    { "id": "ing_tofu", "name": "Tofu", "unit": "kg", "stock_qty": 3.0, "cost_per_unit": 220.00,
      "allergen_tags": ["soy"], "diet_tags": ["veg", "vegan"], "data_source": "simulated" }
  ],
  "count": 2
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.3 GET /api/menu

- **Method:** GET
- **URL:** `/api/menu`
- **Purpose:** List dishes with the full cost breakdown (ingredients, packaging, commission, overhead), profit per order and margin status, so unprofitable dishes are visible.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:8000/api/menu
```

**Example success response (200)**

`margin_status` is one of `loss`, `below_target`, `healthy`.

```json
{
  "data": [
    { "id": "m_biryani", "name": "Paneer Biryani", "price": 180.00,
      "cost_breakdown": { "ingredients": 72.20, "packaging": 14.00, "commission": 36.00, "overhead": 21.60, "total": 143.80 },
      "profit_per_order": 36.20, "margin_pct": 20.1, "margin_status": "below_target",
      "is_active": true, "data_source": "simulated" },
    { "id": "m_pbm", "name": "Paneer Butter Masala", "price": 220.00,
      "cost_breakdown": { "ingredients": 48.80, "packaging": 16.00, "commission": 44.00, "overhead": 26.40, "total": 135.20 },
      "profit_per_order": 84.80, "margin_pct": 38.5, "margin_status": "healthy",
      "is_active": true, "data_source": "simulated" }
  ],
  "count": 2
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.4 POST /api/pricing/analyze

- **Method:** POST
- **URL:** `/api/pricing/analyze`
- **Purpose:** Analyze a dish at a given price (what-if), return the cost breakdown, profit and a suggested price that meets the kitchen's target margin. Optionally create a pending price-change proposal.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** `menu_item_id` (required), `price` (optional, defaults to the current price), `propose_change` (optional, default false). When true, a pending `price_change` action to set the suggested price is created and must be approved like any other action.

**Example request**

```bash
curl -X POST http://localhost:8000/api/pricing/analyze \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"menu_item_id": "m_biryani", "price": 150.00, "propose_change": true}'
```

**Example success response (201 when a proposal is created, 200 with `"action": null` otherwise)**

```json
{
  "menu_item_id": "m_biryani", "name": "Paneer Biryani",
  "analyzed_price": 150.00, "current_price": 180.00,
  "cost_breakdown": { "ingredients": 72.20, "packaging": 14.00, "commission": 30.00, "overhead": 18.00, "total": 134.20 },
  "profit_per_order": 15.80, "margin_pct": 10.5, "margin_status": "below_target",
  "suggested_price": 205.00, "suggested_profit_per_order": 53.20, "suggested_margin_pct": 26.0,
  "assumptions": { "commission_pct": 20.0, "overhead_pct": 12.0, "target_margin_pct": 25.0, "data_source": "simulated" },
  "action": {
    "id": "a_price1", "group_id": "g_price1", "option_number": 1, "action_type": "price_change",
    "title": "Set Paneer Biryani price to ₹205.00", "status": "pending",
    "impact": { "profit_per_order_before": 36.20, "profit_per_order_after": 53.20 },
    "expires_at": "2026-10-16T21:30:00+05:30"
  }
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 404 | MENU\_ITEM\_NOT\_FOUND | Unknown `menu_item_id` |
| 422 | VALIDATION\_ERROR | Missing field, or `price` is zero or negative |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.5 GET /api/orders

- **Method:** GET
- **URL:** `/api/orders`
- **Purpose:** List orders with their items.
- **Auth:** API key
- **Request parameters (query, all optional):** `date` (filter by deadline date), `status` (new, planned, in\_progress, delayed, partial, completed, cancelled), `limit` (default 50, max 200)
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" "http://localhost:8000/api/orders?date=2026-10-17&status=planned"
```

**Example success response (200)**

```json
{
  "data": [
    { "id": "o1", "customer_name": "Customer A", "channel": "whatsapp",
      "deadline": "2026-10-17T12:30:00+05:30", "status": "planned", "total_amount": 360.00,
      "items": [ { "menu_item_id": "m_biryani", "name": "Paneer Biryani", "quantity": 2, "unit_price": 180.00 } ] }
  ],
  "count": 1
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Bad `date`, unknown `status`, or `limit` out of range |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.6 POST /api/orders/extract

- **Method:** POST
- **URL:** `/api/orders/extract`
- **Purpose:** Extract an order from a pasted customer message (Bedrock, then schema validation). Creates a pending `order_intake` action; the order is only added after the owner approves. If the message is ambiguous, no action is created and clarifying questions are returned instead.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** `text` (required, 1 to 2000 characters). The text is treated as data, never as instructions.

**Example request**

```bash
curl -X POST http://localhost:8000/api/orders/extract \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"text": "Hi! 2 paneer biryani for tomorrow 1pm please. - Customer D 98XXXXXX10"}'
```

**Example success response (201)**

```json
{
  "draft": {
    "customer_name": "Customer D", "customer_phone": "98XXXXXX10", "channel": "whatsapp",
    "deadline": "2026-10-17T13:00:00+05:30",
    "items": [ { "menu_item_id": "m_biryani", "name": "Paneer Biryani", "quantity": 2, "unit_price": 180.00 } ],
    "total_amount": 360.00
  },
  "confidence": 0.93,
  "warnings": [],
  "action": { "id": "a_ord1", "group_id": "g_ord1", "option_number": 1, "action_type": "order_intake",
             "title": "Add order from Customer D (2 x Paneer Biryani)", "status": "pending",
             "expires_at": "2026-10-16T21:30:00+05:30" }
}
```

**Ambiguous message (200)**

```json
{ "draft": null, "confidence": 0.41,
  "clarifying_questions": ["Which dish: Paneer Biryani or Paneer Butter Masala?"], "action": null }
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Empty or too long `text` |
| 422 | EXTRACTION\_FAILED | No order could be found in the text |
| 502 | AI\_UNAVAILABLE | Bedrock unreachable |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.7 POST /api/plan/generate

- **Method:** POST
- **URL:** `/api/plan/generate`
- **Purpose:** Build the day's schedule from orders, recipes, stock, burners and cooks. Uses the constraint solver, and falls back to the greedy scheduler if the solver fails or times out. This is the baseline plan, so it needs no approval. Later changes to it always do.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** `date` (required), `regenerate` (optional, default false; must be true to replace an existing plan, and is audit-logged)

**Example request**

```bash
curl -X POST http://localhost:8000/api/plan/generate \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"date": "2026-10-17", "regenerate": false}'
```

**Example success response (201)**

```json
{ "date": "2026-10-17", "plan_version": 4, "solver": "cp_sat", "feasible": true,
  "orders_scheduled": 26, "task_count": 58, "late_orders": [] }
```

If deadlines cannot all be met, the plan is still returned and the problem orders are listed in `late_orders`. `solver` is `cp_sat` or `greedy`.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 409 | PLAN\_EXISTS | A plan already exists for the date and `regenerate` is false |
| 422 | NO\_ORDERS\_FOR\_DATE | Nothing to schedule |
| 422 | VALIDATION\_ERROR | Missing or invalid `date` |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.8 GET /api/plan

- **Method:** GET
- **URL:** `/api/plan`
- **Purpose:** Read the current schedule, used for the schedule board and before/after views.
- **Auth:** API key
- **Request parameters (query):** `date` (required)
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" "http://localhost:8000/api/plan?date=2026-10-17"
```

**Example success response (200)**

```json
{
  "date": "2026-10-17", "plan_version": 4,
  "tasks": [
    { "id": "t1", "order_id": "o1", "order_item_id": "oi1", "dish": "Paneer Biryani", "task_type": "cook",
      "burner_no": 1, "cook_no": 1, "start_at": "2026-10-17T11:20:00+05:30", "end_at": "2026-10-17T11:55:00+05:30",
      "status": "scheduled", "locked": false },
    { "id": "t2", "order_id": "o2", "order_item_id": "oi2", "dish": "Paneer Butter Masala", "task_type": "cook",
      "burner_no": 2, "cook_no": 2, "start_at": "2026-10-17T12:00:00+05:30", "end_at": "2026-10-17T12:25:00+05:30",
      "status": "scheduled", "locked": false }
  ],
  "late_orders": []
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 404 | PLAN\_NOT\_FOUND | No plan generated for that date |
| 422 | VALIDATION\_ERROR | Missing or invalid `date` |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.9 GET /api/brief

- **Method:** GET
- **URL:** `/api/brief`
- **Purpose:** The proactive risk brief. Compares the day's recipe needs with stock and lists shortages, at-risk orders and revenue exposed. Read-only, it creates nothing.
- **Auth:** API key
- **Request parameters (query):** `date` (optional, defaults to tomorrow)
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" "http://localhost:8000/api/brief?date=2026-10-17"
```

**Example success response (200)**

```json
{
  "date": "2026-10-17", "order_count": 26,
  "shortages": [ { "ingredient_id": "ing_paneer", "name": "Paneer", "unit": "kg",
                   "stock_qty": 1.0, "needed_qty": 1.92, "short_by": 0.92 } ],
  "at_risk_orders": [
    { "order_id": "o1", "customer_name": "Customer A", "deadline": "2026-10-17T12:30:00+05:30", "total_amount": 360.00 },
    { "order_id": "o2", "customer_name": "Customer B", "deadline": "2026-10-17T13:00:00+05:30", "total_amount": 220.00 },
    { "order_id": "o5", "customer_name": "Customer E", "deadline": "2026-10-17T13:15:00+05:30", "total_amount": 300.00 },
    { "order_id": "o9", "customer_name": "Customer I", "deadline": "2026-10-17T14:00:00+05:30", "total_amount": 300.00 }
  ],
  "revenue_at_risk": 1180.00,
  "data_source": "simulated"
}
```

With no shortages, `shortages` and `at_risk_orders` are empty arrays and `revenue_at_risk` is 0.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Invalid `date` |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.10 POST /api/recovery/propose

- **Method:** POST
- **URL:** `/api/recovery/propose`
- **Purpose:** Generate recovery options for a shortage. Each candidate action is applied to a copy of the plan and re-solved, then scored and compared with a do-nothing baseline. Options are stored as pending actions that share one `group_id`.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** `date` (required), `ingredient_id` (required), `reported_available_qty` (optional number; the quantity the owner says is actually available, e.g. 0 for "we're out of paneer". If omitted, database stock is used. If the owner approves an option, stock is set to this value as part of the action)

**Example request**

```bash
curl -X POST http://localhost:8000/api/recovery/propose \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"date": "2026-10-17", "ingredient_id": "ing_paneer"}'
```

**Example success response (201)**

Impact numbers are illustrative.

```json
{
  "group_id": "g1",
  "shortage": { "ingredient_id": "ing_paneer", "name": "Paneer", "short_by": 0.92, "unit": "kg" },
  "baseline": { "label": "Do nothing", "late_orders": 4, "revenue_at_risk": 1180.00, "extra_cost": 0.00 },
  "scoring": { "weights": { "lateness": 0.5, "margin": 0.3, "customer_risk": 0.2 } },
  "recommended_option_number": 1,
  "options": [
    { "action_id": "a1", "option_number": 1, "option_type": "substitute",
      "title": "Use tofu instead of paneer in 4 orders", "status": "pending", "needs_customer_consent": true,
      "impact": { "late_orders": 0, "orders_protected": 4, "revenue_at_risk_after": 0.00, "extra_cost": -147.20,
                  "margin_before_pct": 21.0, "margin_after_pct": 23.5, "customer_risk": "medium", "score": 0.82 },
      "expires_at": "2026-10-16T21:30:00+05:30" },
    { "action_id": "a2", "option_number": 2, "option_type": "emergency_purchase",
      "title": "Buy 1 kg paneer locally; 1 order runs 30 min late", "status": "pending", "needs_customer_consent": true,
      "impact": { "late_orders": 1, "orders_protected": 3, "revenue_at_risk_after": 300.00, "extra_cost": 40.00,
                  "margin_before_pct": 21.0, "margin_after_pct": 20.6, "customer_risk": "low", "score": 0.71 },
      "expires_at": "2026-10-16T21:30:00+05:30" },
    { "action_id": "a3", "option_number": 3, "option_type": "dish_swap",
      "title": "Swap 2 orders to Veg Pulao", "status": "pending", "needs_customer_consent": true,
      "impact": { "late_orders": 2, "orders_protected": 2, "revenue_at_risk_after": 600.00, "extra_cost": -22.00,
                  "margin_before_pct": 21.0, "margin_after_pct": 21.4, "customer_risk": "high", "score": 0.55 },
      "expires_at": "2026-10-16T21:30:00+05:30" }
  ]
}
```

`option_type` is one of `substitute`, `dish_swap`, `delay_notify`, `partial`, `emergency_purchase`. If no feasible option exists, the response is **200** with `"options": []` and an `"escalation"` message (for example, "No feasible option found. Contact customers or restock."). Nothing is created.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 404 | INGREDIENT\_NOT\_FOUND | Unknown `ingredient_id` |
| 404 | PLAN\_NOT\_FOUND | No plan exists for the date; call `/api/plan/generate` first |
| 409 | NO\_SHORTAGE\_DETECTED | Stock covers the day's needs and no lower `reported_available_qty` was given |
| 422 | VALIDATION\_ERROR | Missing field or negative quantity |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.11 GET /api/actions

- **Method:** GET
- **URL:** `/api/actions`
- **Purpose:** List proposed actions, mainly pending ones, so the UI can restore options after a page reload. The internal `payload` is not exposed.
- **Auth:** API key
- **Request parameters (query, all optional):** `status` (pending, executed, rejected, expired, failed), `group_id`, `limit` (default 50, max 200)
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" "http://localhost:8000/api/actions?status=pending"
```

**Example success response (200)**

```json
{
  "data": [
    { "id": "a1", "group_id": "g1", "option_number": 1, "action_type": "recovery",
      "title": "Use tofu instead of paneer in 4 orders", "status": "pending",
      "impact": { "late_orders": 0, "orders_protected": 4, "extra_cost": -147.20, "score": 0.82 },
      "base_plan_version": 4, "created_at": "2026-10-16T19:30:00+05:30", "expires_at": "2026-10-16T21:30:00+05:30" }
  ],
  "count": 1
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Unknown `status` or bad `limit` |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.12 POST /api/actions/{id}/approve

- **Method:** POST
- **URL:** `/api/actions/{id}/approve`
- **Purpose:** The approval gate. In one database transaction the backend locks the action, checks it is still pending and unexpired, checks the plan version and stock fingerprint are unchanged, applies the change, replans only affected tasks (locked tasks never move), writes the audit entry and expires sibling options.
- **Auth:** API key
- **Request parameters (path):** `id`, the action id
- **Request body:** `confirm_option_number` (required, must equal the action's `option_number`), `input_mode` (optional: `voice` or `click`), `transcript` (optional, stored in the audit entry for voice approvals)

**Example request**

```bash
curl -X POST http://localhost:8000/api/actions/a1/approve \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"confirm_option_number": 1, "input_mode": "voice", "transcript": "confirm option 1"}'
```

**Example success response (200)**

```json
{
  "action": { "id": "a1", "status": "executed", "executed_at": "2026-10-16T19:42:10+05:30" },
  "plan_version_before": 4, "plan_version_after": 5, "audit_id": "l1",
  "changes": { "orders_affected": ["o1", "o2", "o5", "o9"], "tasks_rescheduled": 2,
               "summary": "Swapped paneer for tofu in 4 orders; 0 orders late" },
  "customer_messages": [
    { "order_id": "o1", "customer_name": "Customer A", "needs_consent": true,
      "message": "Hi Customer A, we are short of paneer for tomorrow. May we use tofu instead? Reply YES to confirm.",
      "whatsapp_url": "https://wa.me/919800000010?text=Hi%20Customer%20A%2C%20we%20are%20short%20of%20paneer..." }
  ],
  "expired_action_ids": ["a2", "a3"]
}
```

`customer_messages` has one entry per affected order (one shown here). The `whatsapp_url` opens a prefilled chat; the owner sends it manually.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 404 | ACTION\_NOT\_FOUND | Unknown action id |
| 422 | OPTION\_MISMATCH | `confirm_option_number` does not match the action |
| 422 | VALIDATION\_ERROR | Missing or malformed body |
| 409 | ACTION\_NOT\_PENDING | Already executed, rejected or expired (this is also the duplicate-approval response) |
| 409 | ACTION\_EXPIRED | Past `expires_at` |
| 409 | PLAN\_CHANGED | Plan version moved since the proposal; propose again |
| 409 | STOCK\_CHANGED | Relevant stock changed since the proposal; propose again |
| 500 | INTERNAL\_ERROR | Transaction failed and was rolled back; nothing was applied |

### 3.13 POST /api/actions/{id}/reject

- **Method:** POST
- **URL:** `/api/actions/{id}/reject`
- **Purpose:** Owner declines a proposal ("none of these"). Marks it rejected and writes an audit entry. Changes no plan or stock.
- **Auth:** API key
- **Request parameters (path):** `id`, the action id
- **Request body:** `reason` (optional string)

**Example request**

```bash
curl -X POST http://localhost:8000/api/actions/a2/reject \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"reason": "Customer prefers to wait"}'
```

**Example success response (200)**

```json
{ "action": { "id": "a2", "status": "rejected", "decided_at": "2026-10-16T19:40:00+05:30" }, "audit_id": "l2" }
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 404 | ACTION\_NOT\_FOUND | Unknown action id |
| 409 | ACTION\_NOT\_PENDING | Action is no longer pending |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.14 GET /api/audit

- **Method:** GET
- **URL:** `/api/audit`
- **Purpose:** Change history, newest first, for the audit log screen.
- **Auth:** API key
- **Request parameters (query, all optional):** `limit` (default 50, max 200), `event_type` (action\_executed, action\_rejected, undo\_executed, order\_created), `include_snapshots` (default false; adds `before_snapshot` and `after_snapshot`)
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" "http://localhost:8000/api/audit?limit=10"
```

**Example success response (200)**

```json
{
  "data": [
    { "id": "l1", "action_id": "a1", "event_type": "action_executed", "actor": "owner",
      "summary": "Swapped paneer for tofu in 4 orders; plan v4 to v5",
      "plan_version_before": 4, "plan_version_after": 5, "undoable": true,
      "created_at": "2026-10-16T19:42:10+05:30" }
  ],
  "count": 1
}
```

`undoable` is true only for the most recent executed change that has not been undone.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Bad `limit` or unknown `event_type` |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.15 POST /api/audit/{id}/undo

- **Method:** POST
- **URL:** `/api/audit/{id}/undo`
- **Purpose:** Propose reversing a past change using its stored `before_snapshot`. Undo is itself approval-gated: this creates a pending `undo` action that the owner approves through `/api/actions/{id}/approve`.
- **Auth:** API key
- **Request parameters (path):** `id`, the audit entry id
- **Request body:** None

**Example request**

```bash
curl -X POST -H "X-API-Key: $API_KEY" http://localhost:8000/api/audit/l1/undo
```

**Example success response (201)**

```json
{
  "action": { "id": "a_undo1", "group_id": "g_undo1", "option_number": 1, "action_type": "undo",
             "title": "Undo: Swapped paneer for tofu in 4 orders", "status": "pending",
             "undo_of_audit_id": "l1", "base_plan_version": 5, "expires_at": "2026-10-16T21:30:00+05:30" }
}
```

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 404 | AUDIT\_NOT\_FOUND | Unknown audit id |
| 409 | UNDO\_NOT\_ALLOWED | Not the latest executed change, already undone, or not an executed change |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.16 POST /api/agent/chat

- **Method:** POST
- **URL:** `/api/agent/chat`
- **Purpose:** Conversational entry point for voice and text. Bedrock picks one read-or-propose tool (`get_brief`, `propose_recovery`, `analyze_price`, `extract_order`) and writes a spoken reply from the backend's numbers only. It **cannot approve or reject**. The frontend recognises "confirm option N" itself and calls the approve endpoint directly. The endpoint is stateless.
- **Auth:** API key
- **Request parameters:** None
- **Request body:** `message` (required, 1 to 500 characters), `input_mode` (optional: `voice` or `text`)

**Example request**

```bash
curl -X POST http://localhost:8000/api/agent/chat \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"message": "We are out of paneer", "input_mode": "voice"}'
```

**Example success response (200)**

```json
{
  "reply": "Paneer is short for tomorrow and four orders worth 1,180 rupees are at risk. Option 1: use tofu in four orders, saves 147 rupees, needs customer consent. Option 2: buy 1 kg locally, one order runs 30 minutes late. Say confirm option 1, or confirm option 2.",
  "intent": "report_shortage",
  "tool_used": "propose_recovery",
  "data": { "group_id": "g1", "option_action_ids": ["a1", "a2", "a3"] },
  "requires_confirmation": true,
  "confirm_phrases": ["confirm option 1", "confirm option 2", "confirm option 3"]
}
```

If the request is not understood, `intent` is `unknown`, `tool_used` is null and `reply` asks a clarifying question.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Empty or too long `message` |
| 502 | AI\_UNAVAILABLE | Bedrock unreachable; the direct endpoints above still work |
| 500 | INTERNAL\_ERROR | Backend failure |

### 3.17 GET /api/summary

- **Method:** GET
- **URL:** `/api/summary`
- **Purpose:** Day-end proof: orders protected and revenue preserved versus the do-nothing baseline, taken from the stored impact of executed actions. Build this last.
- **Auth:** API key
- **Request parameters (query):** `date` (optional, defaults to today)
- **Request body:** None

**Example request**

```bash
curl -H "X-API-Key: $API_KEY" "http://localhost:8000/api/summary?date=2026-10-17"
```

**Example success response (200)**

```json
{ "date": "2026-10-17", "orders_total": 26, "orders_completed": 26,
  "actions_executed": 1, "actions_undone": 0,
  "orders_protected": 4, "revenue_protected": 1180.00, "net_extra_cost": -147.20,
  "data_source": "simulated" }
```

On a day with no executed actions all counts and amounts are 0.

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 422 | VALIDATION\_ERROR | Invalid `date` |
| 500 | INTERNAL\_ERROR | Backend failure |

## 4. Status codes and error codes

| Status | Meaning | Error codes |
| --- | --- | --- |
| 200 | Success, nothing new stored |  |
| 201 | Record or pending action created |  |
| 401 | Missing or invalid API key | UNAUTHORIZED |
| 404 | Resource not found | MENU\_ITEM\_NOT\_FOUND, INGREDIENT\_NOT\_FOUND, PLAN\_NOT\_FOUND, ACTION\_NOT\_FOUND, AUDIT\_NOT\_FOUND |
| 409 | State conflict | PLAN\_EXISTS, NO\_SHORTAGE\_DETECTED, ACTION\_NOT\_PENDING, ACTION\_EXPIRED, PLAN\_CHANGED, STOCK\_CHANGED, UNDO\_NOT\_ALLOWED |
| 422 | Invalid input | VALIDATION\_ERROR, OPTION\_MISMATCH, EXTRACTION\_FAILED, NO\_ORDERS\_FOR\_DATE |
| 500 | Server error (transactions roll back) | INTERNAL\_ERROR |
| 502 | AI service unreachable | AI\_UNAVAILABLE |

## 5. Hero journey, call by call

1. `POST /api/plan/generate` creates the baseline schedule.
2. `GET /api/brief` shows the shortage and revenue at risk.
3. `POST /api/recovery/propose` (or `POST /api/agent/chat` with "we are out of paneer") creates the options.
4. The owner says "confirm option 1"; the frontend calls `POST /api/actions/{id}/approve`.
5. `GET /api/plan` shows the updated schedule and the response shows before/after plus customer messages.
6. `GET /api/audit` shows the entry; `POST /api/audit/{id}/undo` then approve reverses it.
7. `GET /api/summary` shows orders protected and revenue preserved.

## 6. Deliberately left out

- **No create/update/delete endpoints for menu, ingredients or orders.** The MVP uses seeded data, and orders arrive through `/api/orders/extract`.
- **No auth, signup or user endpoints.** A shared API key is enough for one kitchen.
- **No separate customer-notification endpoint.** Message drafts are returned by the approve call.
- **No WebSockets or polling endpoints.** The frontend refetches after each action.
- **No endpoint that lets the AI approve anything.**
