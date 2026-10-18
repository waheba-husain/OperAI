# Stage 2.3 Implementation Report: Centralized API Client & Adapter Modules

**Document Path:** `frontend/docs/stage-2.3-api-client-and-adapters.md`  
**Phase:** Stage 2.3 — Centralized API Client & Adapter Modules  
**Status:** Completed and Verified  
**Target Next Phase:** Stage 2.4 (Component Data-Fetching Integration)  
**Ownership Scope:** `frontend/` only (no backend code or backend docs modified)  
**Sources of Truth:**  
- `AGENTS.md`  
- `docs/Rest_API_Spec.md`  
- `docs/Database_Schema.md`  
- `docs/System_Architecture.md`  
- `frontend/docs/stage-2.1-corrective-audit.md`  
- `frontend/docs/stage-2.2-verification.md`  
- `frontend/src/types/dto.ts`  
- `frontend/src/types/overview.ts`  
- `frontend/src/types/liveOperations.ts`  

---

## 1. Executive Summary

Stage 2.3 delivers a centralized, strictly-typed API client and a suite of presentation adapters for OperAI.

Key principles upheld:
1. **Zero UI Disruption**: The Overview and Live Operations pages remain on their existing mock data and view models. No components were connected to the network in this stage.
2. **Deterministic & Secure Client**: Base URL is loaded from `VITE_API_BASE_URL` (defaulting to `http://localhost:8000`). Authenticated calls enforce the documented `X-API-Key` header from `VITE_API_KEY`. If the key is missing on an authenticated call, a clear `ConfigurationError` is thrown rather than silently sending bad data or inventing simulated responses.
3. **No Retries on Mutations**: In adherence to `AGENTS.md`, POST requests are never automatically retried.
4. **Honest Adapters**: Adapters map documented DTOs to view models without fabricating data:
   - `completed` is mapped to `ready` (boxed at counter), **never** to `dispatched` (no courier tracking).
   - `partial` is **never** mapped to `plating` (it means partial fulfillment).
   - `delayed` is mapped to `prep` with a `critical` urgency flag, acknowledging that it is a deadline-risk state rather than a kitchen room.
   - Workstations are derived from `task_type` and `burner_no`, without inventing a backend `stations` table.
   - No `progressPct` values are fabricated (0 for active, 100 for completed).
   - No historical delta trends (e.g. `+18% vs yesterday`) are invented for KPIs.

---

## 2. Files Created or Modified

### 2.1 Configuration & Environment
- `frontend/.env.example` (New): Documents `VITE_API_BASE_URL` and `VITE_API_KEY`.
- `frontend/tsconfig.app.json` (Modified): Excludes `src/**/__tests__/*` from the production browser bundle.

### 2.2 API Client & Error Foundation
- `frontend/src/api/errors.ts` (New):
  - `ApiError`: Preserves HTTP status, backend error code (`ACTION_NOT_PENDING`, `UNAUTHORIZED`, etc.), and structured error details.
  - `ConfigurationError`: Thrown for missing environment variables or invalid configuration.
  - `NetworkError`: Wraps fetch failures, connection drops, aborts, and timeouts.
- `frontend/src/api/client.ts` (New):
  - `ApiClient`: Fetch client supporting GET/POST, URL serialization, timeout handling (default 10,000ms), `X-API-Key` header injection, and standardized error parsing.
  - `apiClient`: Singleton instance configured with environment defaults.
- `frontend/src/api/endpoints.ts` (New):
  - Typed helper functions for read-only endpoints: `getOrders`, `getPlan`, `getBrief`, `getActions`, `getMenu`, `getSummary`, `getIngredients`, `getAudit`.
- `frontend/src/api/index.ts` (New):
  - Clean barrel export for all client classes, helpers, and adapters.

### 2.3 Presentation Adapters
- `frontend/src/api/adapters/orderAdapter.ts` (New):
  - `adaptOrderToLiveOrder`: Transforms `OrderDTO` to `LiveOrder`.
  - `adaptOrdersToLiveOrders`: Batch adapter with null filtering.
  - `mapOrderStatus`: Enforces strict lifecycle mapping rules (`completed != dispatched`, `partial != plating`).
  - `calculateOrderUrgency`: Computes relative deadline urgency.
  - `formatTimeIST`: Formats ISO 8601 timestamps into IST 12-hour strings.
- `frontend/src/api/adapters/planAdapter.ts` (New):
  - `adaptTaskToLivePrepTask`: Transforms `PlanTaskDTO` to `LivePrepTask` for Live Operations timeline.
  - `adaptTaskToOverviewItem`: Transforms `PlanTaskDTO` to `PrepTaskItem` for Overview timeline.
  - `deriveWorkstationLabel`: Derives labels (`Burner #N`, `Prep Station`, `Packaging & Pass`) from `task_type` and `burner_no`.
  - `calculateDurationMins`: Calculates task duration in minutes.
