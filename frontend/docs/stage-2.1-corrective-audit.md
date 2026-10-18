# Stage 2.1 Corrective Audit: Frontend-to-Backend Data Contracts

**Document Path:** `frontend/docs/stage-2.1-corrective-audit.md`  
**Status:** Completed Corrective Pass (Audit & Specification Only)  
**Target Next Phase:** Stage 2.2 (TypeScript DTO Creation)  
**Ownership Scope:** `frontend/` only (no backend code or backend docs modified)  
**Sources of Truth:**  
- `AGENTS.md`  
- `docs/Rest_API_Spec.md`  
- `docs/Database_Schema.md`  
- `docs/System_Architecture.md`  

---

## 1. Executive Summary

This corrective audit establishes a verified data contract foundation before creating TypeScript Data Transfer Objects (DTOs) in Stage 2.2.

Key findings:
1. **Contract Source Integrity**: The backend REST API defines 17 endpoints (`Rest_API_Spec.md`). The frontend Overview and Live Operations pages intersect with 7 read endpoints and 5 write/action endpoints.
2. **Menu Contract Resolution**: The previous audit flagged potential field conflicts in menu representations. This audit confirms that `menu_items` (database table), `GET /api/menu` (dish catalog with cost breakdown), and `POST /api/pricing/analyze` (what-if pricing tool) are three strictly separated contracts. They must never be combined into a single monolithic DTO.
3. **Core Architectural Gaps**:
   - The backend contains **no `stations` table**; kitchen capacity is modeled at the granular level of individual cooks (`cook_no`) and burners (`burner_no`).
   - The backend contains **no real-time progress percentages** (`progressPct`) on orders or tasks.
   - The backend contains **no historical pacing or multi-day analytics endpoints**; `PerformanceChart` weekly view cannot be populated by native backend data without additional API capabilities.
   - The backend contains **no `/api/alerts` endpoint**; operational alerts must be derived client-side from shortages, late orders, and pending actions.
4. **Status Mapping Ambiguities**: Backend order statuses (`new`, `planned`, `in_progress`, `delayed`, `partial`, `completed`, `cancelled`) have distinct lifecycle semantics that cannot be naively mapped 1:1 to delivery queue tabs without creating false operational assumptions.

---

## 2. Exact API Contract Findings

Each endpoint below is verified directly against `docs/Rest_API_Spec.md`.

### 2.1 `GET /api/orders`
- **Section**: `Rest_API_Spec.md` §3.5
- **Method & Path**: `GET /api/orders`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**:
  - `date` (`string`, optional): Format `YYYY-MM-DD` in IST. Filters by order deadline date.
  - `status` (`string`, optional): Allowed values: `new`, `planned`, `in_progress`, `delayed`, `partial`, `completed`, `cancelled`.
  - `limit` (`integer`, optional): Default 50, maximum 200.
- **Request Body**: None
- **Success Response Envelope (200)**:
  ```json
  {
    "data": [
      {
        "id": "o1",
        "customer_name": "Customer A",
        "channel": "whatsapp",
        "deadline": "2026-10-17T12:30:00+05:30",
        "status": "planned",
        "total_amount": 360.00,
        "items": [
          {
            "menu_item_id": "m_biryani",
            "name": "Paneer Biryani",
            "quantity": 2,
            "unit_price": 180.00
          }
        ]
      }
    ],
    "count": 1
  }
  ```
- **Field Types & Constraints**:
  - `data[].id`: `string` (UUID).
  - `data[].customer_name`: `string` (non-null).
  - `data[].channel`: `string`, enum: `whatsapp` | `instagram` | `swiggy` | `zomato` | `direct`.
  - `data[].deadline`: `string` (ISO 8601 with offset, e.g., `+05:30`).
  - `data[].status`: `string`, enum: `new` | `planned` | `in_progress` | `delayed` | `partial` | `completed` | `cancelled`.
  - `data[].total_amount`: `number` (2-decimal numeric, never float).
  - `data[].items`: `array` of line item objects.
  - `data[].items[].menu_item_id`: `string` (UUID).
  - `data[].items[].name`: `string`.
  - `data[].items[].quantity`: `integer` (CHECK > 0).
  - `data[].items[].unit_price`: `number` (2-decimal numeric).
  - `count`: `integer` (length of `data` array).
- **Errors**: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.

---

### 2.2 `GET /api/plan`
- **Section**: `Rest_API_Spec.md` §3.8
- **Method & Path**: `GET /api/plan`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**:
  - `date` (`string`, required): Format `YYYY-MM-DD` in IST.
