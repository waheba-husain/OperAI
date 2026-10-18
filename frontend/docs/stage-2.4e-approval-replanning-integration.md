# Stage 2.4E — Approval & Replanning Integration Report
**OperAI / Cloud Kitchen Rescue**  
**Integration Status:** Complete & Verified  
**Date:** 2026-10-18  

---

## 1. Files Created and Modified

### Created Files
- [`frontend/src/components/shortageRecovery/ApprovalResultModal.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/ApprovalResultModal.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/ApprovalResultModal.css) — Post-approval results dialog presenting plan version bump (`v{before} → v{after}`), audit log ID, rescheduled tasks count, affected orders list, change summary, and customer WhatsApp draft messages with prominent consent-required alerts and safe external link handling.
- [`frontend/src/components/shortageRecovery/PendingActionsList.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/PendingActionsList.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/PendingActionsList.css) — Real-time list of pending actions fetched via `GET /api/actions?status=pending`. Displays Action ID, Group ID, Option number, Action type, Title, Status, Impact summary, Base plan version, Creation time, and Expiry cutoff, with explicit user decision controls.
- [`frontend/src/api/__tests__/actionApprovalIntegration.test.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/__tests__/actionApprovalIntegration.test.ts) — Comprehensive 18-test unit and integration test suite covering action retrieval, explicit approval payloads, option number preservation, rejection, sibling invalidation, customer WhatsApp drafts, all documented conflict codes, idempotency, retry prevention, and background refresh failure isolation.
- [`frontend/docs/stage-2.4e-approval-replanning-integration.md`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/docs/stage-2.4e-approval-replanning-integration.md) — This report.

### Modified Files
- [`frontend/src/types/dto.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/types/dto.ts) — Added `ActionApproveRequestDTO` (`confirm_option_number`, `input_mode`, `transcript`) and `ActionRejectRequestDTO` (`reason`).
- [`frontend/src/types/shortageRecovery.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/types/shortageRecovery.ts) — Added `CustomerMessageViewModel`, `ApprovalResultViewModel`, `RejectionResultViewModel`, and `PendingActionViewModel`.
- [`frontend/src/api/endpoints.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/endpoints.ts) — Added typed helper functions `approveAction(id, data, options)` and `rejectAction(id, data, options)`.
- [`frontend/src/api/adapters/actionAdapter.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/adapters/actionAdapter.ts) — Added `adaptProposedActionToViewModel`, `adaptProposedActionsToViewModels`, `adaptApprovalResponseToViewModel`, `adaptRejectionResponseToViewModel`, `adaptCustomerMessageToViewModel`, and `formatActionErrorMessage`.
- [`frontend/src/api/index.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/api/index.ts) — Exported `approveAction`, `rejectAction`, and all new action adapter utilities.
- [`frontend/src/hooks/useShortageRecoveryData.ts`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/hooks/useShortageRecoveryData.ts) — Implemented pending actions retrieval (`GET /api/actions?status=pending`), explicit action approval (`POST /api/actions/{id}/approve`), action rejection (`POST /api/actions/{id}/reject`), mutation loading and error states, duplicate submission prevention, sibling invalidation, and post-approval plan/brief refresh with error isolation.
- [`frontend/src/components/shortageRecovery/RecoveryOptionCard.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoveryOptionCard.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoveryOptionCard.css) — Added explicit "Approve Option #{option.optionNumber}" green action control, "Decline" button, in-flight mutation loading spinners, status banners (`executed`, `rejected`, `expired`), mutation error alerts, and demo mode notices.
- [`frontend/src/components/shortageRecovery/RecoverySimulationResults.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/components/shortageRecovery/RecoverySimulationResults.tsx) — Wired approval and rejection callbacks, mutation state flags, and card-specific error messages.
- [`frontend/src/pages/ShortageRecoveryPage.tsx`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/pages/ShortageRecoveryPage.tsx) & [`.css`](file:///c:/Users/Fariha%20Asif/Projects/OperAI/frontend/src/pages/ShortageRecoveryPage.css) — Integrated `PendingActionsList`, `ApprovalResultModal`, mutation conflict alerts with specific operational guidance, and rejection feedback banners.

---

## 2. Endpoints Integrated

### 1. `GET /api/actions?status=pending`
- **Spec Section:** `Rest_API_Spec.md §3.11`
- **Method:** `GET`
- **Purpose:** Retrieves pending actions from the database to present active recovery options awaiting operator decision, including after a page reload.
- **Client Helper:** `getActions({ status: 'pending' }, { client, signal })`

### 2. `POST /api/actions/{id}/approve`
- **Spec Section:** `Rest_API_Spec.md §3.12`
- **Method:** `POST`
- **Purpose:** Executes atomic approval in a single database transaction. Checks action is pending and unexpired, checks plan version and stock fingerprint are unchanged, applies the change, replans affected tasks, logs audit entry, and expires sibling options.
- **Request Body:** `{ confirm_option_number: number, input_mode: 'click' }`
- **Response Body:** `{ action: { id, status: 'executed', executed_at }, plan_version_before, plan_version_after, audit_id, changes: { orders_affected, tasks_rescheduled, summary }, customer_messages, expired_action_ids }`
- **Client Helper:** `approveAction(id, data, { client, signal })`

### 3. `POST /api/actions/{id}/reject`
- **Spec Section:** `Rest_API_Spec.md §3.13`
- **Method:** `POST`
- **Purpose:** Declines a proposed action ("none of these"). Marks it rejected and writes an audit entry without modifying plan or stock.
- **Request Body:** `{ reason?: string }`
- **Response Body:** `{ action: { id, status: 'rejected', decided_at }, audit_id }`
- **Client Helper:** `rejectAction(id, data, { client, signal })`

### 4. `GET /api/plan?date=YYYY-MM-DD`
- **Spec Section:** `Rest_API_Spec.md §3.8`
- **Method:** `GET`
- **Purpose:** Refreshes daily schedule board post-approval.

### 5. `GET /api/brief?date=YYYY-MM-DD`
- **Spec Section:** `Rest_API_Spec.md §3.9`
- **Method:** `GET`
- **Purpose:** Refreshes proactive risk brief and shortages post-approval.

---

## 3. Approval and Rejection Request Mapping

### Strict Option Number Preservation (AGENTS.md Rule 4)
- When approving an action, the UI extracts `option.optionNumber` directly from the candidate action data model.
- **Never Derived from UI Array Index:** Option numbering is not assumed to start at 0 or match the visual list index. If the engine returns `Option #2`, `confirm_option_number: 2` is sent.
- **Input Mode:** Transmits `input_mode: "click"`. Voice approval is out-of-scope for this stage and was not implemented.
- **No AI Auto-Approval (AGENTS.md Rule 2):** Approval requires an explicit user click on the approval button. Proposal generation or card selection never approves or executes an action.

### Rejection Request Mapping
- The decline button sends `POST /api/actions/{id}/reject` with `{ reason?: string }`.
- When reason is omitted, an empty payload `{}` is transmitted per specification.
- Rejection is strictly presented as an audit-logged decision and is never claimed as a plan change.

---

## 4. Successful Mutation Handling

On successful approval (HTTP 200), the UI opens the `ApprovalResultModal` presenting only fields returned by the backend:
- **Action ID & Timestamp:** `action.id` and `action.executed_at` formatted in IST.
- **Plan Version Jump:** Visual indicator displaying `v{plan_version_before} → v{plan_version_after}`.
- **Rescheduled Tasks:** Accurate task count from `changes.tasks_rescheduled`.
- **Audit Log Reference:** `audit_id` displayed for traceability.
- **Operational Summary:** Exact text from `changes.summary`.
- **Affected Orders:** Order IDs rendered from `changes.orders_affected`.
- **Expired Siblings:** Action IDs from `expired_action_ids` struck through.
- **Local State Synchronization:**
  - Approved option marked `status: 'executed'`.
  - Sibling options in `expired_action_ids` marked `status: 'expired'`.

---

## 5. Plan and Action Refresh Behavior

Following an approval:
1. `fetchBrief()` updates active shortages and revenue at risk.
2. `fetchPendingActions()` re-syncs the active pending action list.
3. `getPlan({ date: targetDate })` re-fetches the updated kitchen schedule.

### Refresh Error Isolation
If an approval POST succeeds (HTTP 200) but a subsequent GET refresh encounters a network or server error:
- The successful approval result is preserved in `latestApprovalResult` and remains visible to the operator.
- The failure is captured in `postApprovalRefreshError` and displayed as a non-fatal warning ("Plan change succeeded, but automatic refresh failed: ... You can click Refresh to sync your view").
- The action is **never misrepresented as failed**, and the POST is **never re-submitted**.

---

## 6. Conflict & Error Handling

All documented error codes from `Rest_API_Spec.md §3.12 & §3.13` are handled with operational guidance:

| Status Code | Error Code | Operational UI Handling |
| :--- | :--- | :--- |
| **401** | `UNAUTHORIZED` | Warns that authentication failed; prompts to verify `X-API-Key`. |
| **404** | `ACTION_NOT_FOUND` | Explains action ID was not found on the backend. |
| **422** | `OPTION_MISMATCH` | Explains confirmation number did not match action option number; does not retry. |
| **422** | `VALIDATION_ERROR` | Surfaces backend validation message. |
| **409** | `ACTION_NOT_PENDING` | Explains action is no longer pending (already executed, rejected, or expired); triggers background refresh of pending actions. |
| **409** | `ACTION_EXPIRED` | Explains proposal passed its validity cutoff; marks option expired and refreshes action list. |
| **409** | `PLAN_CHANGED` | Explains kitchen plan version moved; prompts operator to generate a fresh recovery simulation. |
| **409** | `STOCK_CHANGED` | Explains stock fingerprint moved; prompts operator to re-simulate against current stock. |
| **500** | `INTERNAL_ERROR` | Explains database transaction failed on backend and was rolled back; confirms no changes were applied. |

### Retry Prevention
Mutation POST requests are **never automatically retried**. Controls are disabled while requests are in flight (`isApprovingActionId` or `isRejectingActionId`) to prevent duplicate submissions.

---

## 7. Customer Message Drafts & Consent Handling

When approval returns `customer_messages`:
- **Rendered Drafts:** Displays `order_id`, `customer_name`, and `message` text.
- **Diner Consent Warning:** If `needs_consent: true`, displays an amber warning banner:
  > **Customer Consent Required:** This recovery recipe alters order contents. Dispatch is conditional on customer agreement.
- **No Automatic Consent:** The UI never implies the customer consented or auto-marks consent as complete.
- **WhatsApp Integration:**
  - Renders a green button linking to `msg.whatsapp_url`.
  - Attributes: `target="_blank" rel="noopener noreferrer"` for external link safety.
  - Informational disclaimer: *"OperAI does not automatically send WhatsApp messages. Review the draft above and send manually via WhatsApp."*

---

## 8. Live vs. Demo Behavior

- **Strict Isolation:** In Demo Mode (`mode === 'demo'`), approval and rejection buttons are disabled with explanatory text: `(Read-only in demo mode)`.
- If an approval is attempted in demo mode, a friendly alert explains that approvals modify real database plans and require a live backend connection.
- Demo mode never fabricates an approval transaction or claims live plan modification.
- Live API failures never silently fall back to mock data.

---

## 9. Tests and Actual Results

All tests executed via Node 24 native test runner (`node --test`):

```bash
node --test src/api/__tests__/*.test.ts
```

### Test Suite Summary (78 Tests Across 6 Suites)

| Test Suite | Tests | Result |
| :--- | :---: | :---: |
| `actionApprovalIntegration.test.ts` | 18 | **PASS** |
| `shortageRecoveryIntegration.test.ts` | 12 | **PASS** |
| `schedulePlanIntegration.test.ts` | 11 | **PASS** |
| `liveOpsIntegration.test.ts` | 10 | **PASS** |
| `overviewIntegration.test.ts` | 8 | **PASS** |
| `apiClientAndAdapters.test.ts` | 19 | **PASS** |
| **Total** | **78** | **ALL PASS** (553ms) |

### Action Approval Suite Detail (18 Tests)
1. `GET /api/actions: maps proposed actions to PendingActionViewModel preserving IDs, group_id, and option_number` — **PASS**
2. `POST /api/actions/{id}/approve: transmits exact confirm_option_number and input_mode: "click"` — **PASS**
3. `POST /api/actions/{id}/approve: maps success response to ApprovalResultViewModel` — **PASS**
4. `Customer messages: properly flags consent requirements without auto-completing consent` — **PASS**
5. `POST /api/actions/{id}/reject: transmits optional reason and adapts rejection response` — **PASS**
6. `POST /api/actions/{id}/reject: handles rejection without reason (empty body)` — **PASS**
7. `Error handling: 422 OPTION_MISMATCH generates actionable user error` — **PASS**
8. `Error handling: 409 ACTION_NOT_PENDING indicates action already executed or expired` — **PASS**
9. `Error handling: 409 ACTION_EXPIRED indicates proposal past validity cutoff` — **PASS**
10. `Error handling: 409 PLAN_CHANGED requires re-simulation` — **PASS**
11. `Error handling: 409 STOCK_CHANGED requires re-simulation` — **PASS**
12. `Error handling: 404 ACTION_NOT_FOUND` — **PASS**
13. `Error handling: 401 UNAUTHORIZED surfaces authentication failure` — **PASS**
14. `Error handling: 500 INTERNAL_ERROR confirms rollback without claiming applied change` — **PASS**
15. `Safety: POST /api/actions/{id}/approve is never automatically retried on failure` — **PASS**
16. `Safety: expired sibling actions are identified and invalidated upon approval` — **PASS**
17. `State integrity: successful approval followed by failed background refresh preserves approval result` — **PASS**
18. `Customer messages: preserves WhatsApp draft URLs and requires manual sending` — **PASS**

---

## 10. Production Build Result

Executed Vite production build:

```bash
npm run build
```

**Output:**
```
> frontend@0.0.0 build
> tsc -b && vite build

vite v8.3.4 building client environment for production...
transforming...
✓ 96 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.98 kB │ gzip:   0.57 kB
dist/assets/index-CMoYs46k.css  148.01 kB │ gzip:  18.33 kB
dist/assets/index-DKenm4Ed.js   386.69 kB │ gzip: 108.97 kB

✓ built in 284ms
```

---

## 11. Known Limitations

1. **Voice Approvals Deferred:** The backend schema documents optional `input_mode: "voice"` and `transcript`. This stage strictly implements `input_mode: "click"`; voice recognition approval will be implemented in a future voice-specific stage.
2. **Manual WhatsApp Sending:** OperAI does not integrate with Twilio or external WhatsApp APIs to auto-send messages. Message drafts are prefilled in browser `wa.me` links for the kitchen operator to review and dispatch manually.
3. **No Undo in this Stage:** Action execution produces an `audit_id`. Rolling back changes via `POST /api/audit/{id}/undo` is part of the Audit Log and Undo stage and is not implemented here.

---

## 12. Manual Browser Checks Still Required

The following manual browser verification steps should be performed against a live backend:
1. Open the **Shortage Radar & Recovery Simulator** page with `VITE_API_KEY` configured.
2. Click **Simulate Recovery Options** on an active shortage (e.g. Paneer).
3. Observe Option cards displaying solver evaluation and "Approve Option #X" buttons.
4. Click **Approve Option #1**; verify the button enters loading state ("Applying Option #1..."), then opens the **Plan Modification Applied** modal.
5. In the modal, verify `v{before} → v{after}` version jump, rescheduled task count, and customer WhatsApp link.
6. Click the WhatsApp link; verify it opens `https://wa.me/...` in a new tab with `rel="noopener noreferrer"`.
7. Dismiss modal; verify Option #1 displays "Approved & Executed" banner, and sibling options (Options #2 and #3) display "Expired".
8. Switch to **Demo Mode**; verify that clicking Approve or Decline is disabled and explains demo read-only policy.
