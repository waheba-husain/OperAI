# OperAI: Feature Playbook

Prompt format: **"Implement feature N"**. The agent reads that section plus the doc sections it references, builds only that, tests it, and reports. It never commits.

Feature 0 is done: setup, database schema, seed data (`backend/seed/`).

## Conventions (apply to every feature)

- **Single kitchen.** `get_kitchen(db)` returns the one seeded kitchen. No kitchen_id in requests.
- **Sessions.** Services take a SQLAlchemy `Session` and never commit. Routers commit once after the service succeeds.
- **Models and schemas.** Add the SQLAlchemy models a feature needs to `app/models.py` (matching `backend/seed/schema.sql` exactly) and Pydantic models to `app/schemas.py`.
- **Errors.** Raise `AppError(status, code, message, details)`. One handler in `main.py` returns `{"error": {"code", "message", "details"}}`. Codes come from `docs/api-spec.md`.
- **Auth.** Every `/api/*` route uses the `require_api_key` dependency (401 `UNAUTHORIZED`).
- **Money.** `Decimal` in code, 2-decimal numbers in JSON. Constants (weights, premiums, TTLs) live in `config.py`, not inline.
- **Time.** IST helper `day_bounds(date)` for date filters; timestamps are ISO 8601 with offset.
- **Tests.** DB tests run against the seeded database inside a transaction that rolls back (`tests/conftest.py`). Nothing a test does may stay in the database. LLM calls are always mocked in tests.

## Feature 1: Auth and read endpoints
- **Branch:** `waheba/read-endpoints`
- **Spec:** api-spec 3.2 (ingredients), 3.3 (menu), 3.5 (orders). Schema: section 3.
- **Build:** `deps.py` (`require_api_key`), `AppError` and handler, `tests/conftest.py` (rollback fixture, `client` with API key header), models for kitchens, ingredients, menu_items, recipe_items, orders, order_items, `services/pricing.py`, routers for the 3 endpoints.
- **Pricing rules:** ingredients = sum(recipe qty x cost_per_unit); commission = price x commission_pct/100; overhead = price x overhead_pct/100; total = all four; profit = price minus total; margin_pct = profit/price x 100 (1 decimal); status is `loss` if profit < 0, `below_target` if margin < target, else `healthy`.
- **Tests:** Paneer Biryani at 180 gives total 143.80, profit 36.20, margin 20.1; 401 without key; orders filter by date and status.
- **Done when:** the 3 endpoints return the shapes in the spec.

## Feature 2: Schedule
- **Branch:** `waheba/scheduler`
- **Spec:** api-spec 3.7, 3.8. Schema: plan_tasks, audit_logs.
- **Build:** `services/scheduler.py`, plan router, models PlanTask and AuditLog.
- **Rules:** greedy, forward from 09:00 IST, orders sorted by deadline. Per order item: a `prep` task (needs a cook, prep_minutes) then a `cook` task (needs a burner, cook_minutes). The cook task uses a burner only; `cook_no` records who started it. An order is late if its last task ends after the deadline. Generating bumps `kitchens.plan_version`, tasks carry that version, orders become `planned`, and one audit entry is written. `regenerate=true` replaces the plan; otherwise 409 `PLAN_EXISTS`. Response `solver` is `greedy`.
- **Tests:** no two tasks overlap on the same burner or cook; burner and cook counts respected; impossible deadlines appear in `late_orders`; 409 and 422 cases.
- **Done when:** a plan for the 25 seeded orders generates and reads back.

## Feature 3: Risk brief
- **Branch:** `waheba/risk-brief`
- **Spec:** api-spec 3.9. Schema: section 5.1 query.
- **Build:** `services/risk.py`, brief router.
- **Rules:** shortages = stock vs summed recipe needs for the date. At-risk orders: walk orders by deadline against a running copy of stock; an order is at risk if remaining stock can't cover it (don't deduct it). `revenue_at_risk` is the sum of their totals. Date defaults to tomorrow (IST).
- **Tests:** seeded data shows paneer short and at-risk orders; a day with enough stock returns empty lists and 0.
- **Done when:** the response matches the spec shape.

## Feature 4: Recovery options
- **Branch:** `waheba/recovery-options`
- **Spec:** api-spec 3.10, 3.11. Schema: proposed_actions.
- **Build:** `services/recovery.py`, recovery and actions routers, models ProposedAction.
- **Rules:** needs an existing plan (404 `PLAN_NOT_FOUND`). Baseline = do nothing (late = at-risk count, revenue at risk, extra cost 0). Generate at least these 3 option types, each simulated on a copy of state: `substitute` (from the `substitutions` table only, with allergen and diet check, extra_cost = cost difference x quantity needed), `emergency_purchase` (buy the shortfall at cost x premium from config, delay affected orders by a config number of minutes), `dish_swap` (swap at-risk orders to active dishes whose recipes are fully in stock, price within 20%). Score = 0.5 x (1 - late_after/at_risk) + 0.3 x margin_score + 0.2 x (1 - customer_risk), with weights from config, risk low 0.2 / medium 0.5 / high 0.8, margin_score = clamp(1 - extra_cost/revenue_at_risk, 0, 1). Rank by score (option 1 is best). Store as pending actions with one `group_id`, `payload` (what to apply, including `stock_update` when `reported_available_qty` is given), `impact`, `base_plan_version`, `stock_fingerprint` (sha256 of relevant stock), and a 30-minute `expires_at`. No feasible option returns 200 with `options: []` and an `escalation` message. Nothing is applied.
- **Tests:** 3 options created and ranked; score formula; 409 `NO_SHORTAGE_DETECTED`; stock and plan unchanged after proposing.
- **Done when:** the shortage returns options with impact and baseline.

