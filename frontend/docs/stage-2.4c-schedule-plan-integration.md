# Stage 2.4C: Schedule & Plan Page Integration & Verification Report

**Date**: 2026-10-18  
**Scope**: Stage 2.4C — Schedule & Plan Page Integration (`GET /api/plan?date=YYYY-MM-DD` and `GET /api/orders?date=YYYY-MM-DD`) and Focused Verification Pass  
**Status**: Completed & Verified  

---

## 1. Overview & Objective

Stage 2.4C connects the **Schedule & Plan** interface to the OperAI backend contract via the centralized API client and typed adapters. The integration respects:
- **AGENTS.md Rule 1**: Numbers and metrics come strictly from code, never hallucinated by LLMs.
- **AGENTS.md Rule 10**: Locked plan tasks never move during replanning.
- **AGENTS.md Rule 9**: Honest labeling of live versus simulated data (`data_source = 'simulated'` in demo mode).
- **docs/Rest_API_Spec.md §3.8 & §3.5**: Strict adherence to documented endpoints and response envelopes.

No backend files, database schemas, or unrelated pages were modified.

---

## 2. Files Created and Modified

### Created Files
- `frontend/src/types/schedulePlan.ts`: Strongly typed view models (`ScheduleTaskItem`, `SchedulePlanSummary`, `ScheduleTaskStatus`, `ScheduleTaskType`, `ScheduleFilterStatus`).
- `frontend/src/hooks/useSchedulePlanData.ts`: Central data hook managing date selection, request sequence tracking (stale response protection), abort controllers, live/demo toggles, and 404 empty-plan states.
- `frontend/src/pages/SchedulePlanPage.tsx` & `SchedulePlanPage.css`: Full Schedule & Plan page composing summary ribbon, filters, task board cards, policy notices, keyboard focus visibility, and state containers.
- `frontend/src/pages/schedulePlan/schedulePlanData.ts`: Realistic offline demonstration dataset adhering to `OrderDTO` and `PlanResponseDTO` schemas.
- `frontend/src/components/schedulePlan/ScheduleSummaryRibbon.tsx` & `.css`: Metric cards displaying total, active, in-progress, scheduled, done, locked, and late order counts.
- `frontend/src/components/schedulePlan/ScheduleFilterBar.tsx` & `.css`: Status tab filters (All Active, In Progress, Scheduled, Completed, Locked, Cancelled), task type filter, assigned cook filter, and real-time search.
- `frontend/src/components/schedulePlan/ScheduleTaskCard.tsx` & `.css`: Individual scheduled task blocks with status indicators, assigned resource labels (Cook & Burner IDs), time windows, lock badges, and order context.
- `frontend/src/components/schedulePlan/ScheduleEmptyState.tsx` & `.css`: Dedicated empty state component handling both 404 missing plan and 0-task schedules.
- `frontend/src/api/__tests__/schedulePlanIntegration.test.ts`: Focused test suite covering status mapping, lock preservation, metrics, 404 handling, error states, date formatting, and race condition protection.
- `frontend/docs/stage-2.4c-schedule-plan-integration.md`: This comprehensive verification report.

### Modified Files
- `frontend/src/api/adapters/orderAdapter.ts`: Exported `formatDateIST(dateStr)` for zero-dependency IST date formatting across adapters.
- `frontend/src/api/adapters/planAdapter.ts`: Added `adaptPlanTaskToScheduleItem`, `adaptPlanTasksToScheduleItems`, and `deriveSchedulePlanSummary`.
- `frontend/src/api/index.ts`: Exported new Schedule & Plan adapters and `formatDateIST`.
- `frontend/src/components/layout/AppLayout.tsx`: Replaced placeholder page with `<SchedulePlanPage onNavigate={handleNavigate} />` when `currentPage === 'schedule-plan'`.

---

## 3. Endpoints Integrated

| HTTP Method & Path | Query Parameters | Backend DTO | Purpose |
| :--- | :--- | :--- | :--- |
| `GET /api/plan` | `date=YYYY-MM-DD` | `PlanResponseDTO` | Fetches the constraint-solved prep schedule for the requested date, including `plan_version`, `tasks`, and `late_orders`. |
| `GET /api/orders` | `date=YYYY-MM-DD` | `OrderListResponseDTO` | Enriches scheduled task blocks with customer names, delivery channels (Swiggy, Zomato, etc.), and order dispatch deadlines. |

