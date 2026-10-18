/* ============================================================
   frontend/src/components/audit/UndoProposalModal.tsx
   OperAI / Cloud Kitchen Rescue — Safety-Gated Undo Proposal Modal

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - AGENTS.md (Rule 2: LLM never approves; Rule 3: Atomic approval;
                Rule 4: Explicit option number; Rule 6: Undo is pending action)
   ============================================================ */

import { useEffect, useCallback } from 'react'
import type { UndoProposalViewModel } from '../../types/audit.ts'
import type { ApiError, ConfigurationError, NetworkError } from '../../api/index.ts'
import './UndoProposalModal.css'

export interface UndoProposalModalProps {
  readonly proposal: UndoProposalViewModel | null
  readonly isOpen: boolean
  readonly isApproving: boolean
  readonly undoResolutionError: string | null
  readonly undoApprovalError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly onApprove: () => void
  readonly onClose: () => void
  readonly isLive: boolean
}

export function UndoProposalModal({
  proposal,
  isOpen,
  isApproving,
  undoResolutionError,
  undoApprovalError,
  onApprove,
  onClose,
  isLive
}: UndoProposalModalProps) {
  // Handle Escape key to close dialog
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isApproving) {
        onClose()
      }
    },
    [onClose, isApproving]
  )

  useEffect(() => {
    if (!isOpen || !proposal) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, proposal, handleKeyDown])

  if (!isOpen || !proposal) return null

  // Safety Gates (AGENTS.md Rules 2, 4, 6)
  const isTypeValid = proposal.actionType === 'undo'
  const isStatusPending = proposal.status === 'pending'
  const hasValidPositiveOptionNumber =
    typeof proposal.optionNumber === 'number' &&
    Number.isInteger(proposal.optionNumber) &&
    proposal.optionNumber > 0
  const isNotExpired = !proposal.isExpired

  // Strict approval eligibility gate
  const canApprove =
    proposal.isReadyForApproval &&
    isTypeValid &&
    isStatusPending &&
    hasValidPositiveOptionNumber &&
    isNotExpired &&
    isLive &&
    !isApproving

  return (
    <div
      className="undo-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="undo-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isApproving) {
          onClose()
        }
      }}
    >
      <div className="undo-modal">
        {/* Header */}
        <header className="undo-modal__header">
          <div className="undo-modal__title-group">
            <span className="undo-modal__kicker">PENDING REVERSAL PROPOSAL — APPROVAL REQUIRED</span>
            <h2 id="undo-modal-title" className="undo-modal__title">
              {proposal.title || 'Undo Action Proposal'}
            </h2>
          </div>
          <button
            type="button"
            className="undo-modal__close-btn"
            onClick={onClose}
            disabled={isApproving}
            aria-label="Close undo proposal dialog"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <div className="undo-modal__body">
          {/* Safety Notice Banner */}
          <div className="undo-pending-banner" role="alert">
            <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <strong>Reversal Has Not Yet Taken Effect</strong>
              <span>
                Under OperAI safety governance (AGENTS.md Rule 6), an undo is an approval-gated proposal.
                The kitchen schedule and inventory will NOT be altered until you explicitly approve option #{proposal.optionNumber ?? '?'}.
              </span>
            </div>
          </div>

          {/* Demo Mode Notice */}
          {!isLive && (
            <div className="undo-error-banner" role="alert">
              <strong>Simulated Demo Mode:</strong> Backend mutations are blocked in simulated demo mode. Switch to Live mode with valid credentials to execute atomic approvals.
            </div>
          )}

          {/* Resolution Error Banner */}
          {undoResolutionError && (
            <div className="undo-resolution-warning" role="alert">
              <strong>Option Resolution Issue:</strong> {undoResolutionError}
            </div>
          )}

          {/* Approval Error Banner */}
          {undoApprovalError && (
            <div className="undo-error-banner" role="alert">
              <strong>Approval Failed:</strong> {undoApprovalError.message}
            </div>
          )}

          {/* Expiry Warning */}
          {proposal.isExpired && (
            <div className="undo-error-banner" role="alert">
              <strong>Proposal Expired:</strong> This undo proposal expired at {proposal.expiresAtFormatted}. Please close and request a fresh undo proposal.
            </div>
          )}

          {/* Proposal Details Grid */}
          <div className="undo-proposal-grid">
            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Staged Action ID</span>
              <span className="undo-cell-val">
                <code>{proposal.actionId}</code>
              </span>
            </div>

            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Target Audit Ref</span>
              <span className="undo-cell-val">
                #{proposal.undoOfAuditId ?? 'Unknown'}
              </span>
            </div>

            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Action Status</span>
              <span className="undo-cell-val" style={{ textTransform: 'capitalize' }}>
                {proposal.statusLabel} ({proposal.status})
              </span>
            </div>

            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Base Plan Version</span>
              <span className="undo-cell-val">
                v{proposal.basePlanVersion ?? '—'}
              </span>
            </div>

            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Option Number</span>
              <span className="undo-cell-val undo-cell-val--option">
                {proposal.optionNumber !== null ? (
                  `Option #${proposal.optionNumber}`
                ) : (
                  <span style={{ color: 'var(--color-danger)' }}>Unresolved (Blocked)</span>
                )}
              </span>
            </div>

            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Proposal Expiry</span>
              <span className="undo-cell-val">
                {proposal.expiresAtFormatted}
              </span>
            </div>
          </div>

          {/* Impact Summary */}
          {proposal.impactSummary && (
            <div className="undo-proposal-cell">
              <span className="undo-cell-label">Expected Rollback Impact</span>
              <span className="undo-cell-val">
                {proposal.impactSummary}
              </span>
            </div>
          )}
        </div>

        {/* Footer with Explicit Approval Button */}
        <footer className="undo-modal__footer">
          <button
            type="button"
            className="undo-btn-cancel"
            onClick={onClose}
            disabled={isApproving}
          >
            Discard Proposal
          </button>

          <div className="undo-modal__footer-actions">
            <button
              type="button"
              className="undo-btn-approve"
              disabled={!canApprove}
              onClick={onApprove}
              title={
                !canApprove
                  ? !isLive
                    ? 'Approval disabled in demo mode'
                    : proposal.isExpired
                    ? 'Proposal has expired'
                    : !hasValidPositiveOptionNumber
                    ? 'Authoritative option number missing or unresolved'
                    : 'Proposal is not ready for approval'
                  : `Explicitly approve and execute undo option #${proposal.optionNumber}`
              }
              aria-label={
                canApprove
                  ? `Approve and apply undo option number ${proposal.optionNumber}`
                  : 'Approval disabled'
              }
            >
              <span aria-hidden="true">{isApproving ? '⏳' : '✓'}</span>
              <span>
                {isApproving
                  ? 'Applying Reversal...'
                  : proposal.optionNumber !== null
                  ? `Approve Option #${proposal.optionNumber}`
                  : 'Approve Undo (Blocked)'}
              </span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