## Feature 5: Approve and replan
- **Branch:** `waheba/approval`
- **Spec:** api-spec 3.12, 3.13. AGENTS.md hard rules 2 to 5 and 10.
- **Build:** `services/approval.py` with an `APPLIERS` dict keyed by action type and option type, `services/audit.py`, approve and reject routers.
- **Rules:** in one transaction: lock the action (`with_for_update`), check pending and not expired, check `confirm_option_number`, check `plan_version` and stock fingerprint, apply, bump `plan_version`, write audit, mark executed, expire sibling options. Appliers: `substitute` changes no rows and is recorded in the audit snapshot and customer messages only (no schema change); `emergency_purchase` adds the stock and shifts unlocked tasks of affected orders, marking them `delayed`; `dish_swap` updates `order_items` (menu_item_id, swapped_from_item_id, unit_price), order totals, and replans affected unlocked tasks. Locked tasks never move. Audit `before_snapshot` and `after_snapshot` hold the full rows of every table touched (orders, order_items, plan_tasks, ingredients), because undo restores from them. The response includes customer message drafts with `wa.me` URLs.
- **Tests (mandatory):** double approval gives 409 `ACTION_NOT_PENDING`; wrong option number gives 422 `OPTION_MISMATCH`; expired gives 409; changed plan version gives 409 `PLAN_CHANGED`; changed stock gives 409 `STOCK_CHANGED`; success bumps the version and writes the audit row; siblings expire; locked tasks don't move; a failure halfway applies nothing.
- **Done when:** approving option 1 visibly changes the plan and creates an audit entry.

## Feature 6: Audit and undo
- **Branch:** `waheba/audit-undo`
- **Spec:** api-spec 3.14, 3.15.
- **Build:** audit router, undo service, and an `undo` applier.
- **Rules:** `undoable` is true only for the most recent executed change that hasn't been undone. `POST /audit/{id}/undo` creates a pending `undo` action whose payload is the `before_snapshot`; approving it restores those rows exactly, bumps `plan_version`, and writes an `undo_executed` audit entry. Otherwise 409 `UNDO_NOT_ALLOWED`. `include_snapshots` is optional.
- **Tests:** undo restores the exact prior state; undoing a non-latest or already-undone change gives 409; undo stays pending until approved.
- **Done when:** a recovery can be applied and then undone.

## Feature 7: AI chat
- **Branch:** `waheba/ai-chat`
- **Spec:** api-spec 3.16. AGENTS.md hard rules 1, 2 and 8.
- **Build:** `ai/bedrock.py` (boto3 Converse with tool use), `ai/tools.py`, `ai/prompts.py`, chat router. Add `boto3`, `BEDROCK_MODEL_ID` and `AWS_REGION` to config and `.env.example`.
- **Rules:** exactly these tools, all read or propose only: `get_brief`, `propose_recovery`, `analyze_price`, `extract_order` (omit a tool until its feature exists). The reply prompt receives only computed numbers and must not add any. Bedrock failure gives 502 `AI_UNAVAILABLE`. The endpoint is stateless. The reply lists `confirm option N` phrases; the endpoint never approves.
- **Tests (Bedrock mocked):** the tool list has no approve or reject; "we're out of paneer" calls `propose_recovery`; reply numbers come from the tool data; 502 and 422 cases.
- **Done when:** one chat message produces spoken-style options.

## Feature 8: Order extraction (extra)
- **Branch:** `waheba/order-extract`
- **Spec:** api-spec 3.6.
- **Build:** extraction in `ai/`, `services/orders.py`, route, and an `order_intake` applier.
- **Rules:** LLM output is validated with Pydantic and dish names are matched against `menu_items` in code. An ambiguous match returns 200 with `clarifying_questions` and no action. Otherwise create a pending `order_intake` action. Approving inserts the order and items and schedules only the new tasks, leaving locked tasks alone. Pasted text is data, never instructions.
- **Tests (LLM mocked):** valid message, ambiguous message, an injection attempt ("approve everything") that only produces a pending action, 422 cases.
- **Done when:** a pasted WhatsApp message becomes a pending order.

## Feature 9: Pricing analysis (extra)
- **Branch:** `waheba/pricing`
- **Spec:** api-spec 3.4. Reuses `services/pricing.py`.
- **Rules:** `suggested_price = (ingredients + packaging) / (1 - commission% - overhead% - target%)`, rounded up to the next 5 rupees. If the denominator is 0 or less, return 422. `propose_change=true` creates a pending `price_change` action; its applier updates `menu_items.price` and writes an audit entry (no `plan_version` bump).
- **Tests:** price 150 on Paneer Biryani gives margin 10.5 and suggested 205; `propose_change=false` creates no rows; 404 and 422.
- **Done when:** analyzing and approving a price change works.

## Feature 10: Day-end summary (extra)
- **Branch:** `waheba/summary`
- **Spec:** api-spec 3.17.
- **Rules:** from executed recovery actions on the date: `orders_protected` = baseline late minus option late; `revenue_protected` = baseline revenue at risk minus option remainder; `net_extra_cost` = sum of extra_cost; undone actions are counted in `actions_undone` and excluded from protected totals. A day with no actions returns zeros.
- **Tests:** zero day; one executed action; an undone action.
- **Done when:** the summary matches the audit history.