# Stage 2.3 Corrective Review: Adapter Semantics, KPI Definitions & API Security

**Document Path:** `frontend/docs/stage-2.3-corrective-review.md`  
**Phase:** Stage 2.3 Corrective Pass  
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
- `frontend/docs/stage-2.3-api-client-and-adapters.md`  

---

## 1. Executive Summary

This corrective pass resolved semantic discrepancies in adapter mappings, formalized rigorous KPI accounting definitions, hardened client URL validation, and thoroughly analyzed client-side API authentication risks before proceeding to page-level integration.

---

## 2. Issues Found and Corrective Actions Taken

### 2.1 Order Adapter Status Semantics: 'delayed' Orders
- **Issue Found**: `orderAdapter.ts` previously mapped `order.status === 'delayed'` to `'prep'`. In reality, `delayed` is an urgency flag produced by the constraint solver indicating an order cannot meet its scheduled delivery deadline. An order can be delayed while still waiting in line. Falsely mapping it to `'prep'` asserted that physical cooking or preparation had commenced when it had not.
- **Correction Made**: `mapOrderStatus('delayed')` now maps to `'queued'` with a `critical` urgency badge. This presents the order as pending fulfillment in the queue while alerting the kitchen to its late risk, without inventing a false physical preparation stage.

### 2.2 Order Display Reference vs Canonical Identity
- **Issue Found**: The view model requires a string `ref` (`#ORD-XXXX`). There was a risk that downstream components or developers might treat this as an official backend sequence number or receipt reference.
- **Correction Made**: Documented explicitly in `orderAdapter.ts` that `#ORD-${order.id.slice(0, 4)}` is a presentation-only display badge fallback derived from the UUID prefix. The backend UUID `order.id` remains the canonical identifier throughout the system.

### 2.3 Safe Deadline Timestamp Handling
- **Issue Found**: If an order possessed an invalid or malformed ISO timestamp, calculating `minutesUntilDue` produced `NaN`, and `formatTimeIST` could fail.
- **Correction Made**: Added defensive `isNaN(deadlineDate.getTime())` checks. Invalid timestamps safely return `dueTime = '—'`, `minutesUntilDue = 0`, and fall back to default urgency without throwing runtime exceptions.

### 2.4 KPI Accounting & Cancelled Order Exclusions
- **Issue Found**: `deriveOverviewKpis` previously included `cancelled` orders in total order volume and summed their amounts into revenue. In addition, calling the sum "Revenue Today" conflated gross customer commitments with net kitchen profit or realized cash.
- **Correction Made**:
  1. Orders with `status === 'cancelled'` are strictly excluded from all operational counts and revenue sums.
  2. The KPI label was updated to **"Gross Scheduled Order Value"**, with supporting text clarifying that it represents the gross bill value across non-cancelled orders.
  3. The margin KPI label was updated to **"Avg Dish Margin (Catalog)"**, filtering only active catalog dishes (`item.is_active === true`) and noting that this is an unweighted catalog mean, not overall kitchen profitability.
  4. Trend deltas (`trend: undefined`) remain omitted per AGENTS.md Rule 9.

### 2.5 API Client Base URL Validation
- **Issue Found**: Invalid base URLs passed to `ApiClient` could trigger unhandled URL constructor exceptions during request execution.
- **Correction Made**: Added explicit URL validation in the `ApiClient` constructor, throwing a descriptive `ConfigurationError` (`missingKey: 'VITE_API_BASE_URL'`) if the configured base URL is not a valid absolute URL.

---

## 3. Authentication Security & Deployment Limitations

### 3.1 Documented Contract Verification
- `Rest_API_Spec.md` §1 specifies:
  > "Authentication (MVP): every endpoint except `/health` requires the header `X-API-Key: <key>` (shared secret from an env var, single demo kitchen). A missing or wrong key returns 401. FUTURE: JWT, with `kitchen_id` taken from the token."
- The `ApiClient` correctly sends `X-API-Key: <VITE_API_KEY>` on all `/api/*` endpoints and omits it for `/health`.

### 3.2 Client-Side Security Reality (Vite `VITE_*` Variables)
- **Zero Confidentiality**: In Vite, any variable prefixed with `VITE_` is baked directly into the browser-facing JavaScript bundle. Furthermore, the key is transmitted in plain text across HTTP headers inspectable via browser DevTools.
- **Scope Suitability**:
  - **Local Development / Hackathon Demo**: Acceptable for a single demo kitchen running locally (`http://localhost:8000`).
  - **Public / Multi-Tenant Production**: **Unsafe**. A shared API key bundled in frontend source permits any user to impersonate the kitchen or call backend mutations directly.
- **Required Production Architecture**:
  1. **Option A (Server-Side Proxy / BFF)**: A lightweight Node.js/Next.js/FastAPI proxy where the browser authenticates via secure session cookies, and the proxy attaches the private `X-API-Key` server-to-server.
  2. **Option B (User JWTs)**: As noted in the `Rest_API_Spec.md` FUTURE roadmap, migrate to token-based authentication (e.g. Supabase Auth / Cognito JWTs) where the user receives a scoped, short-lived token encoding their identity and kitchen permissions.

---

## 4. KPI Technical Specifications

