/* ============================================================
   src/components/overview/PrepTasksTimeline.tsx
   Timeline & task list with task names, times, priorities, and statuses.
   Provides distinct visual treatments for completed, active, upcoming,
   and locked plan tasks (per AGENTS.md rule 10).
   ============================================================ */

import { useState } from 'react'
import type { PrepTaskItem, TaskStatus } from '../../types/overview'
import type { PageId } from '../../types/navigation'
import { NavIcon } from '../icons/NavIcon'
import './PrepTasksTimeline.css'

interface PrepTasksTimelineProps {
  tasks: readonly PrepTaskItem[]
  onNavigate?: (pageId: PageId) => void
  isLive?: boolean
}

const ICON_CHECK = 'M20 6L9 17l-5-5'
const ICON_LOCK = 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zm-7-7a4 4 0 0 0-4 4v3h8V8a4 4 0 0 0-4-4z'
const ICON_CLOCK = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-14v6l4 2'
const ICON_ARROW = 'M9 5l7 7-7 7'

export function PrepTasksTimeline({ tasks, onNavigate, isLive = false }: PrepTasksTimelineProps) {
  const [filter, setFilter] = useState<'all' | TaskStatus>('all')

  const filteredTasks = filter === 'all'
    ? tasks
    : tasks.filter(t => t.status === filter)

  // Derive counts from data rather than hardcoding them
  const activeCount   = tasks.filter(t => t.status === 'in-progress').length
  const lockedCount   = tasks.filter(t => t.status === 'locked').length

  return (
    <section className="prep-timeline-card" aria-labelledby="prep-timeline-title">
      <header className="prep-timeline-card__header">
        <div className="prep-timeline-card__titles">
          <div className="prep-timeline-card__badge-row">
            <span className="prep-timeline-card__badge">Prep Schedule</span>
            <span className={`prep-timeline-card__simulated ${isLive ? 'is-live' : ''}`}>
              {isLive ? 'Live Solver Plan' : 'Simulated'}
            </span>
          </div>
          <h2 id="prep-timeline-title" className="prep-timeline-card__title">
            Upcoming Prep Pipeline
          </h2>
          <p className="prep-timeline-card__subtitle">
            Constraint-solved task sequence ordered deadline-first
          </p>
        </div>

        {/* Filter Pills */}
        <div className="prep-timeline-filters" role="tablist" aria-label="Task status filters">
          <button
            type="button"
            className={`prep-filter-btn ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({tasks.length})
          </button>
          <button
            type="button"
            className={`prep-filter-btn ${filter === 'in-progress' ? 'is-active' : ''}`}
            onClick={() => setFilter('in-progress')}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            className={`prep-filter-btn ${filter === 'locked' ? 'is-active' : ''}`}
            onClick={() => setFilter('locked')}
          >
            Locked ({lockedCount})
          </button>
        </div>
      </header>

      {/* Timeline Task List */}
      <div className="prep-timeline-list" role="list">
        {filteredTasks.length === 0 ? (
          <div className="prep-timeline-empty" role="status">
            <p className="prep-timeline-empty__text">
              {tasks.length === 0
                ? 'No prep tasks scheduled for today’s active plan.'
                : 'No prep tasks match the selected filter.'}
            </p>
          </div>
        ) : (
          filteredTasks.map(task => {
          const isCompleted = task.status === 'completed'
          const isInProgress = task.status === 'in-progress'
          const isLocked = task.status === 'locked'

          return (
            <article
              key={task.id}
              className={`prep-task-row is-status-${task.status}`}
              role="listitem"
            >
              {/* Status Indicator Icon */}
              <div className="prep-task-indicator" aria-hidden="true">
                {isCompleted && (
                  <div className="prep-status-icon is-completed">
                    <NavIcon path={ICON_CHECK} size={13} />
                  </div>
                )}
                {isInProgress && (
                  <div className="prep-status-icon is-in-progress">
                    <span className="prep-pulse-dot" />
                  </div>
                )}
                {isLocked && (
                  <div className="prep-status-icon is-locked">
                    <NavIcon path={ICON_LOCK} size={12} />
                  </div>
                )}
                {!isCompleted && !isInProgress && !isLocked && (
                  <div className="prep-status-icon is-upcoming">
                    <NavIcon path={ICON_CLOCK} size={12} />
                  </div>
                )}
              </div>

              {/* Task Details */}
              <div className="prep-task-body">
                <div className="prep-task-primary">
                  <div className="prep-task-header-row">
                    <h3 className={`prep-task-title ${isCompleted ? 'is-completed' : ''}`}>
                      {task.title}
                    </h3>
                    <div className="prep-task-badges">
                      {isLocked && (
                        <span className="prep-badge is-locked">
                          <NavIcon path={ICON_LOCK} size={10} />
                          Locked
                        </span>
                      )}
                      <span className={`prep-badge is-priority-${task.priority}`}>
                        {task.priority}
                      </span>
                      <span className={`prep-badge is-status-${task.status}`}>
                        {task.status.replace('-', ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="prep-task-meta">
                    <span className="prep-task-time">
                      <NavIcon path={ICON_CLOCK} size={12} />
                      {task.timeWindow}
                    </span>
                    <span className="prep-task-station">{task.station}</span>
                  </div>
                </div>

                {/* Progress bar for in-progress task */}
                {isInProgress && typeof task.progressPct === 'number' && (
                  <div className="prep-task-progress-wrap">
                    <div className="prep-task-progress-bar">
                      <div
                        className="prep-task-progress-fill"
                        style={{ width: `${task.progressPct}%` }}
                      />
                    </div>
                    <span className="prep-task-pct">{task.progressPct}% complete</span>
                  </div>
                )}
              </div>
            </article>
          )
        }))}
      </div>

      {onNavigate && (
        <footer className="prep-timeline-card__footer">
          <button
            type="button"
            className="prep-view-full-plan-btn"
            onClick={() => onNavigate('schedule-plan')}
          >
            <span>Open Complete Schedule & Solver Plan</span>
            <NavIcon path={ICON_ARROW} size={14} />
          </button>
        </footer>
      )}
    </section>
  )
}