- **Request Body**: None
- **Success Response Shape (200)**:
  ```json
  {
    "date": "2026-10-17",
    "plan_version": 4,
    "tasks": [
      {
        "id": "t1",
        "order_id": "o1",
        "order_item_id": "oi1",
        "dish": "Paneer Biryani",
        "task_type": "cook",
        "burner_no": 1,
        "cook_no": 1,
        "start_at": "2026-10-17T11:20:00+05:30",
        "end_at": "2026-10-17T11:55:00+05:30",
        "status": "scheduled",
        "locked": false
      }
    ],
    "late_orders": []
  }
  ```
- **Field Types & Constraints**:
  - `date`: `string` (`YYYY-MM-DD`).
  - `plan_version`: `integer` (monotonically increasing version counter).
  - `tasks`: `array` of scheduled task blocks.
  - `tasks[].id`: `string` (UUID).
  - `tasks[].order_id`: `string` (UUID).
  - `tasks[].order_item_id`: `string` (UUID).
  - `tasks[].dish`: `string` (menu item name snapshot).
  - `tasks[].task_type`: `string`, enum: `prep` | `cook` | `pack`.
  - `tasks[].burner_no`: `integer | null` (only non-null for `cook` tasks).
  - `tasks[].cook_no`: `integer` (1-indexed cook identifier).
  - `tasks[].start_at`: `string` (ISO 8601 with offset).
  - `tasks[].end_at`: `string` (ISO 8601 with offset, CHECK `end_at > start_at`).
  - `tasks[].status`: `string`, enum: `scheduled` | `in_progress` | `done` | `cancelled`.
  - `tasks[].locked`: `boolean` (true for in-progress tasks; replan must never move locked tasks per AGENTS.md rule 10).
  - `late_orders`: `array` of order UUIDs whose deadlines cannot be satisfied by the solver schedule.
- **Errors**: `401 UNAUTHORIZED`, `404 PLAN_NOT_FOUND`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.

---

### 2.3 `GET /api/brief`
- **Section**: `Rest_API_Spec.md` §3.9
- **Method & Path**: `GET /api/brief`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**:
  - `date` (`string`, optional): Format `YYYY-MM-DD` in IST (defaults to tomorrow if omitted).
- **Request Body**: None
- **Success Response Shape (200)**:
  ```json
  {
    "date": "2026-10-17",
    "order_count": 26,
    "shortages": [
      {
        "ingredient_id": "ing_paneer",
        "name": "Paneer",
        "unit": "kg",
        "stock_qty": 1.0,
        "needed_qty": 1.92,
        "short_by": 0.92
      }
    ],
    "at_risk_orders": [
      {
        "order_id": "o1",
        "customer_name": "Customer A",
        "deadline": "2026-10-17T12:30:00+05:30",
        "total_amount": 360.00
      }
    ],
    "revenue_at_risk": 1180.00,
    "data_source": "simulated"
  }
  ```
- **Field Types & Constraints**:
  - `date`: `string` (`YYYY-MM-DD`).
  - `order_count`: `integer`.
  - `shortages`: `array` of shortage records (empty array if no shortages).
  - `shortages[].ingredient_id`: `string` (UUID).
  - `shortages[].name`: `string`.
  - `shortages[].unit`: `string` (e.g. `kg`, `l`, `pcs`).
  - `shortages[].stock_qty`: `number` (numeric 3 decimals).
  - `shortages[].needed_qty`: `number` (numeric 3 decimals).
  - `shortages[].short_by`: `number` (numeric 3 decimals).
  - `at_risk_orders`: `array` of orders affected by shortages (empty array if none).
  - `revenue_at_risk`: `number` (2-decimal numeric, 0.00 if no shortages).
  - `data_source`: `string`, enum: `simulated` | `verified`.
- **Errors**: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.

---

### 2.4 `GET /api/actions`
- **Section**: `Rest_API_Spec.md` §3.11
- **Method & Path**: `GET /api/actions`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**:
  - `status` (`string`, optional): Allowed values: `pending`, `executed`, `rejected`, `expired`, `failed`.
  - `group_id` (`string`, optional): Filter by action group UUID.
  - `limit` (`integer`, optional): Default 50, maximum 200.
- **Request Body**: None
- **Success Response Envelope (200)**:
  ```json
  {
    "data": [
      {
        "id": "a1",
        "group_id": "g1",
        "option_number": 1,
        "action_type": "recovery",
        "title": "Use tofu instead of paneer in 4 orders",
        "status": "pending",
        "impact": {
          "late_orders": 0,
          "orders_protected": 4,
          "extra_cost": -147.20,
          "score": 0.82
        },
        "base_plan_version": 4,
        "created_at": "2026-10-16T19:30:00+05:30",
        "expires_at": "2026-10-16T21:30:00+05:30"
      }
    ],
    "count": 1
  }
  ```
