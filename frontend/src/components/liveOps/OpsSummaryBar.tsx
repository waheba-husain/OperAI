/* ============================================================
   src/components/liveOps/OpsSummaryBar.tsx
   Compact operational summary — 4 differentiated metrics.
   Unlike the KPI cards this renders as a unified bar so it
   reads as a single instrument panel, not a card grid.
   ============================================================ */

import type { OpsMetric } from '../../types/liveOperations'
import { NavIcon } from '../icons/NavIcon'
import './OpsSummaryBar.css'

interface OpsSummaryBarProps {
  metrics: readonly OpsMetric[]
}

export function OpsSummaryBar({ metrics }: OpsSummaryBarProps) {
  return (
    <div className="ops-summary-bar" aria-label="Operational summary">
      {metrics.map((m, idx) => (
        <div
          key={m.id}
          className={`ops-metric ops-metric--${m.variant}`}
          role="status"
          aria-label={`${m.label}: ${m.value}`}
        >
          {/* Vertical rule between items except first */}
          {idx > 0 && <div className="ops-metric__divider" aria-hidden="true" />}

          <div className="ops-metric__icon-wrap" aria-hidden="true">
            <NavIcon path={m.iconPath} size={16} />
          </div>

          <div className="ops-metric__body">
            <span className="ops-metric__label">{m.label}</span>
            <div className="ops-metric__value-row">
              <strong className="ops-metric__value">
                {m.value}
                {m.unit && <span className="ops-metric__unit"> {m.unit}</span>}
              </strong>
            </div>
            <span className="ops-metric__sub">{m.subtext}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
