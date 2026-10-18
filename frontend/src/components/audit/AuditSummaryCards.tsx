/* ============================================================
   frontend/src/components/audit/AuditSummaryCards.tsx
   OperAI / Cloud Kitchen Rescue — Audit Log Summary Metrics Grid
   ============================================================ */

import type { AuditLogSummary } from '../../types/audit.ts'
import './AuditSummaryCards.css'

export interface AuditSummaryCardsProps {
  readonly summary: AuditLogSummary
  readonly isLoading?: boolean
  readonly isFiltered?: boolean
  readonly activeFilterLabel?: string
}

export function AuditSummaryCards({
  summary,
  isLoading = false,
  isFiltered = false,
  activeFilterLabel
}: AuditSummaryCardsProps) {
  return (
    <section className="audit-summary-grid" aria-label="Audit summary metrics">
      {/* Total Events */}
      <div className="audit-summary-card">
        <div className="audit-summary-card__header">
          <span className="audit-summary-card__kicker">
            {isFiltered ? 'Overall Events' : 'Recent Events'}
          </span>
          <span className="audit-summary-card__icon" aria-hidden="true">📋</span>
        </div>
        <span className="audit-summary-card__val">
          {isLoading ? '—' : summary.totalEntries}
        </span>
        <span className="audit-summary-card__desc">
          {isFiltered && activeFilterLabel
            ? `Recent operational entries (${activeFilterLabel} active)`
            : 'Recent operational audit entries'}
        </span>
      </div>

      {/* Executed Actions */}
      <div className="audit-summary-card">
        <div className="audit-summary-card__header">
          <span className="audit-summary-card__kicker">Actions Executed</span>
          <span className="audit-summary-card__icon" aria-hidden="true">✅</span>
        </div>
        <span className="audit-summary-card__val audit-summary-card__val--success">
          {isLoading ? '—' : summary.actionExecutedCount}
        </span>
        <span className="audit-summary-card__desc">Approved kitchen plan mutations</span>
      </div>

      {/* Declined Actions */}
      <div className="audit-summary-card">
        <div className="audit-summary-card__header">
          <span className="audit-summary-card__kicker">Actions Declined</span>
          <span className="audit-summary-card__icon" aria-hidden="true">✕</span>
        </div>
        <span className="audit-summary-card__val audit-summary-card__val--danger">
          {isLoading ? '—' : summary.actionRejectedCount}
        </span>
        <span className="audit-summary-card__desc">Declined proposals (no plan change)</span>
      </div>

      {/* Undo Reversals */}
      <div className="audit-summary-card">
        <div className="audit-summary-card__header">
          <span className="audit-summary-card__kicker">Undos Applied</span>
          <span className="audit-summary-card__icon" aria-hidden="true">↺</span>
        </div>
        <span className="audit-summary-card__val audit-summary-card__val--warning">
          {isLoading ? '—' : summary.undoExecutedCount}
        </span>
        <span className="audit-summary-card__desc">Past changes reversed via snapshot</span>
      </div>

      {/* Stock Updates */}
      <div className="audit-summary-card">
        <div className="audit-summary-card__header">
          <span className="audit-summary-card__kicker">Stock Updates</span>
          <span className="audit-summary-card__icon" aria-hidden="true">📦</span>
        </div>
        <span className="audit-summary-card__val audit-summary-card__val--info">
          {isLoading ? '—' : summary.stockUpdatedCount}
        </span>
        <span className="audit-summary-card__desc">Intake & physical inventory updates</span>
      </div>
    </section>
  )
}
