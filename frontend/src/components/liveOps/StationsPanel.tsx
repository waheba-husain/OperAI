/* ============================================================
   src/components/liveOps/StationsPanel.tsx
   Compact kitchen stations workload overview.
   Horizontal bar treatment — not a card grid.
   ============================================================ */

import type { LiveStation, StationStatus } from '../../types/liveOperations'
import './StationsPanel.css'

interface StationsPanelProps {
  stations: readonly LiveStation[]
}

const STATUS_LABEL: Record<StationStatus, string> = {
  busy:   'High Load',
  normal: 'Nominal',
  light:  'Light',
  idle:   'Idle',
}

export function StationsPanel({ stations }: StationsPanelProps) {
  return (
    <section className="stations-panel" aria-labelledby="stations-panel-title">
      <header className="stations-panel__header">
        <div className="stations-panel__badge-row">
          <span className="stations-panel__badge">Station Monitor</span>
          <span className="stations-panel__simulated">Simulated</span>
        </div>
        <h2 id="stations-panel-title" className="stations-panel__title">
          Kitchen Stations
        </h2>
      </header>

      <div className="stations-panel__list" role="list">
        {stations.map(stn => {
          const isHigh   = stn.status === 'busy'
          const isLight  = stn.status === 'light' || stn.status === 'idle'
          const fillClass = isHigh ? 'is-high' : isLight ? 'is-light' : 'is-normal'

          return (
            <div
              key={stn.id}
              className={`stn-row is-${stn.status}`}
              role="listitem"
            >
              {/* Station identity column */}
              <div className="stn-row__identity">
                <div className="stn-row__name-row">
                  <span className="stn-row__name">{stn.name}</span>
                  <span className={`stn-status-pill is-${stn.status}`}>
                    {STATUS_LABEL[stn.status]}
                  </span>
                </div>
                <p className="stn-row__current-task">{stn.currentTask}</p>
              </div>

              {/* Metrics + bar column */}
              <div className="stn-row__metrics">
                <div className="stn-row__stats">
                  <span className="stn-stat">
                    <strong>{stn.activeTasks}</strong>
                    <span>/{stn.totalSlots} tasks</span>
                  </span>
                  <span className="stn-stat">
                    <strong>{stn.assignedCooks}</strong>
                    <span> cook{stn.assignedCooks > 1 ? 's' : ''}</span>
                  </span>
                  <strong className={`stn-pct ${fillClass}`}>{stn.capacityPct}%</strong>
                </div>

                <div
                  className="stn-progress-track"
                  role="progressbar"
                  aria-valuenow={stn.capacityPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${stn.name} capacity`}
                >
                  <div
                    className={`stn-progress-fill ${fillClass}`}
                    style={{ width: `${stn.capacityPct}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
