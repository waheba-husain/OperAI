/* ============================================================
   frontend/src/components/shortageRecovery/ApprovalResultModal.tsx
   OperAI / Cloud Kitchen Rescue — Post-Approval Results & Messages Modal

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve response)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM never approves; Rule 3: Atomic approval)
   ============================================================ */

import type { ApprovalResultViewModel } from '../../types/shortageRecovery.ts'
import './ApprovalResultModal.css'

export interface ApprovalResultModalProps {
  readonly result: ApprovalResultViewModel | null
  readonly postApprovalRefreshError?: string | null
  readonly onClose: () => void
}

export function ApprovalResultModal({
  result,
  postApprovalRefreshError = null,
  onClose
}: ApprovalResultModalProps) {
  if (!result) return null

  const {
    actionId,
    status,
    executedAtFormatted,
    planVersionBefore,
    planVersionAfter,
    auditId,
    changes,
    customerMessages,
    expiredActionIds
  } = result

  return (
    <div
      className="approval-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
    >
      <div className="approval-modal">
        {/* Header */}
        <header className="approval-modal__header">
          <div className="approval-modal__title-group">
            <span className="approval-modal__kicker">ATOMIC APPROVAL EXECUTED</span>
            <h2 id="approval-modal-title" className="approval-modal__title">
              Plan Modification Applied
            </h2>
          </div>
          <button
            type="button"
            className="approval-modal__close-btn"
            onClick={onClose}
            aria-label="Close approval results dialog"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <div className="approval-modal__body">
          {/* Background Refresh Notice if Subsequent GET Failed */}
          {postApprovalRefreshError && (
            <div className="approval-refresh-notice" role="alert">
              <span aria-hidden="true">⚠️</span>
              <div>
                <strong>Background Sync Notice:</strong>
                <p style={{ margin: '2px 0 0' }}>{postApprovalRefreshError}</p>
              </div>
            </div>
          )}

          {/* Core Plan Version & Audit Metrics Grid */}
          <div className="approval-metrics-grid">
            <div className="approval-metric-card">
              <span className="approval-metric-label">Action Status</span>
              <span className="approval-metric-val" style={{ color: '#047857', textTransform: 'capitalize' }}>
                {status}
              </span>
            </div>

            <div className="approval-metric-card">
              <span className="approval-metric-label">Plan Version</span>
              <span className="approval-metric-val approval-metric-val--version">
                v{planVersionBefore} → v{planVersionAfter}
              </span>
            </div>

            <div className="approval-metric-card">
              <span className="approval-metric-label">Rescheduled Tasks</span>
              <span className="approval-metric-val">
                {changes.tasksRescheduled} task(s)
              </span>
            </div>

            <div className="approval-metric-card">
              <span className="approval-metric-label">Audit Log Ref</span>
              <span className="approval-metric-val">
                #{auditId}
              </span>
            </div>
          </div>

          {/* Summary Box */}
          <div className="approval-summary-card">
            <span className="approval-summary-heading">Operational Change Summary</span>
            <p className="approval-summary-text">{changes.summary}</p>
          </div>

          {/* Affected Orders List (only fields present) */}
          {changes.ordersAffected && changes.ordersAffected.length > 0 && (
            <div className="approval-detail-row">
              <span className="approval-detail-label">Affected Order IDs:</span>
              {changes.ordersAffected.map((orderId) => (
                <span key={orderId} className="approval-order-tag">
                  {orderId}
                </span>
              ))}
            </div>
          )}

          {/* Expired Sibling Actions */}
          {expiredActionIds && expiredActionIds.length > 0 && (
            <div className="approval-detail-row">
              <span className="approval-detail-label">Invalidated Sibling Proposals:</span>
              {expiredActionIds.map((siblingId) => (
                <span key={siblingId} className="approval-order-tag" style={{ textDecoration: 'line-through' }}>
                  {siblingId}
                </span>
              ))}
            </div>
          )}

          {/* Customer Notifications Drafts (Rest_API_Spec.md §3.12) */}
          {customerMessages && customerMessages.length > 0 && (
            <section className="approval-messages-section" aria-label="Customer message drafts">
              <div className="approval-messages-header">
                <h3 className="approval-messages-title">
                  Customer Notification Drafts ({customerMessages.length})
                </h3>
                <p className="approval-messages-desc">
                  Pre-filled customer communications generated by the engine. Must be reviewed and sent manually.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {customerMessages.map((msg) => (
                  <article key={msg.orderId} className="customer-draft-card">
                    <div className="customer-draft-header">
                      <span className="customer-draft-recipient">
                        Order #{msg.orderId} — {msg.customerName}
                      </span>
                      {msg.needsConsent && (
                        <span className="customer-draft-consent-pill">
                          Consent Required
                        </span>
                      )}
                    </div>

                    {/* Prominent Consent Warning per Spec */}
                    {msg.needsConsent && (
                      <div className="customer-draft-consent-warning" role="alert">
                        <span aria-hidden="true">⚠️</span>
                        <span>
                          <strong>Diner Consent Required:</strong> This recovery recipe alters order contents. Dispatch is conditional on customer agreement.
                        </span>
                      </div>
                    )}

                    <div className="customer-draft-bubble">
                      "{msg.message}"
                    </div>

                    <div className="customer-draft-actions">
                      <a
                        href={msg.whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="customer-draft-whatsapp-btn"
                        aria-label={`Open WhatsApp message draft for ${msg.customerName}`}
                      >
                        <span aria-hidden="true">💬</span>
                        Open WhatsApp Draft ↗
                      </a>
                      <span className="customer-draft-manual-note">
                        Manual send required. OperAI never sends automated messages.
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className="approval-modal__footer">
          <span className="approval-modal__footer-note">
            Action <code>{actionId}</code> executed at {executedAtFormatted}.
          </span>
          <button
            type="button"
            className="approval-modal__done-btn"
            onClick={onClose}
          >
            Acknowledge & Continue
          </button>
        </footer>
      </div>
    </div>
  )
}
