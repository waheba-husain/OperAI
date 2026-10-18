# Stage 2.2 DTO Implementation Notes

**Document Path:** `frontend/docs/stage-2.2-dto-notes.md`  
**Phase:** Stage 2.2 — TypeScript DTO Creation  
**Target File:** `frontend/src/types/dto.ts`  
**Sources of Truth:**  
- `AGENTS.md`  
- `docs/Rest_API_Spec.md`  
- `docs/Database_Schema.md`  
- `frontend/docs/stage-2.1-corrective-audit.md`  

---

## 1. Specification Consistency Evaluation

All required DTOs have been implemented directly from `docs/Rest_API_Spec.md` without blocking contradictions:

1. **GET /api/orders (§3.5)**: Implemented as `OrderDTO` and `OrderListResponseDTO`. Matches the documented envelope `{ data: [...], count }`, snake_case fields, and numeric pricing.
2. **GET /api/plan (§3.8) & POST /api/plan/generate (§3.7)**: Implemented as `PlanResponseDTO`, `PlanTaskDTO`, and `PlanGenerateResponseDTO`. Preserves `cook_no`, `burner_no`, and ISO timestamps without station abstractions.
3. **GET /api/brief (§3.9)**: Implemented as `BriefResponseDTO`, `ShortageDTO`, and `AtRiskOrderDTO`.
4. **GET /api/actions (§3.11)**: Implemented as `ProposedActionDTO` and `ActionListResponseDTO`.
5. **GET /api/menu (§3.3) & POST /api/pricing/analyze (§3.4)**: Kept strictly separated. `MenuItemDTO` represents the catalog listing (§3.3), and `PricingAnalysisResponseDTO` represents the what-if simulation tool (§3.4). Both share `CostBreakdownDTO`.
6. **GET /api/summary (§3.17)**: Implemented as `DailySummaryDTO`.
7. **GET /api/audit (§3.14) & POST /api/audit/{id}/undo (§3.15)**: Implemented as `AuditLogDTO`, `AuditListResponseDTO`, and `AuditUndoResponseDTO`.
8. **GET /api/ingredients (§3.2)**: Implemented as `IngredientDTO` and `IngredientListResponseDTO`.
9. **POST /api/agent/chat (§3.16)**: Implemented as `AgentChatResponseDTO`.
10. **Error Envelope (§1 & §4)**: Implemented as `ApiErrorResponseDTO`.

---

## 2. Key Architecture Decisions Enforced in DTOs

### 2.1 Separation of Menu Catalog and Pricing Simulation
- The prior concern that `GET /api/menu` was missing `analyzed_price`, `suggested_price`, or `prep_minutes` was resolved: these fields belong to different contracts.
- `GET /api/menu` is a catalog listing that returns `price`, nested `cost_breakdown`, `profit_per_order`, `margin_pct`, `margin_status`, and `is_active`.
- `POST /api/pricing/analyze` is a what-if price calculation tool that returns `analyzed_price`, `suggested_price`, and an embedded pending `action`.
- These are defined as two distinct DTOs (`MenuItemDTO` and `PricingAnalysisResponseDTO`) sharing `CostBreakdownDTO`. They are not merged into a super-DTO.

### 2.2 Polymorphic Action Impact Modeling
- In the backend database (`proposed_actions.impact`), the impact payload is `jsonb` whose schema depends on `action_type`.
- In `dto.ts`, we defined typed impact interfaces (`ActionRecoveryImpactDTO`, `ActionPriceChangeImpactDTO`) combined into a union `ActionImpactDTO = ActionRecoveryImpactDTO | ActionPriceChangeImpactDTO | Record<string, unknown>`.

### 2.3 Strict Exclusion of UI Presentation Fields
In accordance with Stage 2.2 rules, the following frontend-only fields were strictly excluded from all DTOs:
- `progressPct` (No task or order completion percentage is tracked in the database).
- `urgency` and `minutesUntilDue` (These are client-side relative time derivations from `deadline`).
- `priority` (The solver schedules deadline-first; tasks have no priority column).
- Formatted timestamps (e.g. `'12:45 PM'`) or currency strings (e.g. `'₹180.00'`).
- Workstation aggregations or named station assignments.
- Display tags (e.g. `'#ORD-4821'`).

---

## 3. Downstream Guidance for Stage 2.3 (Adapters & View Models)

When creating adapters in Stage 2.3:
1. `orderAdapter.ts`: Will map `OrderDTO` to `LiveOrder`, calculating `minutesUntilDue`, `urgency`, and formatting `#ORD-${id.slice(0, 4)}`.
2. `planAdapter.ts`: Will map `PlanTaskDTO` to `LivePrepTask` and `PrepTaskItem`, calculating duration and mapping `cook_no` / `task_type` to workstation labels.
3. `briefAdapter.ts`: Will map `BriefResponseDTO` to `IngredientAlert` and `AiKitchenBriefing`.
4. `kpiAdapter.ts`: Will derive `orders-today` count and `revenue-today` sum from today's `OrderDTO[]`.