- `frontend/src/api/adapters/briefAdapter.ts` (New):
  - `adaptShortageToIngredientAlert`: Transforms `ShortageDTO` to `IngredientAlert`.
  - `adaptBriefToIngredientAlerts`: Batch shortage adapter.
  - `adaptBriefToAiBriefing`: Derives `AiKitchenBriefing` observations from shortage and revenue exposure.
- `frontend/src/api/adapters/actionAdapter.ts` (New):
  - `adaptActionToOpsAlert`: Transforms `ProposedActionDTO` to `OpsAlert`.
  - `formatActionImpactSummary`: Extracts concise summary from polymorphic `impact` payload.
- `frontend/src/api/adapters/kpiAdapter.ts` (New):
  - `deriveOverviewKpis`: Computes Overview `KpiItem[]` from verified order counts, revenue sums, catalog margins, and pending actions without fabricated trend deltas.

### 2.4 Unit Test Suite
- `frontend/src/api/__tests__/apiClientAndAdapters.test.ts` (New):
  - 17 unit tests verifying URL building, auth header injection, error parsing, timeout/network errors, order adaptation, plan task adaptation, locked state preservation, brief adaptation, and KPI derivation.

---

## 3. API Client Configuration and Authentication Behavior

| Parameter | Configuration Source | Default Value | Notes |
|---|---|---|---|
| Base URL | `import.meta.env.VITE_API_BASE_URL` | `http://localhost:8000` | Slashes normalized automatically |
| API Key | `import.meta.env.VITE_API_KEY` | `undefined` | Never hardcoded; client bundles only local demo key |
| Auth Header | `X-API-Key: <VITE_API_KEY>` | Enforced on all `/api/*` endpoints | Throws `ConfigurationError` if key is missing when calling authenticated endpoints |
| Request Timeout | `timeoutMs` option | `10000ms` (10 seconds) | Aborts fetch via `AbortController` and raises `NetworkError` |
| Mutation Safety | Client rule | Zero automatic retries | Prevents duplicate action creation or state corruption |

---

## 4. Endpoints Implemented

| Endpoint | Method | Specification Section | Response DTO | Purpose |
|---|---|---|---|---|
| `/api/orders` | GET | `Rest_API_Spec.md` §3.5 | `OrderListResponseDTO` | Fetches active kitchen orders and line items |
| `/api/plan` | GET | `Rest_API_Spec.md` §3.8 | `PlanResponseDTO` | Fetches daily schedule board with `cook_no` and `burner_no` |
| `/api/brief` | GET | `Rest_API_Spec.md` §3.9 | `BriefResponseDTO` | Fetches shortages, at-risk orders, and revenue exposed |
| `/api/actions` | GET | `Rest_API_Spec.md` §3.11 | `ActionListResponseDTO` | Fetches proposed recovery and price change actions |
| `/api/menu` | GET | `Rest_API_Spec.md` §3.3 | `MenuListResponseDTO` | Fetches dish catalog with dynamic cost breakdowns |
| `/api/summary` | GET | `Rest_API_Spec.md` §3.17 | `DailySummaryDTO` | Fetches day-end protected orders and preserved revenue |
| `/api/ingredients` | GET | `Rest_API_Spec.md` §3.2 | `IngredientListResponseDTO` | Fetches current stock inventory and allergen/diet tags |
| `/api/audit` | GET | `Rest_API_Spec.md` §3.14 | `AuditListResponseDTO` | Fetches audit trail of executed/rejected actions |

---

## 5. Adapters Implemented & Type Mappings

| Adapter Module | Source DTO | Target View Model | Key Transformations |
|---|---|---|---|
| `orderAdapter.ts` | `OrderDTO` | `LiveOrder` | - Preserves UUID `id`<br>- Generates `#ORD-${id.slice(0, 4)}`<br>- Formats deadline to IST time<br>- Maps channel to display label<br>- Maps `completed` -> `ready` (NOT `dispatched`)<br>- Maps `partial` -> `null` (NOT `plating`)<br>- Computes relative `minutesUntilDue` and `urgency` |
| `planAdapter.ts` | `PlanTaskDTO` | `LivePrepTask`, `PrepTaskItem` | - Derives workstation from `task_type` and `burner_no`<br>- Formats start/end to IST<br>- Computes duration in minutes<br>- Derives priority from `late_orders`<br>- Preserves `locked` state for in-progress tasks |
| `briefAdapter.ts` | `BriefResponseDTO`, `ShortageDTO` | `IngredientAlert[]`, `AiKitchenBriefing` | - Formats deficit and current stock with units<br>- Sets `urgency = 'critical'` for shortages<br>- Derives shortage observation with exposed revenue |
| `actionAdapter.ts` | `ProposedActionDTO` | `OpsAlert` | - Maps action type to severity<br>- Extracts concise savings/protection summary from polymorphic impact payload |
| `kpiAdapter.ts` | `OrderDTO[]`, `MenuItemDTO[]`, counts | `KpiItem[]` | - Computes total orders and revenue sum<br>- Computes average catalog margin<br>- Omits fabricated trend percentages |

