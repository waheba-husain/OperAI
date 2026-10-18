/* ============================================================
   src/components/liveOps/PrepTimeline.tsx
   Preparation task timeline — vertical stepped list with
   distinct visual states for completed, in-progress, and upcoming.
   ============================================================ */

import type { LivePrepTask, LiveTaskStatus } from '../../types/liveOperations'
import { NavIcon } from '../icons/NavIcon'
import './PrepTimeline.css'

interface PrepTimelineProps {
  readonly tasks: readonly LivePrepTask[]
  readonly isLive?: boolean
  readonly planVersion?: string | number | null
}

const ICON_CHECK   = 'M20 6L9 17l-5-5'
const ICON_CLOCK   = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-14v6l4 2'
const ICON_CHEVRON = 'M9 18l6-6-6-6'

const STATUS_ORDER: LiveTaskStatus[] = ['in-progress', 'upcoming', 'completed']

function sortedTasks(tasks: readonly LivePrepTask[]) {
  return [...tasks].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  )
}

export function PrepTimeline({ tasks, isLive = false, planVersion = null }: PrepTimelineProps) {
  const sorted = sortedTasks(tasks)

  return (
    <section className="prep-tl-card" aria-labelledby="prep-tl-title">
      <header className="prep-tl-card__header">
        <div className="prep-tl-card__badge-row">
          <span className="prep-tl-card__badge">Prep Schedule</span>
          <span className={`prep-tl-card__simulated ${isLive ? 'is-live' : ''}`}>
            {isLive
              ? `Plan v${planVersion ?? '1.0'} · Live Solver`
              : 'Plan v1.4 · Simulated'}
          </span>
        </div>
        <h2 id="prep-tl-title" className="prep-tl-card__title">
          Preparation Timeline
        </h2>
        <p className="prep-tl-card__subtitle">
          {isLive
            ? 'Deadline-first task ordering · Scheduled tasks from live solver plan'
            : 'Deadline-first task ordering · Locked tasks not shown on this page'}
        </p>
      </header>

      {/* Timeline */}
      {sorted.length === 0 ? (
        <div className="prep-tl-empty">
          <NavIcon path={ICON_CLOCK} size={16} />
          <span>{isLive ? 'No prep tasks scheduled in active plan' : 'No prep tasks found'}</span>
        </div>
      ) : (
        <ol className="prep-tl-list" aria-label="Preparation task timeline">
          {sorted.map((task, idx) => {
            const isActive    = task.status === 'in-progress'
            const isCompleted = task.status === 'completed'
            const isLast      = idx === sorted.length - 1

            return (
              <li
                key={task.id}
                className={`prep-tl-item is-${task.status} is-priority-${task.priority}`}
              >
                {/* Vertical connector */}
                {!isLast && <div className="prep-tl-connector" aria-hidden="true" />}

                {/* Status node */}
                <div className="prep-tl-node" aria-hidden="true">
                  {isCompleted ? (
                    <div className="prep-tl-node__icon is-completed">
                      <NavIcon path={ICON_CHECK} size={11} />
                    </div>
                  ) : isActive ? (
                    <div className="prep-tl-node__icon is-active">
                      <span className="prep-tl-pulse" />
                    </div>
                  ) : (
                    <div className="prep-tl-node__icon is-upcoming">
                      <NavIcon path={ICON_CLOCK} size={11} />
                    </div>
                  )}
                </div>

                {/* Task card */}
                <div className="prep-tl-content">
                  <div className="prep-tl-content__header">
                    <div className="prep-tl-content__title-row">
                      <h3 className={`prep-tl-content__title ${isCompleted ? 'is-done' : ''}`}>
                        {task.title}
                      </h3>
                      <div className="prep-tl-content__badges">
                        {task.isLocked && (
                          <span className="prep-tl-badge is-locked" title="Locked task — cannot be moved by solver">
                            Locked
                          </span>
                        )}
                        <span className={`prep-tl-badge is-priority-${task.priority}`}>
                          {task.priority}
                        </span>
                        <span className={`prep-tl-badge is-status-${task.status}`}>
                          {task.status.replace('-', ' ')}
                        </span>
                      </div>
                    </div>

                    <div className="prep-tl-content__meta">
                      <span className="prep-tl-time">
                      <NavIcon path={ICON_CLOCK} size={11} />
                      {task.scheduledTime} · {task.durationMins}min
                    </span>
                    <NavIcon path={ICON_CHEVRON} size={11} className="prep-tl-sep" />
                    <span className="prep-tl-station">{task.station}</span>
                    <NavIcon path={ICON_CHEVRON} size={11} className="prep-tl-sep" />
                    <span className="prep-tl-cook">{task.assignedTo}</span>
                  </div>
                </div>

                {/* Progress bar for in-progress */}
                {isActive && typeof task.progressPct === 'number' && (
                  <div className="prep-tl-progress-wrap">
                    <div className="prep-tl-progress-track">
                      <div
                        className={`prep-tl-progress-fill is-priority-${task.priority}`}
                        style={{ width: `${task.progressPct}%` }}
                      />
                    </div>
                    <span className="prep-tl-pct">{task.progressPct}%</span>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    )}
  </section>
)
}