- **Field Types & Constraints**:
  - `data[].id`: `string` (UUID).
  - `data[].group_id`: `string` (UUID, options generated together share this).
  - `data[].option_number`: `integer` (1, 2, 3... used for approval confirmation).
  - `data[].action_type`: `string`, enum: `recovery` | `price_change` | `order_intake` | `undo`.
  - `data[].title`: `string` (human-readable action summary).
  - `data[].status`: `string`, enum: `pending` | `approved` | `executed` | `rejected` | `expired` | `failed`.
  - `data[].impact`: `object` (polymorphic JSON payload depending on `action_type`).
  - `data[].base_plan_version`: `integer` (must match `kitchens.plan_version` at approval time).
  - `data[].created_at`: `string` (ISO 8601 with offset).
  - `data[].expires_at`: `string` (ISO 8601 with offset).
  - `count`: `integer`.
- **Errors**: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.

---

### 2.5 `GET /api/menu`
- **Section**: `Rest_API_Spec.md` §3.3
- **Method & Path**: `GET /api/menu`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**: None
- **Request Body**: None
- **Success Response Envelope (200)**:
  ```json
  {
    "data": [
      {
        "id": "m_biryani",
        "name": "Paneer Biryani",
        "price": 180.00,
        "cost_breakdown": {
          "ingredients": 72.20,
          "packaging": 14.00,
          "commission": 36.00,
          "overhead": 21.60,
          "total": 143.80
        },
        "profit_per_order": 36.20,
        "margin_pct": 20.1,
        "margin_status": "below_target",
        "is_active": true,
        "data_source": "simulated"
      }
    ],
    "count": 1
  }
  ```
- **Field Types & Constraints**:
  - `data[].id`: `string` (UUID).
  - `data[].name`: `string`.
  - `data[].price`: `number` (2-decimal numeric).
  - `data[].cost_breakdown`: `object` containing:
    - `ingredients`: `number`
    - `packaging`: `number`
    - `commission`: `number`
    - `overhead`: `number`
    - `total`: `number`
  - `data[].profit_per_order`: `number` (`price - cost_breakdown.total`).
  - `data[].margin_pct`: `number` (`(profit_per_order / price) * 100`).
  - `data[].margin_status`: `string`, enum: `loss` | `below_target` | `healthy`.
  - `data[].is_active`: `boolean`.
  - `data[].data_source`: `string`, enum: `simulated` | `verified`.
  - `count`: `integer`.
- **Errors**: `401 UNAUTHORIZED`, `500 INTERNAL_ERROR`.

---

### 2.6 `GET /api/summary`
- **Section**: `Rest_API_Spec.md` §3.17
- **Method & Path**: `GET /api/summary`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**:
  - `date` (`string`, optional): Format `YYYY-MM-DD` in IST (defaults to today).
- **Request Body**: None
- **Success Response Shape (200)**:
  ```json
  {
    "date": "2026-10-17",
    "orders_total": 26,
    "orders_completed": 26,
    "actions_executed": 1,
    "actions_undone": 0,
    "orders_protected": 4,
    "revenue_protected": 1180.00,
    "net_extra_cost": -147.20,
    "data_source": "simulated"
  }
  ```
- **Field Types & Constraints**:
  - `date`: `string` (`YYYY-MM-DD`).
  - `orders_total`: `integer`.
  - `orders_completed`: `integer`.
  - `actions_executed`: `integer`.
  - `actions_undone`: `integer`.
  - `orders_protected`: `integer`.
  - `revenue_protected`: `number` (2-decimal numeric).
  - `net_extra_cost`: `number` (2-decimal numeric, can be negative if savings were realized).
  - `data_source`: `string`, enum: `simulated` | `verified`.
- **Errors**: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.

---

### 2.7 `GET /api/audit`
- **Section**: `Rest_API_Spec.md` §3.14
- **Method & Path**: `GET /api/audit`
- **Authentication**: `X-API-Key: <key>` header
- **Query Parameters**:
  - `limit` (`integer`, optional): Default 50, maximum 200.
  - `event_type` (`string`, optional): Allowed values: `action_executed`, `action_rejected`, `undo_executed`, `order_created`, `stock_updated`.
  - `include_snapshots` (`boolean`, optional): Default false.
