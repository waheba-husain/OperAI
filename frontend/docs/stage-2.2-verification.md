# Stage 2.2 Verification Report: DTO Accuracy Audit

**Document Path:** `frontend/docs/stage-2.2-verification.md`  
**Phase:** Stage 2.2 Verification Pass  
**Target Files:**  
- `frontend/src/types/dto.ts`  
- `frontend/docs/stage-2.2-dto-notes.md`  
**Sources of Truth:**  
- `AGENTS.md`  
- `docs/Rest_API_Spec.md`  
- `docs/Database_Schema.md`  
- `docs/System_Architecture.md`  
- `frontend/docs/stage-2.1-corrective-audit.md`  

---

## 1. Executive Summary

This verification pass audited all 52 TypeScript types, interfaces, and string-literal unions declared in `frontend/src/types/dto.ts` against the authoritative backend contracts in `docs/Rest_API_Spec.md` and `docs/Database_Schema.md`.

### Core Verification Findings:
1. **Contract Integrity (52/52 PASS)**: Every DTO accurately reflects the documented HTTP request/response payloads, field names (`snake_case`), primitive types (numeric for money, ISO 8601 strings for timestamps), nullability, and list envelopes (`{ data: [...], count }`).
2. **Strict Menu Separation**: `MenuItemDTO` represents `GET /api/menu` (§3.3) and `PricingAnalysisResponseDTO` represents `POST /api/pricing/analyze` (§3.4). No cross-endpoint fields were blended.
3. **Zero UI-Only Fields**: No frontend presentation properties (`progressPct`, `urgency`, `minutesUntilDue`, formatted timestamps, workstation aggregations, or fake order tags) were leaked into the DTO layer.
4. **Enums & Unions**: All enum unions match documented backend constraints and check constraints. No frontend display states were injected.
5. **Specification Ambiguities**: Identified and documented non-blocking presentation-level questions (such as whether `status = 'delayed'` in the queue should render as a filter tab or an urgency badge), confirming that none of these ambiguities compromise the accuracy of the DTO boundary.

---

## 2. Complete DTO Contract Verification Table