---

## 6. Unsupported View-Model Fields & Unresolved Mappings

The following fields in existing view models have no backend source in `docs/Rest_API_Spec.md` and are explicitly documented as unsupported:

1. **`LiveOrder.progressPct` & `LivePrepTask.progressPct`**:
   - The backend tracks discrete statuses (`new`, `planned`, `in_progress`, `done`), not partial percentages.
   - *Adapter Decision*: Outputs `100` for completed items, `0` for non-completed items. No fake percentages are fabricated.
2. **`LiveOrder.status = 'partial'`**:
   - In the database, `partial` means partial fulfillment due to an ingredient shortage.
   - The UI queue tabs are `queued`, `prep`, `plating`, `ready`, `dispatched`.
   - *Adapter Decision*: Returns `null` from `adaptOrderToLiveOrder` because mapping `partial` to `plating` is semantically invalid.
3. **`LiveOrder.status = 'delayed'`**:
   - In the backend, `delayed` is an urgency flag (late deadline risk), not a physical kitchen station.
   - *Adapter Decision*: Mapped to `prep` with a `critical` urgency badge.
4. **Physical Stations Table (`LiveStation`)**:
   - The backend contains no `stations` table; tasks are scheduled by `cook_no` and `burner_no`.
   - *Adapter Decision*: The 4-station panels (`StationsPanel.tsx`, `KitchenHealthPanel.tsx`) must remain on simulated mock data or be adapted in Stage 2.4 via cook-load synthesis.
5. **Historical KPI Trends (`KpiItem.trend`)**:
   - The backend provides point-in-time and single-date queries only; no historical deltas exist.
   - *Adapter Decision*: `trend` is set to `undefined` in `deriveOverviewKpis` to avoid inventing metrics per AGENTS.md rule 9.

---

## 7. Test Execution Results

Ran Node 24 native test runner on `src/api/__tests__/apiClientAndAdapters.test.ts`:

```bash
node --test src/api/__tests__/apiClientAndAdapters.test.ts
```

**Results:**
```
✔ ApiClient: URL construction and query parameter formatting (1.6ms)
✔ ApiClient: throws ConfigurationError when API key is missing for authenticated endpoints (1.1ms)
✔ ApiClient: attaches X-API-Key header to authenticated requests (31.3ms)
✔ ApiClient: parses backend error envelope into ApiError (1.6ms)
✔ ApiClient: maps fetch failures to NetworkError (0.5ms)
✔ orderAdapter: adapts OrderDTO to LiveOrder preserving ID and formatting ref (22.7ms)
✔ orderAdapter: maps completed to ready (NEVER dispatched) (0.6ms)
✔ orderAdapter: partial and cancelled statuses return null (unresolved / excluded) (0.2ms)
✔ orderAdapter: delayed status maps to prep with critical urgency (0.5ms)
✔ planAdapter: derives workstation label without fabricated stations table (0.3ms)
✔ planAdapter: calculates duration and maps to LivePrepTask (0.6ms)
✔ planAdapter: marks priority as critical if order is in late_orders (0.3ms)
✔ planAdapter: preserves locked state in Overview PrepTaskItem (0.6ms)
✔ briefAdapter: adapts ShortageDTO to IngredientAlert (0.4ms)
✔ briefAdapter: synthesizes AiKitchenBriefing observation (0.5ms)
✔ actionAdapter: adapts ProposedActionDTO to OpsAlert (0.4ms)
✔ kpiAdapter: calculates Overview KPIs without fabricated trend deltas (4.0ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 316.7ms
```

---

## 8. Build Validation

```bash
npm run build
```

**Result:**
```
> frontend@0.0.0 build
> tsc -b && vite build

vite v8.3.4 building client environment for production...
transforming...
✓ 55 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.98 kB │ gzip:  0.57 kB
dist/assets/index-CHPPkv_T.css   77.91 kB │ gzip: 10.32 kB
dist/assets/index-Cd45ZOF5.js   281.45 kB │ gzip: 83.47 kB

✓ built in 254ms
```
- TypeScript check (`tsc -b`): Passed with zero errors or warnings.
- Production bundle: Generated cleanly in 254ms.

---

## 9. Confirmation of Zero Impact on Existing UI & Mock Data

- **Overview Page & Live Operations Page**: Completely untouched. Both pages continue to render their approved visual layouts using existing mock data.
- **Mock Data Files**: `overviewData.ts` and `liveOperationsData.ts` were not modified.
- **View-Model Types**: `types/overview.ts` and `types/liveOperations.ts` were not modified.
- **Backend Files**: No files outside `frontend/` were modified.

We have stopped at the completion of Stage 2.3 as instructed and await your review before proceeding to Stage 2.4.
