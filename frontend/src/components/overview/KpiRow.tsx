/* ============================================================
   src/components/overview/KpiRow.tsx
   Four compact, visually differentiated KPI cards for the OperAI
   Overview dashboard.
   All values are simulated benchmarks labeled honestly per AGENTS.md.
   ============================================================ */

import type { KpiItem } from '../../types/overview'
import { NavIcon } from '../icons/NavIcon'
import './KpiRow.css'

interface KpiRowProps {
  kpis: readonly KpiItem[]
}

export function KpiRow({ kpis }: KpiRowProps) {
  return (
    <section className="kpi-grid" aria-label="Kitchen key performance metrics">
      {kpis.map(item => (
        <article
          key={item.id}
          className={`kpi-card kpi-card--${item.variant}`}
          aria-labelledby={`kpi-label-${item.id}`}
        >
          <div className="kpi-card__top">
            <span id={`kpi-label-${item.id}`} className="kpi-card__label">
              {item.label}
            </span>
            <div className="kpi-card__icon-wrap" aria-hidden="true">
              <NavIcon path={item.icon} size={16} />
            </div>
          </div>

          <div className="kpi-card__main">
            <div className="kpi-card__value-row">
              <span className="kpi-card__value">{item.value}</span>
              {item.trend && (
                <span className={`kpi-card__trend kpi-card__trend--${item.trend.direction}`}>
                  {item.trend.direction === 'up' && '↑ '}
                  {item.trend.direction === 'down' && '⚠ '}
                  {item.trend.text}
                </span>
              )}
            </div>

            <div className="kpi-card__footer">
              <span className="kpi-card__supporting">{item.supportingText}</span>
              <span className={`kpi-card__simulated-pill ${item.badgeText === 'Live' ? 'is-live' : ''}`}>
                {item.badgeText ?? 'Simulated'}
              </span>
            </div>
          </div>
        </article>
      ))}
    </section>
  )
}