| # | DTO Name | Supporting Endpoint & Spec Section | Result | Exact Discrepancy / Evidence Notes |
|---|---|---|---|---|
| 1 | `DataSourceDTO` | `Rest_API_Spec.md` §3.2, §3.3, §3.4, §3.9, §3.17; `Database_Schema.md` §1; `AGENTS.md` Rule 9 | **PASS** | Exact match: `'simulated' \| 'verified'`. Enforced across all seeded models. |
| 2 | `OrderChannelDTO` | `Rest_API_Spec.md` §3.5; `Database_Schema.md` §3.6 | **PASS** | Exact match: `'whatsapp' \| 'instagram' \| 'swiggy' \| 'zomato' \| 'direct'`. Matches DB CHECK constraint. |
| 3 | `OrderStatusDTO` | `Rest_API_Spec.md` §3.5; `Database_Schema.md` §3.6 | **PASS** | Exact match: `'new' \| 'planned' \| 'in_progress' \| 'delayed' \| 'partial' \| 'completed' \| 'cancelled'`. Matches DB CHECK constraint and §3.5 query enum. |
| 4 | `PlanTaskTypeDTO` | `Rest_API_Spec.md` §3.8; `Database_Schema.md` §3.8 | **PASS** | Exact match: `'prep' \| 'cook' \| 'pack'`. Matches DB CHECK constraint. |
| 5 | `PlanTaskStatusDTO` | `Rest_API_Spec.md` §3.8; `Database_Schema.md` §3.8 | **PASS** | Exact match: `'scheduled' \| 'in_progress' \| 'done' \| 'cancelled'`. Matches DB CHECK constraint. |
| 6 | `MarginStatusDTO` | `Rest_API_Spec.md` §3.3, §3.4 | **PASS** | Exact match: `'loss' \| 'below_target' \| 'healthy'`. Explicitly enumerated in §3.3. |
| 7 | `ActionTypeDTO` | `Rest_API_Spec.md` §3.4, §3.6, §3.11, §3.15; `Database_Schema.md` §3.9 | **PASS** | Exact match: `'recovery' \| 'price_change' \| 'order_intake' \| 'undo'`. Matches DB CHECK constraint. |
| 8 | `ActionStatusDTO` | `Rest_API_Spec.md` §3.11, §3.12, §3.13; `Database_Schema.md` §3.9 | **PASS** | Exact match: `'pending' \| 'approved' \| 'executed' \| 'rejected' \| 'expired' \| 'failed'`. Matches DB CHECK constraint. |
| 9 | `RecoveryOptionTypeDTO` | `Rest_API_Spec.md` §3.10 | **PASS** | Exact match: `'substitute' \| 'dish_swap' \| 'delay_notify' \| 'partial' \| 'emergency_purchase'`. Explicitly enumerated in §3.10. |
| 10 | `AuditEventTypeDTO` | `Rest_API_Spec.md` §3.14; `Database_Schema.md` §3.10 | **PASS** | Exact match: `'action_executed' \| 'action_rejected' \| 'undo_executed' \| 'order_created' \| 'stock_updated'`. Matches DB column specification and §3.14 query parameters. |
| 11 | `AuditActorDTO` | `Rest_API_Spec.md` §3.14; `Database_Schema.md` §3.10 | **PASS** | Exact match: `'owner' \| 'system' \| 'agent'`. Matches DB CHECK constraint. |
| 12 | `ApiErrorDTO` | `Rest_API_Spec.md` §1 | **PASS** | Exact match: `{ code: string, message: string, details?: Record<string, unknown> }`. Matches standard error payload. |
| 13 | `ApiErrorResponseDTO` | `Rest_API_Spec.md` §1 | **PASS** | Exact match: `{ error: ApiErrorDTO }`. Matches documented 4xx/5xx error envelope. |
| 14 | `ApiListResponseDTO<T>` | `Rest_API_Spec.md` §1 | **PASS** | Exact match: `{ data: readonly T[], count: number }`. Matches universal list envelope. |
| 15 | `OrderItemDTO` | `Rest_API_Spec.md` §3.5, §3.6 | **PASS** | Exact match: `{ menu_item_id, name, quantity, unit_price }`. Field names, types, and numeric constraints match §3.5 line item object. |
| 16 | `OrderDTO` | `Rest_API_Spec.md` §3.5 | **PASS** | Exact match: `{ id, customer_name, channel, deadline, status, total_amount, items }`. Timestamps are ISO strings with offset, amounts numeric 2 decimals. |
| 17 | `OrderListResponseDTO` | `Rest_API_Spec.md` §3.5 | **PASS** | Exact match: `ApiListResponseDTO<OrderDTO>`. Matches §3.5 200 response envelope. |
| 18 | `OrderDraftDTO` | `Rest_API_Spec.md` §3.6 | **PASS** | Exact match: `{ customer_name, customer_phone?, channel, deadline, items, total_amount }`. Matches §3.6 draft payload. |
| 19 | `OrderExtractSuccessResponseDTO` | `Rest_API_Spec.md` §3.6 | **PASS** | Exact match: `{ draft, confidence, warnings, action }`. Matches §3.6 201 response. |
| 20 | `OrderExtractAmbiguousResponseDTO` | `Rest_API_Spec.md` §3.6 | **PASS** | Exact match: `{ draft: null, confidence, clarifying_questions, action: null }`. Matches §3.6 200 ambiguous response. |
| 21 | `OrderExtractResponseDTO` | `Rest_API_Spec.md` §3.6 | **PASS** | Exact match: Discriminated union between 201 (draft created) and 200 (clarifying questions). |
| 22 | `PlanTaskDTO` | `Rest_API_Spec.md` §3.8; `Database_Schema.md` §3.8 | **PASS** | Exact match: `{ id, order_id, order_item_id, dish, task_type, burner_no, cook_no, start_at, end_at, status, locked }`. `burner_no` is properly typed `number \| null`. |
| 23 | `PlanResponseDTO` | `Rest_API_Spec.md` §3.8 | **PASS** | Exact match: `{ date, plan_version, tasks, late_orders }`. Matches §3.8 200 response. |
| 24 | `PlanGenerateResponseDTO` | `Rest_API_Spec.md` §3.7 | **PASS** | Exact match: `{ date, plan_version, solver, feasible, orders_scheduled, task_count, late_orders }`. `solver` is `'cp_sat' \| 'greedy'`. Matches §3.7 201 response. |
| 25 | `ShortageDTO` | `Rest_API_Spec.md` §3.9 | **PASS** | Exact match: `{ ingredient_id, name, unit, stock_qty, needed_qty, short_by }`. Matches §3.9 shortage array item. |
| 26 | `AtRiskOrderDTO` | `Rest_API_Spec.md` §3.9 | **PASS** | Exact match: `{ order_id, customer_name, deadline, total_amount }`. Matches §3.9 at_risk_orders item. |
| 27 | `BriefResponseDTO` | `Rest_API_Spec.md` §3.9 | **PASS** | Exact match: `{ date, order_count, shortages, at_risk_orders, revenue_at_risk, data_source }`. Matches §3.9 200 response. |
| 28 | `CostBreakdownDTO` | `Rest_API_Spec.md` §3.3, §3.4 | **PASS** | Exact match: `{ ingredients, packaging, commission, overhead, total }`. All fields numeric with 2 decimals. |
| 29 | `MenuItemDTO` | `Rest_API_Spec.md` §3.3 | **PASS** | Exact match: `{ id, name, price, cost_breakdown, profit_per_order, margin_pct, margin_status, is_active, data_source }`. Contains no pricing simulation fields. |
| 30 | `MenuListResponseDTO` | `Rest_API_Spec.md` §3.3 | **PASS** | Exact match: `ApiListResponseDTO<MenuItemDTO>`. Matches §3.3 200 response envelope. |
| 31 | `PricingAnalysisAssumptionsDTO` | `Rest_API_Spec.md` §3.4 | **PASS** | Exact match: `{ commission_pct, overhead_pct, target_margin_pct, data_source }`. Matches §3.4 assumptions object. |
| 32 | `PricingAnalysisResponseDTO` | `Rest_API_Spec.md` §3.4 | **PASS** | Exact match: `{ menu_item_id, name, analyzed_price, current_price, cost_breakdown, profit_per_order, margin_pct, margin_status, suggested_price, suggested_profit_per_order, suggested_margin_pct, assumptions, action }`. Matches §3.4 200/201 response. |
| 33 | `ActionRecoveryImpactDTO` | `Rest_API_Spec.md` §3.10, §3.11 | **PASS** | Exact match: `{ late_orders, orders_protected, extra_cost, score, revenue_at_risk_after?, margin_before_pct?, margin_after_pct?, customer_risk? }`. Supports both §3.11 compact and §3.10 full impact. |
| 34 | `ActionPriceChangeImpactDTO` | `Rest_API_Spec.md` §3.4 | **PASS** | Exact match: `{ profit_per_order_before, profit_per_order_after }`. Matches §3.4 action impact object. |
| 35 | `ActionImpactDTO` | `Rest_API_Spec.md` §3.4, §3.10, §3.11; `Database_Schema.md` §3.9 | **PASS** | Exact match: Union of `ActionRecoveryImpactDTO \| ActionPriceChangeImpactDTO \| Record<string, unknown>`. Accurately models polymorphic JSONB column. |
| 36 | `ProposedActionDTO` | `Rest_API_Spec.md` §3.4, §3.6, §3.11, §3.15 | **PASS** | Exact match: `{ id, group_id, option_number, action_type, title, status, impact?, base_plan_version?, undo_of_audit_id?, created_at?, expires_at }`. |
| 37 | `ActionListResponseDTO` | `Rest_API_Spec.md` §3.11 | **PASS** | Exact match: `ApiListResponseDTO<ProposedActionDTO>`. Matches §3.11 200 response envelope. |
| 38 | `CustomerMessageDTO` | `Rest_API_Spec.md` §3.12 | **PASS** | Exact match: `{ order_id, customer_name, needs_consent, message, whatsapp_url }`. Matches §3.12 prefilled customer WhatsApp message item. |
| 39 | `ActionApproveResponseDTO` | `Rest_API_Spec.md` §3.12 | **PASS** | Exact match: `{ action: { id, status: 'executed', executed_at }, plan_version_before, plan_version_after, audit_id, changes, customer_messages, expired_action_ids }`. Matches §3.12 200 response. |
| 40 | `ActionRejectResponseDTO` | `Rest_API_Spec.md` §3.13 | **PASS** | Exact match: `{ action: { id, status: 'rejected', decided_at }, audit_id }`. Matches §3.13 200 response. |
| 41 | `RecoveryBaselineDTO` | `Rest_API_Spec.md` §3.10 | **PASS** | Exact match: `{ label, late_orders, revenue_at_risk, extra_cost }`. Matches §3.10 baseline object. |
| 42 | `RecoveryShortageSummaryDTO` | `Rest_API_Spec.md` §3.10 | **PASS** | Exact match: `{ ingredient_id, name, short_by, unit }`. Matches §3.10 shortage summary object. |
| 43 | `RecoveryScoringWeightsDTO` | `Rest_API_Spec.md` §3.10 | **PASS** | Exact match: `{ weights: { lateness, margin, customer_risk } }`. Matches §3.10 scoring object. |
| 44 | `RecoveryOptionDTO` | `Rest_API_Spec.md` §3.10 | **PASS** | Exact match: `{ action_id, option_number, option_type, title, status, needs_customer_consent, impact, expires_at }`. Matches §3.10 candidate option item. |
| 45 | `RecoveryProposeResponseDTO` | `Rest_API_Spec.md` §3.10 | **PASS** | Exact match: `{ group_id?, shortage?, baseline?, scoring?, recommended_option_number?, options, escalation? }`. Correctly models 201 candidate generation and 200 empty/escalation responses. |
| 46 | `AuditLogDTO` | `Rest_API_Spec.md` §3.14; `Database_Schema.md` §3.10 | **PASS** | Exact match: `{ id, action_id, event_type, actor, summary, plan_version_before?, plan_version_after?, undoable, created_at, before_snapshot?, after_snapshot? }`. `action_id` correctly nullable (`string \| null`). |
| 47 | `AuditListResponseDTO` | `Rest_API_Spec.md` §3.14 | **PASS** | Exact match: `ApiListResponseDTO<AuditLogDTO>`. Matches §3.14 200 response envelope. |
| 48 | `AuditUndoResponseDTO` | `Rest_API_Spec.md` §3.15 | **PASS** | Exact match: `{ action: ProposedActionDTO }`. Matches §3.15 201 response. |
| 49 | `IngredientDTO` | `Rest_API_Spec.md` §3.2 | **PASS** | Exact match: `{ id, name, unit, stock_qty, cost_per_unit, allergen_tags, diet_tags, data_source }`. Matches §3.2 stock array item. |
| 50 | `IngredientListResponseDTO` | `Rest_API_Spec.md` §3.2 | **PASS** | Exact match: `ApiListResponseDTO<IngredientDTO>`. Matches §3.2 200 response envelope. |
| 51 | `DailySummaryDTO` | `Rest_API_Spec.md` §3.17 | **PASS** | Exact match: `{ date, orders_total, orders_completed, actions_executed, actions_undone, orders_protected, revenue_protected, net_extra_cost, data_source }`. Matches §3.17 200 response. |
| 52 | `AgentChatResponseDTO` | `Rest_API_Spec.md` §3.16 | **PASS** | Exact match: `{ reply, intent, tool_used, data?, requires_confirmation, confirm_phrases }`. `tool_used` is properly typed `string \| null`. |