- **Request Body**: None
- **Success Response Envelope (200)**:
  ```json
  {
    "data": [
      {
        "id": "l1",
        "action_id": "a1",
        "event_type": "action_executed",
        "actor": "owner",
        "summary": "Swapped paneer for tofu in 4 orders; plan v4 to v5",
        "plan_version_before": 4,
        "plan_version_after": 5,
        "undoable": true,
        "created_at": "2026-10-16T19:42:10+05:30"
      }
    ],
    "count": 1
  }
  ```
- **Field Types & Constraints**:
  - `data[].id`: `string` (UUID).
  - `data[].action_id`: `string | null` (UUID, null for system events).
  - `data[].event_type`: `string`, enum: `action_executed` | `action_rejected` | `undo_executed` | `order_created` | `stock_updated`.
  - `data[].actor`: `string`, enum: `owner` | `system` | `agent`.
  - `data[].summary`: `string`.
  - `data[].plan_version_before`: `integer`.
  - `data[].plan_version_after`: `integer`.
  - `data[].undoable`: `boolean` (true only for the most recent executed action).
  - `data[].created_at`: `string` (ISO 8601 with offset).
  - `count`: `integer`.
- **Errors**: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.

---

### 2.8 Action & Mutation Endpoints Referenced by Frontend

| Endpoint | Method | Section | Purpose | Request Body | Success Response |
|---|---|---|---|---|---|
| `/api/recovery/propose` | POST | §3.10 | Generates scored recovery options | `{ date: string, ingredient_id: string, reported_available_qty?: number }` | `201`: `{ group_id, shortage, baseline, scoring, recommended_option_number, options[] }` |
| `/api/actions/{id}/approve` | POST | §3.12 | Atomic approval gate | `{ confirm_option_number: number, input_mode?: 'voice'\|'click', transcript?: string }` | `200`: `{ action, plan_version_before, plan_version_after, audit_id, changes, customer_messages[], expired_action_ids[] }` |
| `/api/actions/{id}/reject` | POST | §3.13 | Rejects a proposal | `{ reason?: string }` | `200`: `{ action: { id, status: 'rejected', decided_at }, audit_id }` |
| `/api/pricing/analyze` | POST | §3.4 | What-if price analysis | `{ menu_item_id: string, price?: number, propose_change?: boolean }` | `200` (or `201` if proposed): `{ menu_item_id, name, analyzed_price, current_price, cost_breakdown, profit_per_order, margin_pct, margin_status, suggested_price, suggested_profit_per_order, suggested_margin_pct, assumptions, action }` |
| `/api/orders/extract` | POST | §3.6 | NLP order intake from pasted message | `{ text: string }` | `201`: `{ draft, confidence, warnings[], action }` or `200`: `{ draft: null, confidence, clarifying_questions[], action: null }` |
| `/api/agent/chat` | POST | §3.16 | Voice & text conversational assistant | `{ message: string, input_mode?: 'voice'\|'text' }` | `200`: `{ reply, intent, tool_used, data, requires_confirmation, confirm_phrases[] }` |

---

## 3. Menu-Contract Discrepancy Analysis

### 3.1 The Three Independent Representations in Documentation
The earlier audit flagged potential ambiguity in menu models. Comparing all documentation reveals three distinct, non-interchangeable contracts:

1. **`docs/Database_Schema.md` §3.3 (`menu_items` table)**:
   - Database table storage columns: `id`, `kitchen_id`, `name`, `price`, `packaging_cost`, `prep_minutes`, `cook_minutes`, `is_active`, `data_source`.
   - *Note*: `cost_breakdown`, `profit_per_order`, `margin_pct`, `margin_status` are NOT stored in the database; they are computed dynamically in Python business logic (`services/pricing.py`).
2. **`docs/Rest_API_Spec.md` §3.3 (`GET /api/menu`)**:
   - Menu catalog listing response:
     ```json
     {
       "id": "m_biryani",
       "name": "Paneer Biryani",
       "price": 180.00,
       "cost_breakdown": { "ingredients": 72.20, "packaging": 14.00, "commission": 36.00, "overhead": 21.60, "total": 143.80 },
       "profit_per_order": 36.20,
       "margin_pct": 20.1,
       "margin_status": "below_target",
       "is_active": true,
       "data_source": "simulated"
     }
     ```
   - *Note*: Does NOT contain `current_price`, `analyzed_price`, `suggested_price`, `prep_minutes`, or `cook_minutes`.
