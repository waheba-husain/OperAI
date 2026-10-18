# Stage 2.4D — Shortage & Recovery Integration Report
**OperAI / Cloud Kitchen Rescue**  
**Integration Status:** Complete (Corrective Review Verified)  
**Date:** 2026-10-18  

---

## 1. Files Created and Modified

### Created Files
- [`frontend/src/types/shortageRecovery.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/types/shortageRecovery.ts) — Presentation view models (`ShortageItemViewModel`, `AtRiskOrderViewModel`, `RecoveryBaselineViewModel`, `RecoveryOptionViewModel`, `RecoveryProposalResultViewModel`, `ShortageRecoverySummary`).
- [`frontend/src/api/adapters/recoveryAdapter.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/adapters/recoveryAdapter.ts) — Pure mapping functions converting `BriefResponseDTO` and `RecoveryProposeResponseDTO` into UI-ready models, formatting INR currency, and evaluating impact metrics without converting missing numbers to 0.
- [`frontend/src/pages/shortageRecovery/shortageRecoveryData.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/pages/shortageRecovery/shortageRecoveryData.ts) — Isolated offline demonstration dataset adhering to `data_source = 'simulated'`.
- [`frontend/src/hooks/useShortageRecoveryData.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/hooks/useShortageRecoveryData.ts) — Custom hook managing brief data retrieval, service date transitions, debounced abort controllers, proposal request sequence counters (`proposalSeqRef`), input validation, zero-quantity preservation, and error propagation.
- [`frontend/src/components/shortageRecovery/ShortageRiskPanel.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/ShortageRiskPanel.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/ShortageRiskPanel.css) — Inventory deficit radar displaying shortages, stock vs needed quantities, deficit, custom physical stock input, and at-risk order badges.
- [`frontend/src/components/shortageRecovery/RecoveryBaselineCard.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoveryBaselineCard.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoveryBaselineCard.css) — Distinct visual presentation for the "Do-Nothing" baseline scenario showing projected late orders, extra cost (₹0.00), and revenue at risk.
- [`frontend/src/components/shortageRecovery/RecoveryOptionCard.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoveryOptionCard.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoveryOptionCard.css) — Candidate recovery option card presenting engine recommendation, option type badge, customer consent warning banner, impact metrics grid, solver score, and expiry indicator.
- [`frontend/src/components/shortageRecovery/RecoverySimulationResults.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoverySimulationResults.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoverySimulationResults.css) — Wrapper orchestrating the baseline comparison, candidate options list, solver status, escalation banner, and simulation reset.
- [`frontend/src/pages/ShortageRecoveryPage.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/pages/ShortageRecoveryPage.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/pages/ShortageRecoveryPage.css) — Page shell integrating governance policy banner, mode indicator (with live, syncing, live error, and demo states), date navigation, KPI summary ribbon, shortages list, and solver simulation results.
- [`frontend/src/api/__tests__/shortageRecoveryIntegration.test.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/__tests__/shortageRecoveryIntegration.test.ts) — Comprehensive 12-test unit and integration test suite covering brief parsing, request payloads, zero-quantity preservation, missing-field integrity, negative validation, response adaptation, edge cases, and error handling.

### Modified Files
- [`frontend/src/types/dto.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/types/dto.ts) — Added `RecoveryProposeRequestDTO` (`date`, `ingredient_id`, optional `reported_available_qty`).
- [`frontend/src/api/endpoints.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/endpoints.ts) — Added `proposeRecovery(data: RecoveryProposeRequestDTO, options?: RequestOptions): Promise<RecoveryProposeResponseDTO>`.
- [`frontend/src/api/index.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/index.ts) — Exported `proposeRecovery` and all recovery adapter utilities.
- [`frontend/src/components/layout/AppLayout.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/layout/AppLayout.tsx) — Replaced placeholder route for `'shortage-recovery'` with `<ShortageRecoveryPage onNavigate={handleNavigate} />`.

---

## 2. Endpoints Integrated

### 1. `GET /api/brief?date=YYYY-MM-DD`
- **Spec Section:** `Rest_API_Spec.md §3.9`
- **Method:** `GET`
- **Purpose:** Fetches proactive risk brief containing identified inventory shortages, affected orders with upcoming deadlines, and backend-calculated total revenue exposure.
- **Client Helper:** `getBrief({ date: targetDate }, { client, signal })`

### 2. `POST /api/recovery/propose`
- **Spec Section:** `Rest_API_Spec.md §3.10`
- **Method:** `POST`
- **Purpose:** Requests solver evaluation for a specific ingredient deficit. Runs CP-SAT / greedy solver on plan clones, computes impact trade-offs, and returns candidate actions sharing a `group_id`.
- **Request Body:** `{ date: string, ingredient_id: string, reported_available_qty?: number }`
- **Response Body:** `{ group_id, shortage, baseline, scoring, recommended_option_number, options, escalation? }`
- **Client Helper:** `proposeRecovery(payload, { client })`

---

## 3. Corrective Review Findings & Fixes

### 1. Request Contract & Zero-Quantity Handling
- **Confirmed Requirement:** `reported_available_qty = 0` must be preserved as numeric zero (e.g. indicating complete physical stockout), while missing values must be omitted from the request payload.
- **Fix:** In `useShortageRecoveryData.ts`, `reportedAvailableQty !== undefined` is checked explicitly. When `0`, `{ reported_available_qty: 0 }` is included. When omitted/blank, the field is excluded completely.
- **Validation:** Non-numeric or negative values (`< 0` or `NaN`) are validated and rejected client-side with a standard `422 VALIDATION_ERROR` (`ApiError`) matching the documented contract.

