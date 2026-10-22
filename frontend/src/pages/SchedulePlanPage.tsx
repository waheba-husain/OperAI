/* ============================================================
   frontend/src/pages/SchedulePlanPage.tsx
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Control Page

   SOURCE OF TRUTH:
   - AGENTS.md (Rule 1: Numbers from code; Rule 10: Locked plan tasks never move)
   - docs/Rest_API_Spec.md §3.8 (GET /api/plan?date=YYYY-MM-DD)
   - docs/Rest_API_Spec.md §3.5 (GET /api/orders?date=YYYY-MM-DD)
   - frontend/docs/stage-2.4c-schedule-plan-integration.md

   LIFECYCLE & AUDIT RULES:
   1. Connects to documented GET /api/plan and GET /api/orders via useSchedulePlanData.
   2. Preserves all documented task statuses (scheduled, in_progress, done, cancelled).
   3. Preserves locked task states with explicit Rule 10 indicators.
   4. Disables unsupported mutations (no drag-and-drop, no arbitrary task reassignment).
   5. Explicit handling of Loading, Live, Empty, Error, and Demo states.
   ============================================================ */

import { useState, useMemo } from 'react'
import { useSchedulePlanData } from '../hooks/useSchedulePlanData.ts'
import { getTodayDateIST } from '../hooks/useOverviewData.ts'
import type { ScheduleFilterStatus, ScheduleTaskItem } from '../types/schedulePlan.ts'
import { ScheduleSummaryRibbon } from '../components/schedulePlan/ScheduleSummaryRibbon.tsx'
import { ScheduleFilterBar } from '../components/schedulePlan/ScheduleFilterBar.tsx'
import { ScheduleTaskCard } from '../components/schedulePlan/ScheduleTaskCard.tsx'
import { ScheduleEmptyState } from '../components/schedulePlan/ScheduleEmptyState.tsx'
import type { PageId } from '../types/navigation.ts'
import type { UseSchedulePlanDataOptions } from '../hooks/useSchedulePlanData.ts'
import './SchedulePlanPage.css'

export interface SchedulePlanPageProps {
  /** Provided by AppLayout so panels can navigate to related pages */
  readonly onNavigate?: (pageId: PageId) => void
  /** Optional data options for testing or custom client injection */
  readonly dataOptions?: UseSchedulePlanDataOptions
}

function shiftDate(dateStr: string, deltaDays: number): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number)
    if (!year || !month || !day) return dateStr
    const dt = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0))
    return dt.toISOString().slice(0, 10)
  } catch {
    return dateStr
  }
}