3. **`docs/Rest_API_Spec.md` §3.4 (`POST /api/pricing/analyze`)**:
   - What-if pricing simulation response:
     ```json
     {
       "menu_item_id": "m_biryani",
       "name": "Paneer Biryani",
       "analyzed_price": 150.00,
       "current_price": 180.00,
       "cost_breakdown": { "ingredients": 72.20, "packaging": 14.00, "commission": 30.00, "overhead": 18.00, "total": 134.20 },
       "profit_per_order": 15.80,
       "margin_pct": 10.5,
       "margin_status": "below_target",
       "suggested_price": 205.00,
       "suggested_profit_per_order": 53.20,
       "suggested_margin_pct": 26.0,
       "assumptions": { "commission_pct": 20.0, "overhead_pct": 12.0, "target_margin_pct": 25.0, "data_source": "simulated" },
       "action": { "id": "a_price1", ... }
     }
     ```

### 3.2 Resolution for Frontend DTO Architecture
- **Do not create a unified "super-DTO"** that combines `GET /api/menu` and `POST /api/pricing/analyze`.
- In Stage 2.2, create two separate, strongly-typed DTOs:
  - `MenuItemDTO` strictly mirroring `GET /api/menu` (Section 3.3).
  - `PricingAnalysisResponseDTO` strictly mirroring `POST /api/pricing/analyze` (Section 3.4).
- `CostBreakdownDTO` is a shared sub-object:
  ```typescript
  export interface CostBreakdownDTO {
    readonly ingredients: number
    readonly packaging: number
    readonly commission: number
    readonly overhead: number
    readonly total: number
  }
  ```
- **Clarification Question for Backend Owner**: Confirm that `GET /api/menu` never returns top-level flattened fields like `packaging_cost` or `prep_minutes`, and always nests cost components inside `cost_breakdown`.

---

## 4. Frontend Field-Mapping Table

Every field currently consumed or rendered across Overview and Live Operations components is classified into one of four categories:
- **A**: Direct API Field (matches backend semantics directly)
- **B**: Safe Presentation Transformation (formatting, casing, stringification)
- **C**: Derived Value (computed deterministically from documented API fields)
- **D**: Unsupported Assumption (no documented API source; must remain simulated or be redesigned)

### 4.1 Order Queue (`OrderQueue.tsx` / `LiveOrder`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| `id` | **A** | `OrderDTO.id` | Passed through directly. |
| `ref` | **B** | `OrderDTO.id` | Formatted as `#ORD-${id.slice(0, 4).toUpperCase()}`. |
| `channelRef` | **B** | `OrderDTO.customer_name` + `channel` | Formatted as `${customer_name} — ${channel}`. |
| `channel` | **B** | `OrderDTO.channel` | Capitalized: `'swiggy'` → `'Swiggy'`, etc. |
| `items[].name` | **A** | `OrderDTO.items[].name` | Passed through directly. |
| `items[].qty` | **A** | `OrderDTO.items[].quantity` | Passed through directly. |
| `dueTime` | **B** | `OrderDTO.deadline` | Formatted to IST 12-hour time (e.g. `'12:30 PM'`). |
| `minutesUntilDue` | **C** | `OrderDTO.deadline` | `Math.round((new Date(deadline).getTime() - Date.now()) / 60000)`. |
| `urgency` | **C** | `OrderDTO.deadline` | `minutesUntilDue < 5` → `'critical'`; `< 15` → `'warning'`; else `'normal'`. |
| `status` | **C** | `OrderDTO.status` | Mapped via status adapter table (see §5). |
| `progressPct` | **D** | *None* | **Unsupported.** Backend `orders` table does not store completion percentage. Cannot be derived without task aggregation. |

### 4.2 Preparation Timelines (`PrepTasksTimeline.tsx` / `PrepTimeline.tsx`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| `id` | **A** | `PlanTaskDTO.id` | Passed through directly. |
| `title` | **B** | `PlanTaskDTO.dish` + `task_type` | Formatted as `${dish} (${task_type.toUpperCase()})`. |
| `timeWindow` | **B** | `PlanTaskDTO.start_at`, `end_at` | Formatted as `${startIST} – ${endIST}`. |
| `scheduledTime`| **B** | `PlanTaskDTO.start_at` | Formatted as `${startIST}`. |
| `durationMins` | **C** | `PlanTaskDTO.start_at`, `end_at` | `Math.round((new Date(end_at).getTime() - new Date(start_at).getTime()) / 60000)`. |
| `station` | **C** | `task_type`, `burner_no` | Derived workstation label (e.g. `Burner #${burner_no}` or `Cold Prep`). |
| `assignedTo` | **B** | `PlanTaskDTO.cook_no` | Formatted as `Cook ${cook_no}`. |
| `isLocked` | **A** | `PlanTaskDTO.locked` | Passed through directly. |
| `status` | **C** | `PlanTaskDTO.status` + `locked` | `locked ? 'locked' : statusMap[status]`. |
| `priority` | **D** | *None* | **Unsupported.** Solver schedules deadline-first; tasks have no priority column. |
| `progressPct` | **D** | *None* | **Unsupported.** Task completion in DB is discrete (`scheduled`, `in_progress`, `done`). |