---

## 3. Detailed Verification Areas

### 3.1 Menu and Pricing Separation
- **`GET /api/menu` (§3.3)**: Returned as `MenuListResponseDTO` containing items of type `MenuItemDTO`. Contains the dish's active price, dynamic cost breakdown (`ingredients`, `packaging`, `commission`, `overhead`, `total`), computed profit, margin percentage, margin status, and active flag. It does **not** contain `analyzed_price`, `suggested_price`, `prep_minutes`, or `cook_minutes`.
- **`POST /api/pricing/analyze` (§3.4)**: Returned as `PricingAnalysisResponseDTO`. Contains the analyzed price, current price, dynamic cost breakdown, suggested price meeting target margin, calculation assumptions, and an optional pending action.
- **Verification Result**: The two contracts remain cleanly separated. `CostBreakdownDTO` is safely shared as a common value object. No super-DTO was created.

### 3.2 Actions and Recovery Validation
- **`ProposedActionDTO`**: Properly accommodates recovery proposals (§3.10), price-change proposals (§3.4), pasted order extraction proposals (§3.6), and undo proposals (§3.15).
- **`ActionRecoveryImpactDTO`**: Accommodates both compact impact payloads returned by `GET /api/actions` (`late_orders`, `orders_protected`, `extra_cost`, `score`) and detailed simulation results returned by `POST /api/recovery/propose` (`revenue_at_risk_after`, `margin_before_pct`, `margin_after_pct`, `customer_risk`).
- **`ActionApproveResponseDTO`**: Exactly matches §3.12, including atomic `executed_at` timestamp, `plan_version_before/after`, `changes` summary, `customer_messages` prefilled WhatsApp drafts, and sibling `expired_action_ids`.
- **`ActionRejectResponseDTO`**: Exactly matches §3.13, including `status = 'rejected'`, `decided_at` timestamp, and `audit_id`.