| KPI Identifier | Display Label | Business Meaning | Exact Input Fields | Statuses Included | Statuses Excluded | Result Classification |
|---|---|---|---|---|---|---|
| `orders-today` | Orders Scheduled Today | Count of valid customer orders scheduled for fulfillment today | `OrderDTO[]` from `GET /api/orders?date={today}` | `new`, `planned`, `in_progress`, `delayed`, `partial`, `completed` | `cancelled` (voided orders) | **Derived** |
| `revenue-today` | Gross Scheduled Order Value | Gross order value (GMV) of scheduled customer orders | `order.total_amount` (numeric) | Non-cancelled active/completed orders | `cancelled` (0 revenue realized) | **Derived** |
| `profit-margin` | Avg Dish Margin (Catalog) | Arithmetic mean of target gross margins across active dishes | `menu_item.margin_pct` from `GET /api/menu` | Dishes where `is_active === true` | Inactive catalog dishes | **Derived** |
| `orders-attention` | Attention Required | Operational count of items needing owner review or approval | `shortages` count from `GET /api/brief` + pending actions from `GET /api/actions` | Shortages (`short_by > 0`) & actions (`status === 'pending'`) | Inactive or executed items | **Derived** |

*Important Business Disclaimers:*
- **Gross Scheduled Order Value** is NOT net kitchen profit or settled bank cash; it is the total gross bill amount.
- **Avg Dish Margin (Catalog)** is NOT overall kitchen EBITDA; it is an unweighted average of individual recipe unit margins.

---

## 5. Unresolved Decisions (Deferred to Component Integration)

1. **Order Queue Tab for Delayed Orders**:
   - `delayed` orders are currently adapted to the `queued` tab with a `critical` urgency badge.
   - If the kitchen owner requires a dedicated "Delayed / At Risk" tab in `OrderQueue.tsx`, `OrderStatus` in `types/liveOperations.ts` would need an additional union member `'delayed'`.
2. **Order Queue Tab for Partial Fulfillment**:
   - Orders with `status === 'partial'` currently return `null` and are excluded from the queue because equating them to `plating` is prohibited.
   - If partial orders must be visible in Live Operations, a dedicated "Partial / Substituted" tab or badge will need to be introduced in Stage 2.4.
3. **Physical Station Panels (`LiveStation`)**:
   - The backend models `cook_no` (1..N) and `burner_no` (1..M), not 4 named physical stations. The 4-station panels (`StationsPanel.tsx`, `KitchenHealthPanel.tsx`) must remain on simulated data until a dedicated cook-load aggregation adapter is approved.

---

## 6. Test Suite and Build Verification

### 6.1 Unit Test Suite
Ran 19 tests in `src/api/__tests__/apiClientAndAdapters.test.ts` via Node 24 native test runner:

```bash
node --test src/api/__tests__/apiClientAndAdapters.test.ts
```

```
✔ ApiClient: URL construction and query parameter formatting (3.7ms)
✔ ApiClient: throws ConfigurationError on invalid baseUrl (1.9ms)
✔ ApiClient: throws ConfigurationError when API key is missing for authenticated endpoints (1.3ms)
✔ ApiClient: attaches X-API-Key header to authenticated requests (70.2ms)
✔ ApiClient: parses backend error envelope into ApiError (4.7ms)
✔ ApiClient: maps fetch failures to NetworkError (1.5ms)
✔ orderAdapter: adapts OrderDTO to LiveOrder preserving ID and formatting ref (49.3ms)
✔ orderAdapter: maps completed to ready (NEVER dispatched) (1.6ms)
✔ orderAdapter: partial and cancelled statuses return null (unresolved / excluded) (0.9ms)
✔ orderAdapter: maps delayed status to queued with critical urgency (NOT prep) (1.1ms)
✔ orderAdapter: handles invalid deadline timestamps safely (0.4ms)
✔ planAdapter: derives workstation label without fabricated stations table (0.3ms)
✔ planAdapter: calculates duration and maps to LivePrepTask (1.0ms)
✔ planAdapter: marks priority as critical if order is in late_orders (0.6ms)
✔ planAdapter: preserves locked state in Overview PrepTaskItem (1.0ms)
✔ briefAdapter: adapts ShortageDTO to IngredientAlert (0.7ms)
✔ briefAdapter: synthesizes AiKitchenBriefing observation (1.0ms)
✔ actionAdapter: adapts ProposedActionDTO to OpsAlert (0.7ms)
✔ kpiAdapter: calculates Overview KPIs, excludes cancelled orders, and preserves honesty (11.6ms)
ℹ tests 19 | pass 19 | fail 0 (609.5ms)
```

### 6.2 Production Build Verification
```bash
npm run build
```
- **Result**: **Passed** with 0 errors and 0 warnings.
- `tsc -b && vite build` built `dist/` cleanly in 600ms.

---

## 7. Confirmation of Zero Impact on UI and Mock Data

- **Overview Page & Live Operations Page**: Untouched. Existing screens continue rendering approved UI layouts using mock data.
- **Mock Data Files**: `overviewData.ts` and `liveOperationsData.ts` were not modified.
- **Backend Files**: No backend files or root documentation modified.

We have stopped at the completion of this corrective review as instructed and await your guidance before proceeding to Stage 2.4.
