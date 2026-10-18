/* ============================================================
   frontend/src/components/audit/AuditTimelineList.tsx
   OperAI / Cloud Kitchen Rescue — Audit Log Timeline Component

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.14 (GET /api/audit)
   - docs/Rest_API_Spec.md §3.15 (POST /api/audit/{id}/undo)
   - AGENTS.md (Rules 2, 4, 5, 6)
   ============================================================ */

import type { AuditLogViewModel } from '../../types/audit.ts'
import './AuditTimelineList.css'

export interface AuditTimelineListProps {
  readonly logs: readonly AuditLogViewModel[]
  readonly selectedLogId: string | null
  readonly onSelectLog: (id: string | null) => void
  readonly onRequestUndo: (auditId: string) => void
  readonly isProposingUndo: boolean
  readonly proposingAuditId?: string | null
  readonly isLive: boolean
  readonly isLoading: boolean
  readonly onResetFilter?: () => void
}

export function AuditTimelineList({
  logs,
  selectedLogId,
  onSelectLog,
  onRequestUndo,
  isProposingUndo,
  proposingAuditId,
  isLive,
  isLoading,
  onResetFilter
}: AuditTimelineListProps) {
  if (isLoading && logs.length === 0) {
    return (
      <div className="audit-timeline-loading" role="status" aria-live="polite">
        <div className="audit-skeleton-card" />
        <div className="audit-skeleton-card" />
        <div className="audit-skeleton-card" />
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="audit-empty-state" role="status" aria-live="polite">
        <span className="audit-empty-icon" aria-hidden="true">📜</span>
        <h3 className="audit-empty-title">No Audit Records Found</h3>
        <p className="audit-empty-desc">
          No operational events match the current filter criteria or limit settings.
        </p>
        {onResetFilter && (
          <button
            type="button"
            className="audit-empty-btn"
            onClick={onResetFilter}
          >
            Show All Events
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="audit-timeline" role="feed" aria-label="Audit log events list">
      {logs.map((log) => {
        const isSelected = selectedLogId === log.id
        const isThisProposing = isProposingUndo && proposingAuditId === log.id

        return (
          <article
            key={log.id}
            className={`audit-timeline-card ${isSelected ? 'audit-timeline-card--selected' : ''}`}
            aria-labelledby={`audit-card-title-${log.id}`}
          >
            {/* Top row: Badges, tags, timestamp */}
            <div className="audit-timeline-card__top">
              <div className="audit-timeline-card__tags">
                {/* Event Type Badge */}
                <span className={`audit-badge audit-badge--${log.eventPresentation.badgeVariant}`}>
                  <span aria-hidden="true">●</span>
                  {log.eventPresentation.label}
                </span>

                {/* Plan Version Transition Tag */}
                {log.planVersionTransition.hasTransition && (
                  <span
                    className="audit-tag-version"
                    title={`Plan bumped from version ${log.planVersionTransition.before} to ${log.planVersionTransition.after}`}
                  >
                    {log.planVersionTransition.display}
                  </span>
                )}

                {/* Undoable Eligibility Tag */}
                {log.undoable && (
                  <span
                    className="audit-tag-undoable"
                    title="This state modification can be proposed for rollback via its snapshot"
                  >
                    ↺ Undo Eligible
                  </span>
                )}

                {/* Snapshots Tag */}
                {log.snapshotComparison.hasSnapshots && (
                  <span
                    className="audit-tag-snapshots"
                    title="Before and after state snapshots available for inspection"
                  >
                    📸 Snapshots ({log.snapshotComparison.changedKeysCount} change{log.snapshotComparison.changedKeysCount === 1 ? '' : 's'})
                  </span>
                )}
              </div>

              {/* Timestamp */}
              <time
                dateTime={log.createdAt}
                className="audit-timeline-card__time"
                title={`Recorded at ${log.createdAtFormatted} (IST)`}
              >
                <span>{log.createdAtFormatted}</span>
                <span aria-hidden="true">•</span>
                <span>{log.createdAtTimeAgo}</span>
              </time>
            </div>

            {/* Event Summary */}
            <p id={`audit-card-title-${log.id}`} className="audit-timeline-card__summary">
              {log.summary}
            </p>

            {/* Footer row: Actor, Action ID, and Buttons */}
            <footer className="audit-timeline-card__footer">
              <div className="audit-timeline-card__meta">
                <span className="audit-timeline-card__actor">
                  <span aria-hidden="true">👤</span>
                  <span>{log.actorPresentation.label}</span>
                </span>

                {log.hasAction && log.actionId && (
                  <span title="Action identifier that initiated this mutation">
                    Action: <code>{log.actionId}</code>
                  </span>
                )}

                <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
                  Ref: #{log.id}
                </span>
              </div>

              <div className="audit-timeline-card__actions">
                <button
                  type="button"
                  className="audit-btn-inspect"
                  onClick={() => onSelectLog(isSelected ? null : log.id)}
                  aria-expanded={isSelected}
                  aria-label={`Inspect audit record ${log.id}`}
                >
                  {isSelected ? 'Close Details' : 'Inspect Details'}
                </button>

                {/* Undo proposal action button: requires explicit user initiation */}
                {log.undoable && (
                  <button
                    type="button"
                    className="audit-btn-undo"
                    disabled={isProposingUndo || !isLive}
                    onClick={() => onRequestUndo(log.id)}
                    title={
                      !isLive
                        ? 'Undo proposals are disabled in simulated demo mode'
                        : isProposingUndo
                        ? 'Preparing undo proposal...'
                        : 'Stage an approval-gated reversal proposal for this action'
                    }
                    aria-label={`Propose undo for action in audit record ${log.id}`}
                  >
                    <span aria-hidden="true">{isThisProposing ? '⏳' : '↺'}</span>
                    <span>{isThisProposing ? 'Staging...' : 'Propose Undo'}</span>
                  </button>
                )}
              </div>
            </footer>
          </article>
        )
      })}
    </div>
  )
}
