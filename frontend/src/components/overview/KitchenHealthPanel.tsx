/* ============================================================
   src/components/overview/KitchenHealthPanel.tsx
   Compact panel showing illustrative preparation progress,
   station capacity utilization, and operational health indicators.
   Uses progress indicators and status treatments.
   ============================================================ */

import type { StationHealth } from '../../types/overview'
import { NavIcon } from '../icons/NavIcon'
import './KitchenHealthPanel.css'

interface KitchenHealthPanelProps {
  stations: readonly StationHealth[]
  averageUtilization?: number | null
}

const ICON_ACTIVITY = 'M22 12h-4l-3 9L9 3l-3 9H2'

export function KitchenHealthPanel({ stations, averageUtilization }: KitchenHealthPanelProps) {
  const hasStations = stations.length > 0
  const isAvailable = hasStations && typeof averageUtilization === 'number' && !isNaN(averageUtilization)

  return (
    <section className="health-card" aria-labelledby="health-card-title">
      <header className="health-card__header">
        <div className="health-card__titles">
          <div className="health-card__badge-row">
            <span className="health-card__badge">Live Operations</span>
            <span className="health-card__simulated">Simulated</span>
          </div>
          <h2 id="health-card-title" className="health-card__title">
            Kitchen Health & Stations
          </h2>
        </div>

        <div className="health-card__status-indicator">
          <span className="health-status-dot" aria-hidden="true" />
          <span className="health-status-text">
            {hasStations ? 'Stations In Sync' : 'No Telemetry'}
          </span>
        </div>
      </header>

      {/* Main Station Utilization Gauge Row */}
      <div className="health-throughput-bar">
        <div className="health-throughput-info">
          <span className="health-throughput-label">Average Station Utilization</span>
          <strong className="health-throughput-val">
            {isAvailable ? `${averageUtilization}%` : 'Unavailable'}
          </strong>
        </div>
        <div
          className="health-progress-track"
          role="progressbar"
          aria-valuenow={isAvailable ? averageUtilization : 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Average station utilization"
        >
          <div
            className="health-progress-fill is-primary"
            style={{ width: `${isAvailable ? Math.min(100, Math.max(0, averageUtilization)) : 0}%` }}
          />
        </div>
        <span className="health-throughput-sub">
          {isAvailable
            ? 'Simulated station load indicator'
            : 'No station telemetry available'}
        </span>
      </div>

      {/* Station Capacity Utilization Bars */}
      <div className="health-stations-list" aria-label="Station capacity utilization">
        {hasStations ? (
          stations.map(station => {
            const isHigh = station.utilizationPct > 85
            const isMedium = station.utilizationPct >= 60 && station.utilizationPct <= 85
            const statusClass = isHigh ? 'is-high' : isMedium ? 'is-medium' : 'is-low'

            return (
              <div key={station.id} className="station-row">
                <div className="station-row__header">
                  <span className="station-row__name">{station.name}</span>
                  <div className="station-row__metrics">
                    <span className="station-row__cooks">
                      {station.activeCooks} cook{station.activeCooks > 1 ? 's' : ''}
                    </span>
                    <strong className={`station-row__pct ${statusClass}`}>
                      {station.utilizationPct}%
                    </strong>
                  </div>
                </div>

                <div
                  className="health-progress-track is-station"
                  role="progressbar"
                  aria-valuenow={station.utilizationPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${station.name} utilization`}
                >
                  <div
                    className={`health-progress-fill ${statusClass}`}
                    style={{ width: `${station.utilizationPct}%` }}
                  />
                </div>
              </div>
            )
          })
        ) : (
          <div className="health-stations-empty">
            No active stations to display (simulated data unavailable)
          </div>
        )}
      </div>

      {/* Demo notice — no verified compliance metrics are available */}
      <footer className="health-footer-pills">
        <div className="health-pill">
          <NavIcon path={ICON_ACTIVITY} size={13} className="health-pill__icon is-active" />
          <span>Demo snapshot — operational checks not yet connected</span>
        </div>
      </footer>
    </section>
  )
}
