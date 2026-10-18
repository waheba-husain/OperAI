/* ============================================================
   frontend/src/api/adapters/actionAdapter.ts
   OperAI / Cloud Kitchen Rescue — Proposed Action DTO to View-Model Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.11 (ProposedActionDTO)
   - frontend/src/types/liveOperations.ts (OpsAlert View Model)
   ============================================================ */

import type {
  ActionApproveResponseDTO,
  ActionRejectResponseDTO,
  CustomerMessageDTO,
  ProposedActionDTO
} from '../../types/dto.ts'
import type { AlertSeverity, OpsAlert } from '../../types/liveOperations.ts'
import type {
  ApprovalResultViewModel,
  CustomerMessageViewModel,
  PendingActionViewModel,
  RejectionResultViewModel
} from '../../types/shortageRecovery.ts'
import { ApiError } from '../errors.ts'
import { formatTimeIST } from './orderAdapter.ts'

/**
 * Calculates human-readable relative time (e.g. "5m ago" or "Just now") from an ISO timestamp.
 */
export function formatTimeAgo(isoString?: string): string {
  if (!isoString) return 'Active'
  const time = new Date(isoString).getTime()
  if (isNaN(time)) return 'Active'

  const diffSec = Math.round((Date.now() - time) / 1000)
  if (diffSec < 60) return 'Just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.round(diffMin / 60)
  return `${diffHours}h ago`
}

/**
 * Extracts a concise summary string from the polymorphic action impact object.
 */
export function formatActionImpactSummary(action: ProposedActionDTO): string {
  const impact = action.impact
  if (!impact) {
    return 'Pending review and confirmation.'
  }

  // Recovery impact shape
  if ('orders_protected' in impact && typeof impact.orders_protected === 'number') {
    const costText = typeof impact.extra_cost === 'number'
      ? impact.extra_cost < 0
        ? `saves ₹${Math.abs(impact.extra_cost).toFixed(2)}`
        : `extra cost ₹${impact.extra_cost.toFixed(2)}`
      : ''
    return `Protects ${impact.orders_protected} order(s)${costText ? `; ${costText}` : ''}.`
  }

  // Price change impact shape
  if ('profit_per_order_after' in impact && typeof impact.profit_per_order_after === 'number') {
    return `Adjusts unit profit to ₹${impact.profit_per_order_after.toFixed(2)}.`
  }

  return 'Awaiting owner decision.'
}

/**
 * Transforms a ProposedActionDTO into an OpsAlert for Live Operations.
 */
export function adaptActionToOpsAlert(action: ProposedActionDTO): OpsAlert {
  let severity: AlertSeverity = 'info'
  if (action.action_type === 'recovery') {
    severity = 'warning'
  }

  const detail = formatActionImpactSummary(action)
  const groupSnippet = action.group_id ? action.group_id.slice(0, 8) : 'General'
  const context = `Option #${action.option_number ?? 1} • Group: ${groupSnippet}`
  const timeAgo = formatTimeAgo(action.created_at)

  return {
    id: action.id,
    severity,
    title: action.title,
    detail,
    context,
    timeAgo
  }
}

/**
 * Transforms an array of ProposedActionDTOs into OpsAlerts.
 */
export function adaptActionsToOpsAlerts(actions: readonly ProposedActionDTO[]): OpsAlert[] {
  return actions.map(adaptActionToOpsAlert)
}

/**
 * Transforms a ProposedActionDTO from GET /api/actions into a PendingActionViewModel.
 * Preserves backend IDs and option numbers directly.
 */
export function adaptProposedActionToViewModel(action: ProposedActionDTO): PendingActionViewModel {
  const isExpired = action.expires_at ? new Date(action.expires_at).getTime() <= Date.now() : false
  return {
    id: action.id,
    groupId: action.group_id,
    optionNumber: action.option_number,
    actionType: action.action_type,
    title: action.title,
    status: action.status,
    impact: action.impact ?? null,
    impactSummary: formatActionImpactSummary(action),
    basePlanVersion: action.base_plan_version,
    createdAt: action.created_at,
    createdAtFormatted: action.created_at ? formatTimeIST(action.created_at) : undefined,
    expiresAt: action.expires_at,
    expiresAtFormatted: action.expires_at ? formatTimeIST(action.expires_at) : 'No expiry',
    isExpired
  }
}

/**
 * Transforms an array of ProposedActionDTOs into PendingActionViewModels.
 */
export function adaptProposedActionsToViewModels(actions: readonly ProposedActionDTO[]): PendingActionViewModel[] {
  return actions.map(adaptProposedActionToViewModel)
}

/**
 * Transforms a CustomerMessageDTO draft returned from approval into a view model.
 */
export function adaptCustomerMessageToViewModel(dto: CustomerMessageDTO): CustomerMessageViewModel {
  return {
    orderId: dto.order_id,
    customerName: dto.customer_name,
    needsConsent: Boolean(dto.needs_consent),
    message: dto.message,
    whatsappUrl: dto.whatsapp_url
  }
}

/**
 * Transforms the response of POST /api/actions/{id}/approve into ApprovalResultViewModel.
 */
export function adaptApprovalResponseToViewModel(response: ActionApproveResponseDTO): ApprovalResultViewModel {
  return {
    actionId: response.action.id,
    status: response.action.status,
    executedAt: response.action.executed_at,
    executedAtFormatted: formatTimeIST(response.action.executed_at),
    planVersionBefore: response.plan_version_before,
    planVersionAfter: response.plan_version_after,
    auditId: response.audit_id,
    changes: {
      ordersAffected: response.changes?.orders_affected ?? [],
      tasksRescheduled: response.changes?.tasks_rescheduled ?? 0,
      summary: response.changes?.summary ?? 'Plan updated successfully'
    },
    customerMessages: (response.customer_messages ?? []).map(adaptCustomerMessageToViewModel),
    expiredActionIds: response.expired_action_ids ?? []
  }
}

/**
 * Transforms the response of POST /api/actions/{id}/reject into RejectionResultViewModel.
 */
export function adaptRejectionResponseToViewModel(response: ActionRejectResponseDTO): RejectionResultViewModel {
  return {
    actionId: response.action.id,
    status: response.action.status,
    decidedAt: response.action.decided_at,
    decidedAtFormatted: formatTimeIST(response.action.decided_at),
    auditId: response.audit_id
  }
}

/**
 * Formats backend action error codes into actionable user messages.
 */
export function formatActionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ACTION_NOT_PENDING':
        return 'Action is no longer pending (already executed, rejected, or expired). The pending actions list has been refreshed.'
      case 'ACTION_EXPIRED':
        return 'This recovery action has expired past its validity cutoff. Please run a fresh recovery simulation.'
      case 'PLAN_CHANGED':
        return 'The kitchen plan changed while evaluating this action. Please re-simulate recovery options against the current plan.'
      case 'STOCK_CHANGED':
        return 'Ingredient stock changed while evaluating this action. Please re-simulate recovery options against current stock.'
      case 'OPTION_MISMATCH':
        return 'Option confirmation mismatch: The confirmation number did not match this action option number.'
      case 'ACTION_NOT_FOUND':
        return 'Action not found: The action ID does not exist on the server.'
      case 'UNAUTHORIZED':
        return 'Authentication required. Check that your X-API-Key is valid and configured.'
      case 'INTERNAL_ERROR':
        return 'Database transaction failed on the backend and was rolled back. No changes were applied to the plan.'
      case 'VALIDATION_ERROR':
        return `Validation error: ${error.message}`
      default:
        return error.message
    }
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