### 2. Financial Data & Metric Integrity
- **Confirmed Requirement:** Do not convert missing backend values into `0` or hardcode `₹0.00`. Do not fabricate per-ingredient financial exposure.
- **Fix:** In `recoveryAdapter.ts`:
  - `revenueAtRiskAfter` preserves `impact.revenue_at_risk_after` directly without defaulting to `?? 0`. If omitted by backend, it remains `undefined` and renders `"Not evaluated"`.
  - Removed misleading assignment of brief-wide `revenue_at_risk` onto individual shortage cards. Total brief financial exposure remains on the summary ribbon (`summary.revenueAtRiskFormatted`) and on individual at-risk orders (`order.totalAmountFormatted`).
  - Solver score, margin delta, and customer risk display `N/A` when missing instead of fabricated defaults.

### 3. Request State, Race Conditions & Invalidation
- **Confirmed Requirement:** Stale asynchronous responses must not overwrite newer date selections or newer proposal requests.
- **Fix:**
  - Added `proposalSeqRef` to `useShortageRecoveryData.ts`.
  - Date changes immediately increment `proposalSeqRef`, clearing active proposal and dropping any in-flight POST responses.
  - Duplicate submissions are prevented while `isProposing` is true.

### 4. Mode State & Honest Provenance
- **Confirmed Requirement:** Prevent live loading or live error states from being mislabeled as demo mode.
- **Fix:** Mode pill in `ShortageRecoveryPage.tsx` explicitly distinguishes:
  - `LIVE BACKEND` (connected with live data)
  - `SYNCING...` (`mode === 'live'` and loading)
  - `LIVE ERROR` (`mode === 'live'` with API failure)
  - `SIMULATED DEMO` (`mode === 'demo'`)

---

## 4. Tests and Actual Results

Automated test suites executed via the Node 24 native test runner (`node --test`):

```bash
node --test src/api/__tests__/shortageRecoveryIntegration.test.ts
```

### Shortage & Recovery Suite Results (12 Tests)
1. `Shortage & Recovery: accurately maps shortages and at-risk orders from GET /api/brief` — **PASS**
2. `Shortage & Recovery: handles empty shortages list honestly` — **PASS**
3. `Shortage & Recovery: constructs valid POST /api/recovery/propose request payload` — **PASS**
4. `Shortage & Recovery: accurately maps Do-Nothing baseline and candidate recovery options` — **PASS**
5. `Shortage & Recovery: formats currency and labels correctly` — **PASS**
6. `Shortage & Recovery: handles no viable options with escalation message` — **PASS**
7. `Shortage & Recovery: handles 409 NO_SHORTAGE_DETECTED conflict honestly` — **PASS**
8. `Shortage & Recovery: handles 404 PLAN_NOT_FOUND or INGREDIENT_NOT_FOUND` — **PASS**
9. `Shortage & Recovery: handles 500 SERVER_ERROR without silent fallback` — **PASS**
10. `Shortage & Recovery: preserves reported_available_qty = 0 as numeric zero and omits when undefined` — **PASS**
11. `Shortage & Recovery: preserves undefined optional impact fields without converting to 0 or defaults` — **PASS**
12. `Shortage & Recovery: rejects negative quantity according to API validation contract` — **PASS**

**Suite Total:** 12 tests, 12 passed, 0 failed.  
**Full Frontend Test Suite:** 60 tests, 60 passed, 0 failed across all modules (`apiClientAndAdapters`, `overviewIntegration`, `liveOpsIntegration`, `schedulePlanIntegration`, `shortageRecoveryIntegration`).

---

## 5. Production Build Result

The production build was executed via `npm run build` (`tsc -b && vite build`):

```
> frontend@0.0.0 build
> tsc -b && vite build

vite v8.3.4 building client environment for production...
transforming...
✓ 92 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.98 kB │ gzip:   0.57 kB
dist/assets/index-CAxqKobZ.css  133.76 kB │ gzip:  16.74 kB
dist/assets/index-ChlMnTM3.js   366.95 kB │ gzip: 104.17 kB

✓ built in 230ms
```
**Exit Code:** 0 (Clean build, zero TypeScript errors).

---

## 6. Scope Boundaries Maintained

- No calls to `POST /api/actions/{id}/approve` or `POST /api/actions/{id}/reject`.
- No modification of active schedule plans or order states.
- No modifications to the backend codebase or database schemas.
- No modifications to Overview, Live Operations, or Schedule & Plan pages.
- Stage 2.4E has not been started.

---

## 7. Manual Browser Checks Still Required

When running the application with a running backend instance:
1. Navigate to **Shortage & Recovery** via the sidebar navigation.
2. Verify that identified ingredient deficits display with their correct unit (`kg`, `g`, `l`).
3. Click **Simulate Recovery Options** on a shortage card and verify the spinner state while waiting for the response.
4. Test entering `0` in the "Report Physical Stock" input to simulate complete stockout, verifying that the payload includes `reported_available_qty: 0`.
5. Check dark mode toggle to verify card contrast, text legibility, and amber alert banner styling.
6. Verify date picker navigation: navigating between dates clears the prior simulation state and reloads the date-specific brief.
