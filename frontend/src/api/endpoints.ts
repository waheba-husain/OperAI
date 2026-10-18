/* ============================================================
   frontend/src/api/endpoints.ts
   OperAI / Cloud Kitchen Rescue — Typed Endpoint Helpers

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md (Exact HTTP Methods, Paths & Shapes)
   - frontend/src/types/dto.ts (Standard Backend DTOs)
   ============================================================ */

import type {
  ActionApproveRequestDTO,
  ActionApproveResponseDTO,
  ActionListResponseDTO,
  ActionRejectRequestDTO,
  ActionRejectResponseDTO,
  ActionStatusDTO,
  AuditEventTypeDTO,
  AuditListResponseDTO,
  AuditUndoResponseDTO,
  BriefResponseDTO,
  DailySummaryDTO,
  IngredientListResponseDTO,
  MenuListResponseDTO,
  OrderListResponseDTO,
  OrderStatusDTO,
  PlanResponseDTO,
  RecoveryProposeRequestDTO,
  RecoveryProposeResponseDTO
} from '../types/dto.ts'
import { apiClient as defaultClient, ApiClient } from './client.ts'

/* ── 1. Orders (Rest_API_Spec.md §3.5) ─────────────────────── */

export interface GetOrdersParams {
  /** Filter by deadline date in IST (format: YYYY-MM-DD) */
  readonly date?: string
  /** Filter by order status */
  readonly status?: OrderStatusDTO
  /** Max records to return (default 50, max 200) */
  readonly limit?: number
}

/**
 * List orders with line items (Rest_API_Spec.md §3.5).
 */
export async function getOrders(
  params?: GetOrdersParams,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<OrderListResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<OrderListResponseDTO>('/api/orders', params, { signal: options?.signal })
}

/* ── 2. Daily Plan & Schedule (Rest_API_Spec.md §3.8) ──────── */

export interface GetPlanParams {
  /** Target schedule date in IST (format: YYYY-MM-DD, required) */
  readonly date: string
}

/**
 * Read the current daily schedule board (Rest_API_Spec.md §3.8).
 */
export async function getPlan(
  params: GetPlanParams,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<PlanResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<PlanResponseDTO>('/api/plan', { date: params.date }, { signal: options?.signal })
}

/* ── 3. Proactive Risk Brief (Rest_API_Spec.md §3.9) ───────── */

export interface GetBriefParams {
  /** Date to evaluate in IST (format: YYYY-MM-DD, defaults to tomorrow if omitted) */
  readonly date?: string
}

/**
 * Get proactive risk brief comparing recipe needs with current stock (Rest_API_Spec.md §3.9).
 */
export async function getBrief(
  params?: GetBriefParams,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<BriefResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<BriefResponseDTO>('/api/brief', params, { signal: options?.signal })
}

/* ── 4. Proposed Actions (Rest_API_Spec.md §3.11) ──────────── */

export interface GetActionsParams {
  /** Filter by action status (pending, executed, rejected, expired, failed) */
  readonly status?: ActionStatusDTO
  /** Filter by action group UUID */
  readonly group_id?: string
  /** Max records to return (default 50, max 200) */
  readonly limit?: number
}

/**
 * List proposed actions, primarily pending options (Rest_API_Spec.md §3.11).
 */
export async function getActions(
  params?: GetActionsParams,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<ActionListResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<ActionListResponseDTO>('/api/actions', params, { signal: options?.signal })
}

/**
 * Explicitly approve a proposed action (Rest_API_Spec.md §3.12).
 * Atomic single-transaction lock, verification, replan, and audit entry.
 */
export async function approveAction(
  id: string,
  data: ActionApproveRequestDTO,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<ActionApproveResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.post<ActionApproveResponseDTO>(`/api/actions/${id}/approve`, data, { signal: options?.signal })
}

/**
 * Decline/reject a proposed action (Rest_API_Spec.md §3.13).
 * Marks action rejected and writes audit log. Changes no plan or stock.
 */
export async function rejectAction(
  id: string,
  data?: ActionRejectRequestDTO,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<ActionRejectResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.post<ActionRejectResponseDTO>(`/api/actions/${id}/reject`, data ?? {}, { signal: options?.signal })
}

/* ── 5. Menu Catalog (Rest_API_Spec.md §3.3) ───────────────── */

/**
 * List dishes with dynamic cost breakdown, profit, and margin status (Rest_API_Spec.md §3.3).
 */
export async function getMenu(
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<MenuListResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<MenuListResponseDTO>('/api/menu', undefined, { signal: options?.signal })
}

/* ── 6. Day-End Summary (Rest_API_Spec.md §3.17) ───────────── */

export interface GetSummaryParams {
  /** Date to summarize in IST (format: YYYY-MM-DD, defaults to today) */
  readonly date?: string
}

/**
 * Get day-end summary of protected orders and preserved revenue (Rest_API_Spec.md §3.17).
 */
export async function getSummary(
  params?: GetSummaryParams,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<DailySummaryDTO> {
  const client = options?.client ?? defaultClient
  return client.get<DailySummaryDTO>('/api/summary', params, { signal: options?.signal })
}

/* ── 7. Ingredients Stock (Rest_API_Spec.md §3.2) ──────────── */

/**
 * Show current inventory stock and costs (Rest_API_Spec.md §3.2).
 */
export async function getIngredients(
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<IngredientListResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<IngredientListResponseDTO>('/api/ingredients', undefined, { signal: options?.signal })
}

/* ── 8. Change Audit Trail (Rest_API_Spec.md §3.14) ────────── */

export interface GetAuditParams {
  /** Max records to return (default 50, max 200) */
  readonly limit?: number
  /** Filter by event type */
  readonly event_type?: AuditEventTypeDTO
  /** Whether to include before/after snapshots (default: false) */
  readonly include_snapshots?: boolean
}

/**
 * List change history, newest first (Rest_API_Spec.md §3.14).
 */
export async function getAudit(
  params?: GetAuditParams,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<AuditListResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.get<AuditListResponseDTO>('/api/audit', params, { signal: options?.signal })
}

/**
 * Propose reversing a past change using its stored before_snapshot (Rest_API_Spec.md §3.15).
 * Creates a pending undo action that must subsequently be approved via approveAction().
 * NOTE: This endpoint ONLY proposes the reversal as a pending action; it does NOT execute the undo.
 */
export async function undoAudit(
  id: string,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<AuditUndoResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.post<AuditUndoResponseDTO>(
    `/api/audit/${encodeURIComponent(id)}/undo`,
    undefined,
    { signal: options?.signal }
  )
}

/* ── 9. Propose Recovery (Rest_API_Spec.md §3.10) ──────────── */

/**
 * Generate candidate recovery options for an inventory shortage (Rest_API_Spec.md §3.10).
 * Simulates candidates against plan copy, re-solves, and compares against do-nothing baseline.
 */
export async function proposeRecovery(
  data: RecoveryProposeRequestDTO,
  options?: { signal?: AbortSignal; client?: ApiClient }
): Promise<RecoveryProposeResponseDTO> {
  const client = options?.client ?? defaultClient
  return client.post<RecoveryProposeResponseDTO>('/api/recovery/propose', data, { signal: options?.signal })
}
