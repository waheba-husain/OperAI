/* ============================================================
   frontend/src/components/schedulePlan/ScheduleSummaryRibbon.tsx
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Summary Ribbon

   HARD RULE (AGENTS.md Rule 1):
   All numbers come from code, never from LLM hallucination.
   Cook and burner counts represent distinct identifiers in the current plan.
   ============================================================ */

import type { SchedulePlanSummary } from '../../types/schedulePlan.ts'
import './ScheduleSummaryRibbon.css'

export interface ScheduleSummaryRibbonProps {
  readonly summary: SchedulePlanSummary
}

export function ScheduleSummaryRibbon({ summary }: ScheduleSummaryRibbonProps) {
  return (
    <div className="schedule-summary-ribbon" role="region" aria-label="Schedule summary metrics">
      <div className="schedule-summary-card">
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">Active Tasks</span>
          <span className="schedule-summary-card__tag">Queue</span>
        </div>
        <div className="schedule-summary-card__value">
          {summary.activeTasksCount}
          <span className="schedule-summary-card__value-sub">/ {summary.totalTasks}</span>
        </div>
        <div className="schedule-summary-card__subtext">
          {summary.cancelledCount > 0 ? `${summary.cancelledCount} cancelled excluded` : 'All tasks active'}
        </div>
      </div>

      <div className="schedule-summary-card schedule-summary-card--in-progress">
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">In Progress</span>
          <span className="schedule-summary-card__pulse-dot" />
        </div>
        <div className="schedule-summary-card__value">{summary.inProgressCount}</div>
        <div className="schedule-summary-card__subtext">Active on line right now</div>
      </div>

      <div className="schedule-summary-card">
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">Scheduled</span>
          <span className="schedule-summary-card__tag">Timeline</span>
        </div>
        <div className="schedule-summary-card__value">{summary.scheduledCount}</div>
        <div className="schedule-summary-card__subtext">Upcoming dispatch queue</div>
      </div>

      <div className="schedule-summary-card schedule-summary-card--done">
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">Completed</span>
          <span className="schedule-summary-card__tag">Done</span>
        </div>
        <div className="schedule-summary-card__value">{summary.doneCount}</div>
        <div className="schedule-summary-card__subtext">Plan task blocks finished</div>
      </div>

      <div className="schedule-summary-card schedule-summary-card--locked">
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">Locked Tasks</span>
          <span className="schedule-summary-card__icon" aria-hidden="true">🔒</span>
        </div>
        <div className="schedule-summary-card__value">{summary.lockedCount}</div>
        <div className="schedule-summary-card__subtext">Protected from replan moves</div>
      </div>

      <div className={`schedule-summary-card ${summary.lateOrderCount > 0 ? 'schedule-summary-card--late' : ''}`}>
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">Deadline Risk</span>
          {summary.lateOrderCount > 0 ? (
            <span className="schedule-summary-card__badge-warn">Attention</span>
          ) : (
            <span className="schedule-summary-card__tag">On Time</span>
          )}
        </div>
        <div className="schedule-summary-card__value">{summary.lateOrderCount}</div>
        <div className="schedule-summary-card__subtext">
          {summary.lateOrderCount > 0 ? 'Late orders in solver output' : 'Zero solver late flags'}
        </div>
      </div>

      <div className="schedule-summary-card">
        <div className="schedule-summary-card__header">
          <span className="schedule-summary-card__label">Assigned Resources</span>
          <span className="schedule-summary-card__tag">Resource IDs</span>
        </div>
        <div className="schedule-summary-card__value">
          {summary.activeCooksCount}c · {summary.activeBurnersCount}b
        </div>
        <div className="schedule-summary-card__subtext">
          {summary.activeCooksCount} cook IDs · {summary.activeBurnersCount} burner IDs in plan
        </div>
      </div>
    </div>
  )
}