export function SchedulePlanPage({ dataOptions }: SchedulePlanPageProps) {
  const {
    mode,
    isLive,
    isLoading,
    error,
    isMissingConfig,
    isEmpty,
    isPlanNotFound,
    isGenerating,
    generateError,
    generateSuccessMessage,
    generateSchedule,
    targetDate,
    formattedDate,
    planVersion,
    summary,
    tasks,
    setTargetDate,
    refetch,
    setMode
  } = useSchedulePlanData(dataOptions)

  // Filter state
  const [activeFilter, setActiveFilter] = useState<ScheduleFilterStatus>('all-active')
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('all')
  const [cookFilter, setCookFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const todayStr = getTodayDateIST()
  const isToday = targetDate === todayStr

  // Compute available unique cooks
  const availableCooks = useMemo(() => {
    const cookNos = new Set<number>()
    tasks.forEach((t) => {
      if (t.status !== 'cancelled') {
        cookNos.add(t.cookNo)
      }
    })
    return Array.from(cookNos).sort((a, b) => a - b)
  }, [tasks])

  // Filter counts
  const counts = useMemo(() => {
    const allActive = tasks.filter((t) => t.status !== 'cancelled').length
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length
    const scheduled = tasks.filter((t) => t.status === 'scheduled').length
    const done = tasks.filter((t) => t.status === 'done').length
    const locked = tasks.filter((t) => t.isLocked).length
    const cancelled = tasks.filter((t) => t.status === 'cancelled').length

    return { allActive, inProgress, scheduled, done, locked, cancelled }
  }, [tasks])

  // Filtered task items
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. Status Filter
      if (activeFilter === 'all-active' && task.status === 'cancelled') {
        return false
      }
      if (activeFilter === 'in_progress' && task.status !== 'in_progress') {
        return false
      }
      if (activeFilter === 'scheduled' && task.status !== 'scheduled') {
        return false
      }
      if (activeFilter === 'done' && task.status !== 'done') {
        return false
      }
      if (activeFilter === 'locked' && !task.isLocked) {
        return false
      }
      if (activeFilter === 'cancelled' && task.status !== 'cancelled') {
        return false
      }

      // 2. Task Type Filter
      if (taskTypeFilter !== 'all' && task.taskType !== taskTypeFilter) {
        return false
      }

      // 3. Cook Filter
      if (cookFilter !== 'all' && String(task.cookNo) !== cookFilter) {
        return false
      }

      // 4. Search Query Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchDish = task.dish.toLowerCase().includes(query)
        const matchCustomer = task.customerName?.toLowerCase().includes(query) ?? false
        const matchOrder = task.orderId.toLowerCase().includes(query)
        const matchCook = `cook #${task.cookNo}`.toLowerCase().includes(query)
        const matchBurner = task.burnerNo !== null ? `burner #${task.burnerNo}`.toLowerCase().includes(query) : false
        const matchType = task.taskType.toLowerCase().includes(query)
        if (!matchDish && !matchCustomer && !matchOrder && !matchCook && !matchBurner && !matchType) {
          return false
        }
      }

      return true
    })
  }, [tasks, activeFilter, taskTypeFilter, cookFilter, searchQuery])

  return (
    <div className="schedule-plan-page">
      {/* ── 1. Page Header ───────────────────────────────────────── */}
      <header className="schedule-plan-header">
        <div className="schedule-plan-header__left">
          <div className="schedule-plan-header__kicker-row">
            <span className="schedule-plan-header__kicker">OPERATIONAL PLAN</span>
            <span className="schedule-plan-header__plan-badge">
              {planVersion !== '—' ? planVersion : 'No Active Plan'}
            </span>
          </div>

          <div className="schedule-plan-header__title-row">
            <svg
              className="schedule-plan-header__title-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="28"
              height="28"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <h1 className="schedule-plan-header__title">Schedule & Plan</h1>
          </div>

          <p className="schedule-plan-header__subtitle">
            Constraint-solver generated prep schedule with deadline-first task ordering and locked-task protection.
          </p>
        </div>

        {/* Right Header Controls */}
        <div className="schedule-plan-header__right">
          {/* Date Selector Controls */}
          <div className="schedule-date-nav" role="group" aria-label="Schedule date selector">
            <button
              type="button"
              className="schedule-date-btn"
              onClick={() => setTargetDate(shiftDate(targetDate, -1))}
              title="Previous day"
              aria-label="Previous day"
            >
              ‹
            </button>

            <div className="schedule-date-display">
              <input
                type="date"
                className="schedule-date-input"
                value={targetDate}
                onChange={(e) => {
                  if (e.target.value) setTargetDate(e.target.value)
                }}
                aria-label="Select schedule date"
              />
              <span className="schedule-date-label">{formattedDate}</span>
            </div>

            <button
              type="button"
              className="schedule-date-btn"
              onClick={() => setTargetDate(shiftDate(targetDate, 1))}
              title="Next day"
              aria-label="Next day"
            >
              ›
            </button>

            {!isToday && (
              <button
                type="button"
                className="schedule-today-btn"
                onClick={() => setTargetDate(todayStr)}
              >
                Today
              </button>
            )}
          </div>

          {/* Mode Pill and Actions */}
          <div className="schedule-mode-cluster">
            <div
              className={`schedule-mode-pill ${
                isLive
                  ? 'schedule-mode-pill--live'
                  : mode === 'live' && isLoading
                    ? 'schedule-mode-pill--sync'
                    : 'schedule-mode-pill--demo'
              }`}
              title={
                isLive
                  ? 'Connected to live Supabase backend'
                  : mode === 'live' && isLoading
                    ? 'Fetching live schedule from API'
                    : 'Running in simulated demonstration mode'
              }
            >
              <span className="schedule-mode-pill__dot" />
              <span>
                {isLive
                  ? 'Live API'
                  : mode === 'live' && isLoading
                    ? 'Syncing...'
                    : 'Demo Mode'}
              </span>
            </div>

            <button
              type="button"
              className="schedule-btn-toggle-mode"
              onClick={() => setMode(mode === 'live' ? 'demo' : 'live')}
            >
              {mode === 'live' ? 'Switch to Demo' : 'Connect to Live API'}
            </button>

            <button
              type="button"
              className="schedule-btn-refresh"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh schedule from backend"
              aria-label="Refresh schedule"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`schedule-refresh-icon ${isLoading ? 'schedule-refresh-icon--spin' : ''}`}
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── 2. System Policy & Configuration Notice ──────────────── */}
      {isMissingConfig && mode === 'demo' && (
        <div className="schedule-banner schedule-banner--info">
          <span className="schedule-banner__icon">ℹ</span>
          <div className="schedule-banner__content">
            <strong>Running in Demo Mode:</strong> <code>VITE_API_KEY</code> is unconfigured in <code>.env</code>.
            Displaying simulated constraint-solved prep schedule (<code>data_source = 'simulated'</code>).
          </div>
        </div>
      )}

      <div className="schedule-banner schedule-banner--policy">
        <span className="schedule-banner__icon">🔒</span>
        <div className="schedule-banner__content">
          <strong>OperAI Schedule Integrity Policy:</strong> Kitchen tasks are scheduled via the constraint solver with deadline-first sequencing.
          Replanning strictly obeys locked tasks (AGENTS.md Rule 10). Arbitrary drag-and-drop reassignment and manual edits are disabled to prevent invalid kitchen states.
        </div>
      </div>

      {/* ── 2B. Generation Status Banners ────────────────────────── */}
      {generateSuccessMessage && (
        <div className="schedule-banner schedule-banner--success" role="status">
          <span className="schedule-banner__icon">✓</span>
          <div className="schedule-banner__content">
            <strong>Schedule Published:</strong> {generateSuccessMessage}
          </div>
        </div>
      )}

      {generateError && (
        <div className="schedule-banner schedule-banner--error" role="alert">
          <span className="schedule-banner__icon">⚠</span>
          <div className="schedule-banner__content">
            <strong>Schedule Generation Notice:</strong> {generateError.message}
          </div>
        </div>
      )}

      {/* ── 3. Summary Ribbon ────────────────────────────────────── */}
      <ScheduleSummaryRibbon summary={summary} />

      {/* ── 4. Filter and Search Bar ─────────────────────────────── */}
      <ScheduleFilterBar
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        taskTypeFilter={taskTypeFilter}
        onTaskTypeFilterChange={setTaskTypeFilter}
        cookFilter={cookFilter}
        availableCooks={availableCooks}
        onCookFilterChange={setCookFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        counts={counts}
      />

      {/* ── 5. Main Content Area: Loading / Error / Empty / Tasks ── */}
      {isLoading ? (
        <div className="schedule-loading-skeleton" role="status" aria-label="Loading schedule">
          <div className="schedule-skeleton-card" />
          <div className="schedule-skeleton-card" />
          <div className="schedule-skeleton-card" />
          <div className="schedule-skeleton-card" />
        </div>
      ) : error ? (
        <div className="schedule-error-card" role="alert">
          <div className="schedule-error-card__header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="schedule-error-icon">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="schedule-error-title">Failed to load schedule from API</h3>
          </div>
          <p className="schedule-error-message">{error.message}</p>
          <div className="schedule-error-actions">
            <button
              type="button"
              className="schedule-btn schedule-btn--primary"
              onClick={() => refetch()}
            >
              Retry Request
            </button>
            <button
              type="button"
              className="schedule-btn schedule-btn--secondary"
              onClick={() => setMode('demo')}
            >
              Switch to Demo Mode
            </button>
          </div>
        </div>
      ) : isPlanNotFound || isEmpty ? (
        <ScheduleEmptyState
          isPlanNotFound={isPlanNotFound}
          targetDate={targetDate}
          formattedDate={formattedDate}
          onSelectToday={() => setTargetDate(todayStr)}
          onSwitchToDemo={mode === 'live' ? () => setMode('demo') : undefined}
          onGenerateSchedule={generateSchedule}
          isGenerating={isGenerating}
          isLive={isLive}
        />
      ) : filteredTasks.length === 0 ? (
        <div className="schedule-no-results">
          <p>No tasks match the selected filters or search query.</p>
          <button
            type="button"
            className="schedule-reset-btn"
            onClick={() => {
              setActiveFilter('all-active')
              setTaskTypeFilter('all')
              setCookFilter('all')
              setSearchQuery('')
            }}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="schedule-tasks-grid" role="list" aria-label="Scheduled kitchen preparation tasks">
          {filteredTasks.map((task: ScheduleTaskItem) => (
            <div key={task.id} role="listitem">
              <ScheduleTaskCard task={task} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
