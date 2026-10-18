/* ============================================================
   frontend/src/components/audit/AuditDetailModal.tsx
   OperAI / Cloud Kitchen Rescue — Audit Record Detail & Snapshot Diff Modal

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.14 (GET /api/audit snapshots)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - AGENTS.md (Rules 2, 4, 5, 6)
   ============================================================ */

import { useEffect, useCallback } from 'react'
import type { AuditLogViewModel } from '../../types/audit.ts'
import './AuditDetailModal.css'

export interface AuditDetailModalProps {
  readonly log: AuditLogViewModel | null
  readonly includeSnapshots: boolean
  readonly onEnableSnapshots?: () => void
  readonly onClose: () => void
  readonly onRequestUndo: (auditId: string) => void
  readonly isProposingUndo: boolean
  readonly isLive: boolean
}

export function AuditDetailModal({
  log,
  includeSnapshots,
  onEnableSnapshots,
  onClose,
  onRequestUndo,
  isProposingUndo,
  isLive
}: AuditDetailModalProps) {
  // Handle Escape key to close dialog
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (!log) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [log, handleKeyDown])

  if (!log) return null

  const { snapshotComparison } = log

  return (
    <div
      className="audit-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="audit-modal">
        {/* Header */}
        <header className="audit-modal__header">
          <div className="audit-modal__title-group">
            <span className="audit-modal__kicker">OPERATIONAL AUDIT RECORD #{log.id}</span>
            <h2 id="audit-detail-title" className="audit-modal__title">
              {log.eventPresentation.label}
            </h2>
          </div>
          <button
            type="button"
            className="audit-modal__close-btn"
            onClick={onClose}
            aria-label="Close audit detail dialog"
          >
            ✕
          </button>
        </header>

        {/* Body */}
        <div className="audit-modal__body">
          {/* Summary Box */}
          <div className="audit-detail-summary">
            <strong>Event Summary: </strong>
            <span>{log.summary}</span>
          </div>

          {/* Metadata Grid */}
          <div className="audit-info-grid">
            {/* Event Type */}
            <div className="audit-info-cell">
              <span className="audit-info-label">Event Type</span>
              <span className="audit-info-value">
                <span className={`audit-badge audit-badge--${log.eventPresentation.badgeVariant}`}>
                  {log.eventPresentation.label}
                </span>
              </span>
            </div>

            {/* Actor */}
            <div className="audit-info-cell">
              <span className="audit-info-label">Actor</span>
              <span className="audit-info-value">
                👤 {log.actorPresentation.label} ({log.actor})
              </span>
            </div>

            {/* Timestamp */}
            <div className="audit-info-cell">
              <span className="audit-info-label">Recorded At (IST)</span>
              <span className="audit-info-value">
                {log.createdAtFormatted}
              </span>
            </div>

            {/* Plan Version Transition */}
            <div className="audit-info-cell">
              <span className="audit-info-label">Plan Version Transition</span>
              <span className="audit-info-value">
                {log.planVersionTransition.hasTransition ? (
                  <span className="audit-tag-version">
                    {log.planVersionTransition.display}
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-text-secondary)' }}>None (No plan bump)</span>
                )}
              </span>
            </div>

            {/* Associated Action ID */}
            <div className="audit-info-cell">
              <span className="audit-info-label">Associated Action</span>
              <span className="audit-info-value">
                {log.hasAction && log.actionId ? (
                  <code>{log.actionId}</code>
                ) : (
                  <span style={{ color: 'var(--color-text-secondary)' }}>None</span>
                )}
              </span>
            </div>

            {/* Undo Eligibility */}
            <div className="audit-info-cell">
              <span className="audit-info-label">Undo Status</span>
              <span className="audit-info-value">
                {log.undoable ? (
                  <span className="audit-tag-undoable">
                    ↺ Eligible for Rollback
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-text-secondary)' }}>Not Undoable</span>
                )}
              </span>
            </div>
          </div>

          {/* Snapshots & Diff Section */}
          <section className="audit-snapshots-section" aria-label="Before and after state snapshots">
            <div className="audit-snapshots-header">
              <h3 className="audit-snapshots-title">
                State Snapshot Comparison
              </h3>
              {snapshotComparison.hasSnapshots && (
                <span className="audit-snapshots-badge">
                  {snapshotComparison.changedKeysCount} Modified Property{snapshotComparison.changedKeysCount === 1 ? '' : 'ies'}
                </span>
              )}
            </div>

            {snapshotComparison.hasSnapshots ? (
              <>
                {/* Structured Diff Table */}
                <div className="audit-diff-table-container">
                  <table className="audit-diff-table">
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: '22%' }}>Field Key</th>
                        <th scope="col" style={{ width: '14%' }}>Change</th>
                        <th scope="col" style={{ width: '32%' }}>Before Snapshot</th>
                        <th scope="col" style={{ width: '32%' }}>After Snapshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshotComparison.diffs.map((diff) => (
                        <tr key={diff.key}>
                          <td>
                            <strong><code>{diff.key}</code></strong>
                          </td>
                          <td>
                            <span className={`audit-diff-tag audit-diff-tag--${diff.changeType}`}>
                              {diff.changeType}
                            </span>
                          </td>
                          <td>
                            {diff.beforeValue !== null ? (
                              <span className="audit-diff-val">{diff.beforeValue}</span>
                            ) : (
                              <span className="audit-diff-val--empty">—</span>
                            )}
                          </td>
                          <td>
                            {diff.afterValue !== null ? (
                              <span className="audit-diff-val">{diff.afterValue}</span>
                            ) : (
                              <span className="audit-diff-val--empty">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Technical Operators Raw JSON Payloads */}
                <details className="audit-raw-json-details">
                  <summary className="audit-raw-json-summary">
                    View Raw JSON Payloads (Before / After)
                  </summary>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                    <div>
                      <span className="audit-info-label">before_snapshot:</span>
                      <pre className="audit-raw-json-pre">
                        {snapshotComparison.rawBefore ? JSON.stringify(snapshotComparison.rawBefore, null, 2) : 'null'}
                      </pre>
                    </div>
                    <div>
                      <span className="audit-info-label">after_snapshot:</span>
                      <pre className="audit-raw-json-pre">
                        {snapshotComparison.rawAfter ? JSON.stringify(snapshotComparison.rawAfter, null, 2) : 'null'}
                      </pre>
                    </div>
                  </div>
                </details>
              </>
            ) : (
              <div className="audit-no-snapshots">
                {!includeSnapshots ? (
                  <div>
                    <p style={{ margin: '0 0 var(--space-2)' }}>
                      Snapshot payloads were excluded from this query to optimize network payload size.
                    </p>
                    {onEnableSnapshots && (
                      <button
                        type="button"
                        className="audit-modal-btn-close"
                        style={{ background: 'var(--color-primary)', color: 'var(--color-text-on-primary)', borderColor: 'var(--color-primary)' }}
                        onClick={onEnableSnapshots}
                      >
                        Fetch Records with Snapshots
                      </button>
                    )}
                  </div>
                ) : (
                  <p style={{ margin: 0 }}>
                    No state snapshot was captured for this event type.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="audit-modal__footer">
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
            Append-only record Ref #{log.id}
          </span>

          <div className="audit-modal__footer-actions">
            <button
              type="button"
              className="audit-modal-btn-close"
              onClick={onClose}
            >
              Close
            </button>

            {log.undoable && (
              <button
                type="button"
                className="audit-btn-undo"
                disabled={isProposingUndo || !isLive}
                onClick={() => {
                  onRequestUndo(log.id)
                }}
                title={
                  !isLive
                    ? 'Undo proposals are disabled in simulated demo mode'
                    : isProposingUndo
                    ? 'Preparing undo proposal...'
                    : 'Stage an approval-gated reversal proposal for this action'
                }
              >
                <span aria-hidden="true">{isProposingUndo ? '⏳' : '↺'}</span>
                <span>{isProposingUndo ? 'Staging...' : 'Propose Undo Rollback'}</span>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