### 4.3 Ingredient Alerts (`IngredientAlertsPanel.tsx` / `IngredientAlert`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| `id` | **A** | `BriefDTO.shortages[].ingredient_id` | Passed through directly. |
| `name` | **A** | `BriefDTO.shortages[].name` | Passed through directly. |
| `currentStock` | **B** | `stock_qty` + `unit` | Formatted as `${stock_qty} ${unit}`. |
| `requiredStock`| **B** | `needed_qty` + `unit` | Formatted as `${needed_qty} ${unit}`. |
| `deficit` | **B** | `short_by` + `unit` | Formatted as `-${short_by} ${unit}`. |
| `urgency` | **C** | `short_by` | `short_by > 0` → `'critical'`; threshold margin → `'warning'`. |
| `affectedDishesCount` | **C** | `BriefDTO.at_risk_orders` | Number of orders affected by this ingredient. |
| `category` | **D** | *None* | **Unsupported.** Neither `/api/brief` nor `ingredients` table has a category field. |
| `impactTime` | **D** | *None* | **Unsupported.** Backend does not predict hourly stockout timestamps (e.g. `'Expected at 18:30'`). Can at best display earliest at-risk order deadline. |

### 4.4 Overview KPIs (`KpiRow.tsx` / `KpiItem`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| `orders-today` | **C** | `GET /api/orders?date={today}` | Count of orders returned for today. |
| `orders-today` trend | **D** | *None* | **Unsupported.** Historical delta (`+18% vs yesterday`) has no backend source. |
| `revenue-today`| **C** | `GET /api/orders?date={today}` | Sum of `total_amount` across today's orders: `sum(orders.total_amount)`. |
| `profit-margin`| **C** | `GET /api/menu` | Mathematical average of `margin_pct` across menu dishes. |
| `profit-margin` trend | **D** | *None* | **Unsupported.** Historical margin delta (`+2.1% after yesterday's substitution`) has no backend source. |
| `orders-attention` | **C** | `BriefDTO.shortages` + `GET /api/actions?status=pending` | `shortages.length + pendingActions.length`. |

### 4.5 AI Kitchen Briefing (`AiBriefingPanel.tsx` / `AiKitchenBriefing`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| `title`, `timestamp` | **B** | Client-generated / `BriefDTO.date` | Formatted with current date and time. |
| `Shortage Horizon` observation | **C** | `BriefDTO.shortages`, `revenue_at_risk` | Formatted client-side: `"${name} is short by ${short_by} ${unit}. ₹${revenue_at_risk} at risk."` |
| `Margin Improvement` observation | **D** | *None* | **Unsupported.** Backend does not provide multi-day margin retrospectives in `/api/brief`. |
| `Station Pacing` observation | **D** | *None* | **Unsupported.** Backend does not compute real-time station delay minutes (e.g. `'Station 2 pacing 12 min behind'`). |
| `recommendedAction` | **C** | `GET /api/actions?status=pending` | Formatted from highest-priority pending proposal title. |

### 4.6 Performance Charts (`PerformanceChart.tsx`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| Today's hourly revenue & orders | **C** | `GET /api/orders?date={today}` | Derived by client-side bucketing today's orders by `deadline` hour. *Limitation*: Orders are bucketed by delivery deadline, not by time placed or time cooked. |
| 7-Day Pacing dataset | **D** | *None* | **Unsupported.** No multi-day aggregation endpoint exists. `GET /api/orders` supports only a single date. |

### 4.7 Stations & Utilization (`KitchenHealthPanel.tsx` / `StationsPanel.tsx`)
| UI Field | Category | Source API Field | Transformation / Derivation Logic |
|---|---|---|---|
| Named Stations (4 stations) | **D** | *None* | **Unsupported abstraction.** Backend schema models capacity as `cook_count` (int) and `burner_count` (int), with tasks assigned to `cook_no` and `burner_no`. |
| Workstation / Cook Load | **C** | `GET /api/plan` | Can calculate active cook utilization (`active_cooks / total_cooks`) during any given time window. |
| Average Station Utilization | **C** | `GET /api/plan` | Derived average load across active tasks vs total available cook/burner slots. |

---

## 5. Status-Mapping Table with Unresolved Semantics

### 5.1 Order Statuses (`orders.status`)

