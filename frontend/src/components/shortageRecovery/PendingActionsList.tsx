/* ============================================================
   frontend/src/components/shortageRecovery/PendingActionsList.tsx
   OperAI / Cloud Kitchen Rescue — Pending Actions List Component

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.11 (GET /api/actions?status=pending)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Rest_API_Spec.md §3.13 (POST /api/actions/{id}/reject)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM never approves; Rule 4: Explicit option number)
   ============================================================ */

import type { PendingActionViewModel } from '../../types/shortageRecovery.ts'
import './PendingActionsList.css'

export interface PendingActionsListProps {
  readonly pendingActions: readonly PendingActionViewModel[]
  readonly isLoading: boolean
  readonly error: Error | null
  readonly onRefresh: () => void
  readonly onApprove?: (actionId: string, optionNumber: number) => void
  readonly onReject?: (actionId: string) => void
  readonly isApprovingActionId?: string | null
  readonly isRejectingActionId?: string | null
  readonly isDemoMode?: boolean
}

export function PendingActionsList({
  pendingActions,
  isLoading,
  error,
  onRefresh,
  onApprove,
  onReject,
  isApprovingActionId = null,
  isRejectingActionId = null,
  isDemoMode = false
}: PendingActionsListProps) {
  const isAnyMutationPending = Boolean(isApprovingActionId || isRejectingActionId)

  return (
    <section className="pending-actions-section" aria-labelledby="pending-actions-heading">
      <div className="pending-actions-header">
        <div className="pending-actions-title-wrap">
          <h2 id="pending-actions-heading" className="pending-actions-title">
            Pending Decision Proposals
          </h2>
          <span className="pending-actions-count-badge">
            {pendingActions.length} active
          </span>
        </div>

        <button
          type="button"
          className="pending-actions-refresh-btn"
          onClick={onRefresh}
          disabled={isLoading || isAnyMutationPending}
          title="Refresh pending actions from backend"
        >
          {isLoading ? 'Syncing...' : '↻ Refresh Actions'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="recovery-card-mutation-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>Failed to fetch pending actions: {error.message}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && pendingActions.length === 0 && (
        <div className="pending-actions-loading" role="status">
          <span>Loading pending recovery actions...</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && pendingActions.length === 0 && (
        <div className="pending-actions-empty">
          <strong>No Pending Decision Proposals</strong>
          <span>
            Candidate recovery proposals will appear here when generated. All options require explicit operator approval before execution.
          </span>
        </div>
      )}

      {/* List of Pending Actions */}
      {pendingActions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} role="list">
          {pendingActions.map((action) => {
            const isThisApproving = isApprovingActionId === action.id
            const isThisRejecting = isRejectingActionId === action.id
            const isActionDisabled = isAnyMutationPending || isDemoMode || action.status !== 'pending'

            return (
              <article key={action.id} className="pending-action-item" role="listitem">
                <div className="pending-action-meta-bar">
                  <span className="pending-action-opt-badge">
                    Option #{action.optionNumber}
                  </span>
                  <span className="pending-action-type-badge">
                    {action.actionType}
                  </span>
                  <span className="pending-action-id-code">
                    ID: {action.id}
                  </span>
                  <span className="pending-action-id-code" style={{ marginLeft: 'auto' }}>
                    Group: {action.groupId ? action.groupId.slice(0, 8) : 'N/A'}
                  </span>
                  {action.basePlanVersion !== undefined && (
                    <span className="pending-action-id-code">
                      Base Plan: v{action.basePlanVersion}
                    </span>
                  )}
                </div>

                <h3 className="pending-action-item-title">
                  {action.title}
                </h3>

                <p className="pending-action-impact">
                  {action.impactSummary}
                </p>

                <div className="pending-action-timing-row">
                  <span>
                    Created: <strong>{action.createdAtFormatted ?? 'Recently'}</strong>
                  </span>
                  <span style={action.isExpired ? { color: 'var(--color-red-600, #dc2626)', fontWeight: 'bold' } : {}}>
                    {action.isExpired ? '⚠️ Expired: ' : 'Expires: '}
                    <strong>{action.expiresAtFormatted}</strong>
                  </span>
                </div>

                {/* Explicit Approval & Reject Controls */}
                <div className="pending-action-controls">
                  <button
                    type="button"
                    className="pending-btn-approve"
                    onClick={() => onApprove?.(action.id, action.optionNumber)}
                    disabled={isActionDisabled}
                    title={
                      isDemoMode
                        ? 'Approval disabled in demo mode'
                        : `Approve Option #${action.optionNumber}`
                    }
                    aria-label={`Approve Option #${action.optionNumber}: ${action.title}`}
                  >
                    {isThisApproving ? 'Approving...' : `Approve Option #${action.optionNumber}`}
                  </button>

                  <button
                    type="button"
                    className="pending-btn-reject"
                    onClick={() => onReject?.(action.id)}
                    disabled={isActionDisabled}
                    title={
                      isDemoMode
                        ? 'Rejection disabled in demo mode'
                        : `Decline Option #${action.optionNumber}`
                    }
                    aria-label={`Decline Option #${action.optionNumber}`}
                  >
                    {isThisRejecting ? 'Declining...' : 'Decline'}
                  </button>

                  {isDemoMode && (
                    <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                      (Demo mode read-only)
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
