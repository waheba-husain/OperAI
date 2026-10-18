/* ============================================================
   frontend/src/components/schedulePlan/ScheduleTaskCard.tsx
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Task Card

   RULES & CONSTRAINTS:
   - Preserves documented task statuses (scheduled, in_progress, done, cancelled).
   - Preserves locked state (Rule 10: locked tasks never move during replanning).
   - No unlock control or edit input (mutations are not supported by the backend).
   - cook_no and burner_no are identifiers, not physical room telemetry.
   ============================================================ */

import type { ScheduleTaskItem } from '../../types/schedulePlan.ts'
import './ScheduleTaskCard.css'

export interface ScheduleTaskCardProps {
  readonly task: ScheduleTaskItem
}

export function ScheduleTaskCard({ task }: ScheduleTaskCardProps) {
  const getStatusBadge = () => {
    switch (task.status) {
      case 'in_progress':
        return (
          <span className="schedule-status-badge schedule-status-badge--in-progress">
            <span className="schedule-status-badge__dot" />
            In Progress
          </span>
        )
      case 'scheduled':
        return (
          <span className="schedule-status-badge schedule-status-badge--scheduled">
            Scheduled
          </span>
        )
      case 'done':
        return (
          <span className="schedule-status-badge schedule-status-badge--done">
            <svg viewBox="0 0 16 16" fill="currentColor" className="schedule-status-badge__check" aria-hidden="true">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
            Done
          </span>
        )
      case 'cancelled':
        return (
          <span className="schedule-status-badge schedule-status-badge--cancelled">
            Cancelled
          </span>
        )
    }
  }

  const getTypeBadgeClass = () => {
    switch (task.taskType) {
      case 'cook':
        return 'schedule-type-badge--cook'
      case 'prep':
        return 'schedule-type-badge--prep'
      case 'pack':
        return 'schedule-type-badge--pack'
    }
  }

  return (
    <article
      className={`schedule-task-card schedule-task-card--${task.status} ${task.isLocked ? 'schedule-task-card--locked' : ''} ${task.isLateOrder ? 'schedule-task-card--late' : ''}`}
      aria-label={`Task: ${task.dish}, status: ${task.status}`}
    >
      {/* Top Meta Row */}
      <div className="schedule-task-card__meta-row">
        <div className="schedule-task-card__badges">
          {getStatusBadge()}
          <span className={`schedule-type-badge ${getTypeBadgeClass()}`}>
            {task.taskType.toUpperCase()}
          </span>
          {task.isLocked && (
            <span
              className="schedule-locked-pill"
              title="Locked plan task: Hard Rule 10 ensures locked tasks never move during replan"
            >
              🔒 Locked
            </span>
          )}
          {task.isLateOrder && (
            <span className="schedule-late-pill" title="Solver identified this order at deadline risk">
              ⚠️ Late Risk
            </span>
          )}
        </div>

        <div className="schedule-task-card__time-badge">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="schedule-task-card__clock-icon" aria-hidden="true">
            <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
            <path d="M8 5v3.5l2.5 1" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="schedule-task-card__time-text">{task.timeWindow}</span>
          <span className="schedule-task-card__duration-tag">({task.durationMins}m)</span>
        </div>
      </div>

      {/* Main Task Body */}
      <div className="schedule-task-card__body">
        <h3 className="schedule-task-card__title">{task.dish}</h3>

        <div className="schedule-task-card__assignments">
          <div className="schedule-assignment-item">
            <span className="schedule-assignment-label">Assigned Cook:</span>
            <span className="schedule-assignment-val">{task.assignedCookLabel}</span>
          </div>

          <div className="schedule-assignment-item">
            <span className="schedule-assignment-label">Assigned Burner:</span>
            <span
              className={`schedule-assignment-val ${
                task.burnerNo !== null
                  ? 'schedule-assignment-val--burner'
                  : 'schedule-assignment-val--none'
              }`}
            >
              {task.burnerNo !== null ? `Burner #${task.burnerNo}` : 'None (off-burner)'}
            </span>
          </div>
        </div>
      </div>

      {/* Order Context Details (if present) */}
      {(task.customerName || task.channel || task.orderDeadline) && (
        <div className="schedule-task-card__order-context">
          <div className="schedule-order-header">
            <span className="schedule-order-ref">#ORD-{task.orderId.slice(0, 4).toUpperCase()}</span>
            {task.channel && <span className="schedule-order-channel">{task.channel}</span>}
          </div>
          <div className="schedule-order-details">
            {task.customerName && <span className="schedule-order-customer">{task.customerName}</span>}
            {task.orderDeadline && (
              <span className="schedule-order-due">
                Due by <strong>{task.orderDeadline}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer / Mutation Policy Note */}
      <div className="schedule-task-card__footer">
        <span className="schedule-task-card__policy-text">
          {task.isLocked
            ? '🔒 Locked task · Immovable by replanning'
            : task.status === 'cancelled'
              ? 'Cancelled task · Excluded from active service'
              : 'Solver scheduled · Drag/edit disabled'}
        </span>
      </div>
    </article>
  )
}