| Backend DB Status | Documented Definition (§3.5) | Frontend Current Tab | Semantically Defensible? | Unresolved Semantics / Backend Clarification Needed |
|---|---|---|---|---|
| `new` | Order extracted from customer message, approved into system. | `queued` | **Defensible** | Safe to display as queued before scheduling. |
| `planned` | Order included in the solver plan schedule. | `queued` | **Defensible** | Order has scheduled time blocks but cooking has not started. |
| `in_progress` | Cooking/preparation has commenced. | `prep` | **Defensible** | Directly corresponds to "In Prep". |
| `delayed` | Solver indicates deadline cannot be met on time. | `prep` | **AMBIGUOUS** | `delayed` is an urgency flag (late risk), NOT a physical kitchen station. Mapping it to `prep` hides whether it is queued, cooking, or plating. |
| `partial` | Order had partial substitution or portion shortage applied. | `plating` | **INCORRECT** | In the backend, `partial` means partial fulfillment, NOT "plating". Mapping `partial` to `plating` is semantically invalid. |
| `completed` | All kitchen tasks finished. | `dispatched` | **AMBIGUOUS** | `completed` in a cloud kitchen means food is boxed and ready at the counter. The backend does not integrate with Swiggy/Zomato dispatch APIs. Equating `completed` to `dispatched` implies delivery handover tracking that does not exist. |
| `cancelled` | Order cancelled by owner or customer. | *Hidden* | **Requires Decision** | Currently omitted from the queue. Should cancelled orders have a filter tab or be hidden? |

#### Recommended Temporary Order Status Mapping for Stage 2.2:
- Tab **"Queued"**: `new`, `planned`
- Tab **"In Prep"**: `in_progress`
- Tab **"Delayed / At Risk"**: `delayed` (keep separate or group with distinct badge)
- Tab **"Ready / Completed"**: `completed` (rename tab from "Dispatched" to "Ready" or "Completed")
- Tab **"Partial"**: Requires backend owner confirmation.

### 5.2 Plan Task Statuses (`plan_tasks.status`) and Lock State

| Backend Task State | Documented Definition (§3.8) | Frontend Timeline Status | Semantically Defensible? | Notes |
|---|---|---|---|---|
| `locked === true` | In-progress task; solver cannot move it. | `locked` | **Defensible** | Complies with AGENTS.md Rule 10. |
| `status === 'scheduled'` | Solved schedule block awaiting start. | `upcoming` | **Defensible** | Clean 1:1 mapping. |
| `status === 'in_progress'` | Currently cook-attended or on burner. | `in-progress` | **Defensible** | Clean 1:1 mapping. |
| `status === 'done'` | Task completed. | `completed` | **Defensible** | Clean 1:1 mapping. |
| `status === 'cancelled'` | Cancelled due to order swap or drop. | *Hidden* | **Defensible** | Filtered from active plan. |

---

## 6. Widget Data-Availability Matrix

Every Overview and Live Operations widget is evaluated for backend readiness:

| Widget | UI Component | Classification | Action Required for Stage 2.2 / 2.3 |
|---|---|---|---|
| **Revenue & Volume KPIs** | `KpiRow.tsx` | **Supportable via derivation** | Derive `orders-today` (count) and `revenue-today` (sum) from `GET /api/orders?date={today}`. Derive `profit-margin` from `GET /api/menu`. Suppress or mark historical trend pills as simulated. |
| **Attention Needed KPI** | `KpiRow.tsx` | **Supportable via derivation** | Derive from count of `BriefDTO.shortages` + `GET /api/actions?status=pending`. |
| **AI Kitchen Briefing** | `AiBriefingPanel.tsx` | **Requires Backend Clarification** | Generate Shortage observation from `GET /api/brief`. Suppress Margin and Station Pacing bullets, or keep clearly marked as simulated until a dedicated briefing API exists. |
| **Today's Hourly Chart** | `PerformanceChart.tsx` | **Supportable via derivation** | Bucket `GET /api/orders?date={today}` by `deadline` hour. |
| **7-Day Pacing Chart** | `PerformanceChart.tsx` | **Must remain simulated** | No multi-day historical API endpoint exists. Retain clearly labeled simulated pacing dataset. |
| **Kitchen Health / Station Load** | `KitchenHealthPanel.tsx` | **Requires Backend Clarification** | Derive `Average Station Utilization` from `GET /api/plan` task density vs total cook slots. Retain simulated badge on 4-station breakdown until station model is aligned. |
| **Ingredient Alerts** | `IngredientAlertsPanel.tsx` | **Directly supportable** | Map directly from `GET /api/brief` (`shortages` array). Category remains omitted or defaulted. |
| **Upcoming Prep Tasks** | `PrepTasksTimeline.tsx` | **Directly supportable** | Map directly from `GET /api/plan` (`tasks` array). Priority and progressPct defaulted or omitted. |
| **Active Order Queue** | `OrderQueue.tsx` | **Directly supportable** | Map directly from `GET /api/orders`. Realign tabs to avoid equating `partial` with `plating` or `completed` with `dispatched`. |
| **Live Prep Timeline** | `PrepTimeline.tsx` | **Directly supportable** | Map directly from `GET /api/plan` (`tasks` array). |
| **Stations Monitor** | `StationsPanel.tsx` | **Requires Backend Clarification** | Synthesize workstation activity from `plan_tasks` (`cook_no` and `task_type`), or keep simulated label prominent. |
| **Operational Alerts** | `OpsAlertsPanel.tsx` | **Supportable via derivation** | Synthesize client-side from `GET /api/brief` (`shortages`), `GET /api/plan` (`late_orders`), and `GET /api/actions` (`pending`). |

