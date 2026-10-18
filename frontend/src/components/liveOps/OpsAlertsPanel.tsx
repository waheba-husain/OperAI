/* ============================================================
   src/components/liveOps/OpsAlertsPanel.tsx
   Operational alerts — compact severity-differentiated list.
   Clearly labeled as simulated. No fake "dismiss" or "resolve"
   buttons that imply backend integration.
   ============================================================ */

import type { OpsAlert, AlertSeverity } from '../../types/liveOperations'
import { NavIcon } from '../icons/NavIcon'
import './OpsAlertsPanel.css'

interface OpsAlertsPanelProps {
  readonly alerts: readonly OpsAlert[]
  readonly isLive?: boolean
}

const ICON_ALERT   = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01'
const ICON_INFO    = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-11v5m0-8h.01'

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critical',
  warning:  'Warning',
  info:     'Notice',
}

export function OpsAlertsPanel({ alerts, isLive = false }: OpsAlertsPanelProps) {
  const criticalCount = alerts.filter(a => a.severity === 'critical').length
  const warningCount  = alerts.filter(a => a.severity === 'warning').length

  return (
    <section className="ops-alerts-panel" aria-labelledby="ops-alerts-title">
      <header className="ops-alerts-panel__header">
        <div className="ops-alerts-panel__badge-row">
          <span className="ops-alerts-panel__badge">Operational Watch</span>
          <span className={`ops-alerts-panel__simulated ${isLive ? 'is-live' : ''}`}>
            {isLive ? 'Live Telemetry' : 'Simulated'}
          </span>
        </div>
        <div className="ops-alerts-panel__title-row">
          <h2 id="ops-alerts-title" className="ops-alerts-panel__title">
            Operational Alerts
          </h2>
          <div className="ops-alerts-panel__counts" aria-label="Alert counts">
            {criticalCount > 0 && (
              <span className="ops-alert-count-badge is-critical">
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="ops-alert-count-badge is-warning">
                {warningCount} warning
              </span>
            )}
          </div>
        </div>
        <p className="ops-alerts-panel__subtitle">
          {isLive
            ? 'Live shortages, pending recovery proposals, and solver schedule risks'
            : 'Simulated flags for orders at risk and station bottlenecks'}
        </p>
      </header>

      {alerts.length === 0 ? (
        <div className="ops-alerts-empty">
          <NavIcon path={ICON_INFO} size={16} />
          <span>{isLive ? 'No operational alerts — all metrics nominal' : 'No active alerts'}</span>
        </div>
      ) : (
        <div className="ops-alerts-list" role="list">
          {alerts.map(alert => {
            const isCritical = alert.severity === 'critical'
            const isInfo     = alert.severity === 'info'
            const icon       = isInfo ? ICON_INFO : ICON_ALERT

            return (
              <article
                key={alert.id}
                className={`ops-alert-item is-${alert.severity}`}
                role="listitem"
              >
                <div className="ops-alert-item__icon-col" aria-hidden="true">
                  <NavIcon path={icon} size={16} className={`ops-alert-icon is-${alert.severity}`} />
                </div>

                <div className="ops-alert-item__body">
                  <div className="ops-alert-item__header-row">
                    <span className={`ops-alert-severity-pill is-${alert.severity}`}>
                      {SEVERITY_LABEL[alert.severity]}
                    </span>
                    <span className="ops-alert-item__time">{alert.timeAgo}</span>
                  </div>

                  <h3 className="ops-alert-item__title">{alert.title}</h3>
                  <p className="ops-alert-item__detail">{alert.detail}</p>

                  <div className={`ops-alert-item__context ${isCritical ? 'is-critical' : ''}`}>
                    {alert.context}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <footer className="ops-alerts-panel__footer">
        <NavIcon path={ICON_INFO} size={13} className="ops-alerts-footer-icon" />
        <p className="ops-alerts-panel__disclaimer">
          {isLive
            ? 'Live alerts derived from inventory shortages, solver late orders, and pending recovery actions.'
            : 'Simulated flags based on demo prep plan state. In production, alerts derive from live stock levels, confirmed order timestamps, and solver plan version data.'}
        </p>
      </footer>
    </section>
  )
}
