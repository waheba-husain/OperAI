/* ============================================================
   frontend/src/components/schedulePlan/ScheduleFilterBar.tsx
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Filter Bar
   ============================================================ */

import type { ScheduleFilterStatus } from '../../types/schedulePlan.ts'
import './ScheduleFilterBar.css'

export interface ScheduleFilterCounts {
  readonly allActive: number
  readonly inProgress: number
  readonly scheduled: number
  readonly done: number
  readonly locked: number
  readonly cancelled: number
}

export interface ScheduleFilterBarProps {
  readonly activeFilter: ScheduleFilterStatus
  readonly onFilterChange: (filter: ScheduleFilterStatus) => void
  readonly taskTypeFilter: string
  readonly onTaskTypeFilterChange: (type: string) => void
  readonly cookFilter: string
  readonly availableCooks: readonly number[]
  readonly onCookFilterChange: (cook: string) => void
  readonly searchQuery: string
  readonly onSearchQueryChange: (query: string) => void
  readonly counts: ScheduleFilterCounts
}

export function ScheduleFilterBar({
  activeFilter,
  onFilterChange,
  taskTypeFilter,
  onTaskTypeFilterChange,
  cookFilter,
  availableCooks,
  onCookFilterChange,
  searchQuery,
  onSearchQueryChange,
  counts
}: ScheduleFilterBarProps) {
  const tabs: Array<{ id: ScheduleFilterStatus; label: string; count: number }> = [
    { id: 'all-active', label: 'All Active', count: counts.allActive },
    { id: 'in_progress', label: 'In Progress', count: counts.inProgress },
    { id: 'scheduled', label: 'Scheduled', count: counts.scheduled },
    { id: 'done', label: 'Completed', count: counts.done },
    { id: 'locked', label: 'Locked', count: counts.locked },
    { id: 'cancelled', label: 'Cancelled', count: counts.cancelled }
  ]

  return (
    <div className="schedule-filter-bar">
      <div className="schedule-filter-bar__top">
        {/* Status Tabs */}
        <div className="schedule-filter-tabs" role="tablist" aria-label="Filter schedule tasks by status">
          {tabs.map((tab) => {
            const isActive = activeFilter === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={isActive}
                className={`schedule-filter-tab ${isActive ? 'schedule-filter-tab--active' : ''}`}
                onClick={() => onFilterChange(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="schedule-filter-tab__count">{tab.count}</span>
              </button>
            )
          })}
        </div>

        {/* Search Input */}
        <div className="schedule-search-box">
          <svg
            className="schedule-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="schedule-search-input"
            placeholder="Search dish, order, customer..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            aria-label="Search schedule tasks"
          />
          {searchQuery && (
            <button
              type="button"
              className="schedule-search-clear"
              onClick={() => onSearchQueryChange('')}
              aria-label="Clear search query"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Secondary filter selectors */}
      <div className="schedule-filter-bar__bottom">
        <div className="schedule-filter-select-group">
          <label htmlFor="task-type-select" className="schedule-filter-select-label">
            Task Type:
          </label>
          <select
            id="task-type-select"
            className="schedule-filter-select"
            value={taskTypeFilter}
            onChange={(e) => onTaskTypeFilterChange(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="cook">Cook</option>
            <option value="prep">Prep</option>
            <option value="pack">Pack</option>
          </select>
        </div>

        <div className="schedule-filter-select-group">
          <label htmlFor="cook-select" className="schedule-filter-select-label">
            Assigned Cook:
          </label>
          <select
            id="cook-select"
            className="schedule-filter-select"
            value={cookFilter}
            onChange={(e) => onCookFilterChange(e.target.value)}
          >
            <option value="all">All Cooks</option>
            {availableCooks.map((cookNo) => (
              <option key={cookNo} value={String(cookNo)}>
                Cook #{cookNo}
              </option>
            ))}
          </select>
        </div>

        {(taskTypeFilter !== 'all' || cookFilter !== 'all' || searchQuery !== '') && (
          <button
            type="button"
            className="schedule-filter-reset-btn"
            onClick={() => {
              onTaskTypeFilterChange('all')
              onCookFilterChange('all')
              onSearchQueryChange('')
            }}
          >
            Reset Filters
          </button>
        )}
      </div>
    </div>
  )
}
