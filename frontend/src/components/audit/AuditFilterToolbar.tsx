/* ============================================================
   frontend/src/components/audit/AuditFilterToolbar.tsx
   OperAI / Cloud Kitchen Rescue — Audit Log Filter Toolbar
   ============================================================ */

import type { AuditEventTypeDTO } from '../../types/dto.ts'
import './AuditFilterToolbar.css'

export interface AuditFilterToolbarProps {
  readonly activeEventType?: AuditEventTypeDTO
  readonly onSelectEventType: (eventType?: AuditEventTypeDTO) => void
  readonly includeSnapshots: boolean
  readonly onToggleIncludeSnapshots: (include: boolean) => void
  readonly onRefresh: () => void
  readonly isLoading: boolean
  readonly totalShown: number
}

interface FilterOption {
  readonly id?: AuditEventTypeDTO
  readonly label: string
}

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: undefined, label: 'All Events' },
  { id: 'action_executed', label: 'Action Executed' },
  { id: 'action_rejected', label: 'Action Declined' },
  { id: 'undo_executed', label: 'Undo Reversal' },
  { id: 'order_created', label: 'Order Intake' },
  { id: 'stock_updated', label: 'Stock Adjusted' }
]

export function AuditFilterToolbar({
  activeEventType,
  onSelectEventType,
  includeSnapshots,
  onToggleIncludeSnapshots,
  onRefresh,
  isLoading,
  totalShown
}: AuditFilterToolbarProps) {
  return (
    <div className="audit-filter-toolbar" role="toolbar" aria-label="Audit log filters and controls">
      {/* Event Type Filter Pills */}
      <div className="audit-filter-pills" role="radiogroup" aria-label="Filter by event type">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = activeEventType === opt.id
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`audit-filter-pill ${isActive ? 'audit-filter-pill--active' : ''}`}
              onClick={() => onSelectEventType(opt.id)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Snapshot Toggle & Refresh Action */}
      <div className="audit-filter-actions">
        <label className="audit-snapshot-toggle" title="Include before and after snapshot payloads in audit records">
          <input
            type="checkbox"
            checked={includeSnapshots}
            onChange={(e) => onToggleIncludeSnapshots(e.target.checked)}
          />
          <span>Include Snapshots</span>
        </label>

        <button
          type="button"
          className="audit-refresh-btn"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={isLoading ? 'Refreshing audit log...' : 'Refresh audit log'}
        >
          <span className={isLoading ? 'audit-spin' : ''} aria-hidden="true">
            🔄
          </span>
          <span>{isLoading ? 'Syncing...' : 'Refresh'}</span>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
            ({totalShown})
          </span>
        </button>
      </div>
    </div>
  )
}