No undocumented or speculative endpoints were called.

---

## 4. Resource Terminology & Semantic Integrity

During the Stage 2.4C verification pass, all resource presentation was audited to ensure strict alignment with backend contracts:
1. **Cook & Burner Presentation**:
   - `cook_no` and `burner_no` are strictly presented as assigned resource identifiers:
     - `Assigned Cook:` `Cook #1`, `Cook #2`, etc.
     - `Assigned Burner:` `Burner #1`, `Burner #2`, or `None (off-burner)` when null.
   - Removed all misleading "Station:" labels from task cards.
2. **Task Type Clarification**:
   - `task_type` (`cook`, `prep`, `pack`) is presented as the functional stage of the task, not as a claim of an authenticated physical room or workstation.
   - Filter dropdown was renamed from `Station Type:` to `Task Type:`, with clean options: `All Types`, `Cook`, `Prep`, `Pack` (removing unsupported station phrasing like "Prep Station" and "Packaging & Pass").
3. **Summary Ribbon Honest Labels**:
   - The assigned resources card was updated with the tag `Resource IDs` and subtext `{activeCooks} cook IDs · {activeBurners} burner IDs in plan`.
4. **Search Query Scope**:
   - Replaced workstation string searching with exact field matching on `dish`, `customerName`, `orderId`, `cookNo`, `burnerNo`, and `taskType`.

---

## 5. DTO-to-View-Model Mapping & Semantic Integrity

### Task Statuses
The backend `PlanTaskStatusDTO` defines 4 discrete statuses:
1. `scheduled`: Planned task block waiting to begin. Mapped to `status: 'scheduled'` with upcoming queue styling.
2. `in_progress`: Actively attended on a burner or prep line. Mapped to `status: 'in_progress'` with an animated pulsing indicator. Distinguishable from `scheduled`.
3. `done`: Task execution finished. Mapped to `status: 'done'`. **Hard rule**: Does not imply that the associated order has been dispatched.
4. `cancelled`: Cancelled preparation task. Preserved as `status: 'cancelled'` and strikethrough styling; explicitly excluded from the default "All Active" filter tab and active task counts.

### Locked Tasks (AGENTS.md Rule 10)
- Tasks with `locked: true` are visually rendered with a `🔒 Locked` pill badge.
- Tooltips and policy notices explicitly explain: *"Locked plan tasks never move during a replan (Rule 10)."*
- **No unlock control** or manual edit control is provided, preventing users from attempting illegal changes.

### Solver Late Order Risks
- If `task.order_id` is present in `plan.late_orders`, the card displays a `⚠️ Late Risk` badge to highlight solver deadline urgency.

---

## 6. Interaction Audit & Mutation Policy

| Feature / Interaction | Backend Write Endpoint | Status in OperAI UI | Rationale |
| :--- | :--- | :--- | :--- |
| **Drag-and-Drop Task Rescheduling** | None | **Disabled** | No write endpoint exists (`PATCH /api/plan` or `PUT /api/plan/tasks/{id}` is not in spec). Disabled to guarantee solver plan integrity. |
| **Cook / Burner Reassignment** | None | **Disabled** | Assignments are computed by greedy/CP-SAT solver; manual mutation is disallowed. |
| **Task Time Editing** | None | **Disabled** | Arbitrary start/end editing is unsupported by the backend. |
| **Lock / Unlock Controls** | None | **Disabled** | Hard Rule 10 forbids moving locked tasks; unlocking is not supported by API. |
| **Manual Replan Button** | None | **Disabled** | Replanning is triggered by approved shortage actions (`POST /api/actions/{id}/approve`), not directly from the plan page. |
| **Date Selection & Filtering** | `GET /api/plan?date=...` | **Active** | Fully functional read-only inspection with Prev/Next day, date picker, search, and status tabs. |

An informational banner on the page clearly informs operators:
> *"OperAI Schedule Integrity Policy: Kitchen tasks are scheduled via the constraint solver with deadline-first sequencing. Replanning strictly obeys locked tasks (AGENTS.md Rule 10). Arbitrary drag-and-drop reassignment and manual edits are disabled to prevent invalid kitchen states."*

