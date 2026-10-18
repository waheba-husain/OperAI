/* ============================================================
   frontend/src/components/shortageRecovery/RecoveryOptionCard.tsx
   OperAI / Cloud Kitchen Rescue — Candidate Recovery Option Card

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose response `options`)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Rest_API_Spec.md §3.13 (POST /api/actions/{id}/reject)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM can never approve; Rule 4: Explicit option number)
   ============================================================ */

import type { RecoveryOptionViewModel } from '../../types/shortageRecovery.ts'
import './RecoveryOptionCard.css'

export interface RecoveryOptionCardProps {
  readonly option: RecoveryOptionViewModel
  readonly onApprove?: (actionId: string, optionNumber: number) => void
  readonly onReject?: (actionId: string) => void
  readonly isApproving?: boolean
  readonly isRejecting?: boolean
  readonly isAnyMutationPending?: boolean
  readonly mutationError?: string | null
  readonly isDemoMode?: boolean
}

export function RecoveryOptionCard({
  option,
  onApprove,
  onReject,
  isApproving = false,
  isRejecting = false,
  isAnyMutationPending = false,
  mutationError = null,
  isDemoMode = false
}: RecoveryOptionCardProps) {
  const isRecommended = option.isRecommended
  const isPending = option.status === 'pending'
  const isActionDisabled = isAnyMutationPending || isDemoMode || !isPending

  const getStatusTagClass = (status: string) => {
    switch (status) {
      case 'executed':
        return 'recovery-option-status-tag--executed'
      case 'rejected':
        return 'recovery-option-status-tag--rejected'
      case 'expired':
        return 'recovery-option-status-tag--expired'
      default:
        return 'recovery-option-status-tag--pending'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'executed':
        return 'Executed'
      case 'rejected':
        return 'Declined'
      case 'expired':
        return 'Expired'
      default:
        return 'Pending'
    }
  }

  return (
    <article
      className={`recovery-option-card ${
        isRecommended ? 'recovery-option-card--recommended' : ''
      } recovery-option-card--${option.status}`}
      aria-labelledby={`option-heading-${option.optionNumber}`}
    >
      <div className="recovery-option-card__header">
        <div className="recovery-option-card__badges">
          <span className="recovery-option-number-badge">
            Option #{option.optionNumber}
          </span>
          <span className="recovery-option-type-badge">
            {option.optionTypeLabel}
          </span>
          {isRecommended && (
            <span className="recovery-option-recommended-pill">
              ★ Recommended by Engine
            </span>
          )}
          <span className={`recovery-option-status-tag ${getStatusTagClass(option.status)}`}>
            {getStatusLabel(option.status)}
          </span>
        </div>

        <h3
          id={`option-heading-${option.optionNumber}`}
          className="recovery-option-card__title"
        >
          {option.title}
        </h3>
      </div>

      {/* Mandatory Customer Consent Warning */}
      {option.needsCustomerConsent && (
        <div className="recovery-consent-banner" role="alert">
          <span className="recovery-consent-icon" aria-hidden="true">⚠️</span>
          <div className="recovery-consent-content">
            <strong className="recovery-consent-title">
              Customer Consent Required
            </strong>
            <p className="recovery-consent-desc">
              Alters recipe or order composition; requires explicit diner consent before dispatch.
            </p>
          </div>
        </div>
      )}

      {/* Impact Evaluation Grid */}
      <div className="recovery-option-card__impact-grid">
        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Orders Protected</span>
          <span className="recovery-impact-val recovery-impact-val--positive">
            +{option.ordersProtected} orders
          </span>
        </div>

        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Late Orders</span>
          <span className="recovery-impact-val">
            {option.lateOrders} orders
          </span>
        </div>

        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Residual Exposure</span>
          <span className="recovery-impact-val">
            {option.revenueAtRiskAfterFormatted ?? 'Not evaluated'}
          </span>
        </div>

        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Cost Impact</span>
          <span className="recovery-impact-val">
            {option.extraCostLabel}
          </span>
        </div>

        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Margin Impact</span>
          <span className="recovery-impact-val">
            {option.marginDeltaPct !== undefined
              ? option.marginDeltaPct >= 0
                ? `+${option.marginDeltaPct.toFixed(1)}%`
                : `${option.marginDeltaPct.toFixed(1)}%`
              : 'N/A'}
          </span>
        </div>

        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Satisfaction Risk</span>
          <span className="recovery-impact-val">
            {option.customerRisk ? `${option.customerRisk.toUpperCase()} Risk` : 'N/A'}
          </span>
        </div>

        <div className="recovery-impact-cell">
          <span className="recovery-impact-label">Solver Score</span>
          <span className="recovery-impact-val recovery-impact-val--highlight">
            {option.score.toFixed(2)} ({option.scorePct}%)
          </span>
        </div>
      </div>

      {/* Error Callout if Mutation for this card failed */}
      {mutationError && (
        <div className="recovery-card-mutation-error" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{mutationError}</span>
        </div>
      )}

      {/* Decision Controls (Explicit Approval & Rejection) */}
      <div className="recovery-option-card__actions">
        {isPending ? (
          <>
            <button
              type="button"
              className="recovery-action-btn recovery-action-btn--approve"
              onClick={() => onApprove?.(option.actionId, option.optionNumber)}
              disabled={isActionDisabled}
              title={
                isDemoMode
                  ? 'Approval disabled in Demo Mode: Connect live backend to apply changes'
                  : `Explicitly approve Option #${option.optionNumber}`
              }
              aria-label={`Approve Option #${option.optionNumber}: ${option.title}`}
            >
              {isApproving ? (
                <>
                  <span className="recovery-btn-spinner" aria-hidden="true" />
                  Applying Option #{option.optionNumber}...
                </>
              ) : (
                <>
                  <span aria-hidden="true">✓</span>
                  Approve Option #{option.optionNumber}
                </>
              )}
            </button>

            <button
              type="button"
              className="recovery-action-btn recovery-action-btn--reject"
              onClick={() => onReject?.(option.actionId)}
              disabled={isActionDisabled}
              title={
                isDemoMode
                  ? 'Rejection disabled in Demo Mode'
                  : `Decline Option #${option.optionNumber}`
              }
              aria-label={`Decline Option #${option.optionNumber}`}
            >
              {isRejecting ? 'Declining...' : 'Decline'}
            </button>

            {isDemoMode && (
              <span className="recovery-demo-mode-note">
                (Read-only in demo mode)
              </span>
            )}
          </>
        ) : (
          <div
            className={`recovery-action-completed-banner recovery-action-completed-banner--${option.status}`}
            role="status"
          >
            {option.status === 'executed' &&
              '✓ Approved & Executed — Applied to kitchen schedule and plan version bumped.'}
            {option.status === 'rejected' &&
              '✕ Declined — Action rejected and recorded in audit log. No plan changes applied.'}
            {option.status === 'expired' &&
              '⏱ Expired — Proposal was invalidated by an approved alternative or expired past cutoff.'}
          </div>
        )}
      </div>

      {/* Proposal Expiry & Safety Boundary Notice */}
      <div className="recovery-option-card__footer">
        <div className="recovery-expiry-indicator">
          <span className="recovery-expiry-dot" aria-hidden="true" />
          <span>Valid until: <strong>{option.expiresAtFormatted}</strong></span>
        </div>

        <div className="recovery-safety-notice">
          <span>Action ID: <code>{option.actionId}</code></span>
        </div>
      </div>
    </article>
  )
}
