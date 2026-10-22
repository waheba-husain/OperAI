/* ============================================================
   frontend/src/components/schedulePlan/ScheduleEmptyState.tsx
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Empty State
   ============================================================ */

import './ScheduleEmptyState.css'

export interface ScheduleEmptyStateProps {
  readonly isPlanNotFound: boolean
  readonly targetDate: string
  readonly formattedDate: string
  readonly onSelectToday: () => void
  readonly onSwitchToDemo?: () => void
  readonly onGenerateSchedule?: () => void
  readonly isGenerating?: boolean
  readonly isLive?: boolean
}

export function ScheduleEmptyState({
  isPlanNotFound,
  targetDate,
  formattedDate,
  onSelectToday,
  onSwitchToDemo,
  onGenerateSchedule,
  isGenerating,
  isLive
}: ScheduleEmptyStateProps) {
  return (
    <div className="schedule-empty-state" role="status" aria-live="polite">
      <div className="schedule-empty-state__icon-wrap">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="schedule-empty-state__icon"
          aria-hidden="true"
        >
          <path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          <path d="M12 14v4m0 0l-2-2m2 2l2-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h3 className="schedule-empty-state__title">
        {isPlanNotFound ? 'No Prep Plan for this Date' : 'No Tasks in Current Schedule'}
      </h3>

      <p className="schedule-empty-state__description">
        {isPlanNotFound
          ? `The constraint solver has not generated a prep schedule for ${formattedDate} (${targetDate}). Click below to solve and generate a schedule based on active orders.`
          : `A plan version was published for ${formattedDate}, but no active preparation tasks are scheduled.`}
      </p>

      <div className="schedule-empty-state__actions">
        {isPlanNotFound && isLive && onGenerateSchedule && (
          <button
            type="button"
            className="schedule-empty-btn schedule-empty-btn--generate"
            onClick={onGenerateSchedule}
            disabled={isGenerating}
            aria-busy={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="schedule-btn-spinner" aria-hidden="true" />
                <span>Generating Schedule...</span>
              </>
            ) : (
              <span>Generate Schedule</span>
            )}
          </button>
        )}

        <button
          type="button"
          className="schedule-empty-btn schedule-empty-btn--primary"
          onClick={onSelectToday}
        >
          Return to Today's Plan
        </button>

        {onSwitchToDemo && (
          <button
            type="button"
            className="schedule-empty-btn schedule-empty-btn--secondary"
            onClick={onSwitchToDemo}
          >
            Explore Simulated Demo Plan
          </button>
        )}
      </div>
    </div>
  )
}