---

## 7. Live, Demo, and Request State Handling

1. **Initial Loading State**: Displays a responsive shimmer skeleton grid matching the OperAI dark/forest-green aesthetic.
2. **Live Data State**: Displays live tasks, plan version (`Plan v4`), and resource counts fetched from the API.
3. **Empty Plan State**:
   - `404 PLAN_NOT_FOUND`: Caught non-fatally and rendered via `ScheduleEmptyState` explaining that no plan has been generated for that date. Provides a "Return to Today" button.
   - `0 Tasks`: Handled gracefully without error.
4. **Error State**: Displays an explicit error banner with the HTTP code, message, and details. Features a "Retry Request" button and an explicit "Switch to Demo Mode" fallback.
5. **Strict Live vs Demo Isolation (Rule 9)**:
   - When in live mode, API failures or missing data **never** fall back to or leak mock items.
   - In `useSchedulePlanData`, the fallback object returns `tasks: []`, `planVersion: '—'`, `lateOrderIds: []`, and an empty summary whenever `mode === 'live'`. Demo data is strictly scoped to `mode === 'demo'`.
6. **Stale Request Protection**:
   - Uses an incrementing sequence counter and `AbortController` so rapid date changes cancel previous fetches, and older in-flight responses are discarded if a newer date has been requested.

---

## 8. Accessibility & Responsive Enhancements

During the verification pass, the following UI and accessibility fixes were implemented:
1. **Focus Visibility**:
   - Added explicit `:focus-visible` styles with a 2px high-contrast forest green outline for:
     - Date navigation buttons (`‹`, `›`, `Today`)
     - Date display picker (`.schedule-date-display:focus-within`)
     - Mode toggle button and Refresh button
     - Status filter tabs (`.schedule-filter-tab:focus-visible`)
     - Task type and Cook select dropdowns (`.schedule-filter-select:focus-visible`)
     - Search input and search clear button
     - Reset filters buttons and Error/Empty state action buttons
2. **Mobile & Tablet Responsiveness**:
   - Added `max-width: 640px` and `max-width: 480px` rules:
     - `.schedule-tasks-grid` and `.schedule-loading-skeleton` collapse to `1fr` on small mobile devices to eliminate horizontal card overflow.
     - `.schedule-summary-ribbon` gracefully steps down from multi-column to 2 columns (at 768px) and 1 column (at 480px).
     - Secondary filter controls in `.schedule-filter-bar__bottom` stack neatly with full-width alignment on mobile viewports.

---

## 9. Verification & Test Results