---

## 7. Concrete Questions for Backend Owner

These specific contract questions must be reviewed with the teammate owning the backend:

1. **`GET /api/menu` Response Structure**:  
   Does `GET /api/menu` strictly return the Section 3.3 envelope with a nested `cost_breakdown` object and no flattened `packaging_cost` / `prep_minutes` fields?
2. **Order Lifecycle Semantics**:  
   - What does `status = 'partial'` represent operationally? Is it partial fulfillment/delivery, or a preparation phase?  
   - Does `status = 'completed'` mean the kitchen has finished preparing the food (ready for pickup), or that the external delivery courier has picked it up?  
   - How should `status = 'delayed'` be handled in the queue—should it be a filter tab, or an urgency modifier on an active order?
3. **Station Concept vs Cook/Burner Model**:  
   The database schedules by `cook_no` (1..N) and `burner_no` (1..M), while the UI displays four physical stations ("Prep", "Grill/Sauté", "Tandoor", "Expo Gate"). Is grouping by `task_type` (`prep` → Cold Pantry, `cook` → Hot Line, `pack` → Expo Gate) acceptable as our official adapter strategy?
4. **Order Identifiers**:  
   Orders in the DB have UUID primary keys (`id: "c8e2..."`). Can the backend provide a short human-readable identifier (e.g. `order_number: 101` or `ref: "#ORD-4821"`), or should the frontend generate display tags via `id.slice(0, 4)`?
5. **Historical Analytics & Multi-Day Trends**:  
   Is there any planned backend endpoint for multi-day revenue pacing (e.g. `GET /api/analytics/pacing?days=7`), or should the 7-day chart view remain permanently labeled as simulated demo data for the hackathon?

---

## 8. Stage 2.2 Readiness Checklist

| Item | Status | Action in Stage 2.2 |
|---|---|---|
| Order DTO (`OrderDTO`, `OrderItemDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.5. |
| Plan DTO (`PlanResponseDTO`, `PlanTaskDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.8. |
| Brief DTO (`BriefResponseDTO`, `ShortageDTO`, `AtRiskOrderDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.9. |
| Action DTO (`ProposedActionDTO`, `ActionImpactDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.11. |
| Menu DTO (`MenuItemDTO`, `CostBreakdownDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.3 strictly. |
| Summary DTO (`DailySummaryDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.17. |
| Audit DTO (`AuditLogDTO`) | **READY** | Create in `src/types/dto.ts` matching §3.14. |
| API Client Module (`apiClient.ts`) | **BLOCKED until Stage 2.2** | Implements `fetch` with `X-API-Key` and error handling. |
| Adapter Functions (`src/api/adapters/`) | **BLOCKED until Stage 2.3** | Transforms DTOs into frontend View Models. |

---

## 9. Assumptions That Must NOT Be Encoded into DTOs

To preserve architectural honesty and adhere strictly to AGENTS.md:

1. **DO NOT add `progressPct` to `OrderDTO` or `PlanTaskDTO`**: The backend does not track partial percentages.
2. **DO NOT add `priority` to `PlanTaskDTO`**: The solver schedules tasks deadline-first; priority is not a backend property.
3. **DO NOT add `category` or `impactTime` to `ShortageDTO`**: These fields do not exist in `/api/brief`.
4. **DO NOT add `stations` arrays to backend DTOs**: Stations are a frontend abstraction, not a backend database entity.
5. **DO NOT combine `MenuItemDTO` with `PricingAnalysisDTO`**: Keep catalog listing and what-if simulation types separated.
6. **DO NOT add historical trend deltas (`+18% vs yesterday`) to DTOs**: The API provides point-in-time and daily data only.
7. **DO NOT add driver tracking or courier confirmation fields to `OrderDTO`**: OperAI does not integrate with driver tracking systems.