### 3.3 Status and Enums Alignment
- All 11 enum types match backend database check constraints and REST query definitions.
- No UI-only display values (such as `'queued'`, `'plating'`, `'ready'`, or `'dispatched'`) were added to `OrderStatusDTO`.
- `PlanTaskStatusDTO` strictly reflects `'scheduled' | 'in_progress' | 'done' | 'cancelled'`.

---

## 4. Unresolved Specification Ambiguities (Downstream UI Level)

These questions relate to client-side presentation in Stage 2.3 and do **not** block or invalidate the DTO definitions:

1. **Order Queue Filtering vs Delayed Orders**:
   - In `Rest_API_Spec.md` §3.5, `status` accepts `delayed`.
   - In the frontend UI tabs ("Queued", "Prep", "Plating", "Dispatched"), `delayed` was previously lumped into prep.
   - *Adapter Resolution for Stage 2.3*: In `orderAdapter.ts`, orders with `status === 'delayed'` should be rendered with an urgency badge rather than pretending "delayed" is a kitchen preparation step.
2. **Workstation Synthesis**:
   - The backend schedules tasks using `cook_no` (1..N) and `burner_no` (1..M).
   - *Adapter Resolution for Stage 2.3*: In `planAdapter.ts`, tasks will map `task_type` (`prep` → Cold Prep, `cook` → Hot Line, `pack` → Packaging Gate) to display workstation labels without fabricating backend station rows.

---

## 5. Verification Conclusion

- **DTO Accuracy**: 52/52 contracts verified and marked **PASS**.
- **Mismatches Found**: 0.
- **Mismatches Corrected**: None required; all definitions in `dto.ts` were already strictly aligned.
- **Stage 2.3 Readiness**: DTO definitions are verified and ready to be imported by API clients and adapter layers.