### Native Node Test Suite (`node --test src/api/__tests__/*.test.ts`)
```
✔ ApiClient: URL construction and query parameter formatting (2.0544ms)
✔ ApiClient: throws ConfigurationError on invalid baseUrl (2.3918ms)
✔ ApiClient: throws ConfigurationError when API key is missing for authenticated endpoints (1.2208ms)
✔ ApiClient: attaches X-API-Key header to authenticated requests (59.9925ms)
✔ ApiClient: parses backend error envelope into ApiError (3.9276ms)
✔ ApiClient: maps fetch failures to NetworkError (1.0717ms)
✔ orderAdapter: adapts OrderDTO to LiveOrder preserving ID and formatting ref (28.2318ms)
✔ orderAdapter: maps completed to ready (NEVER dispatched) (0.8526ms)
✔ orderAdapter: partial and cancelled statuses return null (unresolved / excluded) (0.3342ms)
✔ orderAdapter: maps delayed status to queued with critical urgency (NOT prep) (0.7993ms)
✔ orderAdapter: handles invalid deadline timestamps safely (0.27ms)
✔ planAdapter: derives workstation label without fabricated stations table (0.2435ms)
✔ planAdapter: calculates duration and maps to LivePrepTask (0.7359ms)
✔ planAdapter: marks priority as critical if order is in late_orders (0.4693ms)
✔ planAdapter: preserves locked state in Overview PrepTaskItem (0.6697ms)
✔ briefAdapter: adapts ShortageDTO to IngredientAlert (4.6379ms)
✔ briefAdapter: synthesizes AiKitchenBriefing observation (0.744ms)
✔ actionAdapter: adapts ProposedActionDTO to OpsAlert (0.4394ms)
✔ kpiAdapter: calculates Overview KPIs, excludes cancelled orders, and preserves honesty (15.0646ms)
✔ Live Operations Queue: maps all documented order statuses with canonical preservation (30.2021ms)
✔ Live Operations Tasks: preserves locked status per AGENTS.md Rule 10 (0.9878ms)
✔ Live Operations Metrics: derives 4 operational summary metrics from code (0.7085ms)
✔ Live Operations Alerts: combines shortages, late orders, and pending actions (2.0438ms)
✔ Live Operations: handles 404 PLAN_NOT_FOUND gracefully without fatal failure (60.3584ms)
✔ Live Operations: handles 0 orders and 0 tasks without throwing (0.3022ms)
✔ Live Operations: throws ApiError on failure without silent mock fallback (1.4186ms)
✔ Live Operations Metrics: subtext isolates partial orders and maintains mutually consistent counts (0.3302ms)
✔ Live Operations Metrics: near-deadline handles invalid deadlines, multiple conditions, and completed orders safely (0.3833ms)
✔ Live Operations Alerts: missing plan (null) does not suppress shortages or pending proposals (0.5277ms)
✔ Overview Date Utils: getTodayDateIST produces YYYY-MM-DD in Asia/Kolkata (39.1417ms)
✔ Overview Date Utils: formatOverviewDateIST produces localized display string (1.8509ms)
✔ Overview Date Utils: formatOverviewDateIST handles invalid input gracefully (0.2898ms)
✔ Overview Integration: successful parallel requests adapt to live view models (58.672ms)
✔ Overview Integration: 404 PLAN_NOT_FOUND is handled gracefully without crashing overview (8.7948ms)
✔ Overview Integration: handles empty operational state honestly (0 orders, 0 shortages) (0.9872ms)
✔ Overview Integration: unsupported widgets retain honest simulated benchmarks (0.2724ms)
✔ Overview Integration: API failure surfaces error and does NOT silently return mock data (2.0959ms)
✔ Schedule & Plan: maps all documented task statuses accurately (36.9945ms)
✔ Schedule & Plan: preserves locked-task state per AGENTS.md Rule 10 (0.9301ms)
✔ Schedule & Plan: handles cook_no, burner_no, task_type and duration correctly (2.1196ms)
✔ Schedule & Plan: flags tasks whose order_id is in plan.late_orders (1.0223ms)
✔ Schedule & Plan: enriches task with customer name, channel, and deadline from orders (1.0457ms)
✔ Schedule & Plan Summary: computes metrics from code and excludes cancelled from active (1.2605ms)
✔ Schedule & Plan: handles 404 PLAN_NOT_FOUND gracefully as empty plan state (54.1508ms)
✔ Schedule & Plan: throws ApiError on 500 without silent fallback to mock data (3.9689ms)
✔ Schedule & Plan Date Utils: formats dates and times accurately in IST (1.0667ms)
✔ Schedule & Plan: live mode error state never leaks demo data or metadata (1.372ms)
✔ Schedule & Plan: verifies sequence counter discards older responses (62.0286ms)
ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 530.734
```

### Production Build (`npm run build`)
```
> frontend@0.0.0 build
> tsc -b && vite build

vite v8.3.4 building client environment for production...
transforming...
✓ 79 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.98 kB │ gzip:  0.57 kB
dist/assets/index-BS_2y_nB.css  111.01 kB │ gzip: 14.39 kB
dist/assets/index-GCJ1IUpX.js   338.01 kB │ gzip: 98.03 kB

✓ built in 299ms
```

---

## 10. Manual Browser Checks Still Required

The following visual and interaction checks have been verified at code and test levels, but still require human verification in a real browser:
1. **Focus Ring Rendering**:
   - Tab through the header controls and filter tabs using the `Tab` key to visually confirm that the focus rings meet contrast expectations on both dark and light theme settings.
2. **Native Date Picker Interaction**:
   - Click the date display to open the native browser calendar popup, pick a date, and observe the network request and header update.
3. **Responsive Visual Polish**:
   - Resize the browser window to mobile widths (~375px) to confirm smooth vertical wrapping of the summary ribbon and filter bar without clipping.
4. **Live Mode Toggle**:
   - When the backend is running, toggle between Live API and Demo Mode to observe the live badge status and task card updates.
