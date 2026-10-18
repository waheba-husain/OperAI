/* ============================================================
   src/components/overview/IngredientAlertsPanel.tsx
   Illustrative ingredient alerts with differentiated urgency.
   Uses amber and terracotta accents for warnings and shortages.
   Clearly identified as demo data.
   ============================================================ */

import type { IngredientAlert } from '../../types/overview'
import type { PageId } from '../../types/navigation'
import { NavIcon } from '../icons/NavIcon'
import './IngredientAlertsPanel.css'

interface IngredientAlertsPanelProps {
  alerts: readonly IngredientAlert[]
  onNavigate?: (pageId: PageId) => void
  isLive?: boolean
}

const ICON_ALERT = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
const ICON_ARROW = 'M9 5l7 7-7 7'

export function IngredientAlertsPanel({ alerts, onNavigate, isLive = false }: IngredientAlertsPanelProps) {
  return (
    <section className="alerts-card" aria-labelledby="alerts-card-title">
      <header className="alerts-card__header">
        <div className="alerts-card__titles">
          <div className="alerts-card__badge-row">
            <span className="alerts-card__badge">Inventory Watch</span>
            <span className={`alerts-card__simulated ${isLive ? 'is-live' : ''}`}>
              {isLive ? 'Live Stock' : 'Simulated Stock'}
            </span>
          </div>
          <h2 id="alerts-card-title" className="alerts-card__title">
            Ingredient Shortages & Alerts
          </h2>
          <p className="alerts-card__subtitle">
            Predicted deficits based on today’s active prep plan and prep recipes
          </p>
        </div>

        {onNavigate && (
          <button
            type="button"
            className="alerts-resolve-all-btn"
            onClick={() => onNavigate('shortage-recovery')}
            aria-label="Navigate to Shortage and Recovery to review options"
          >
            <span>Resolve Shortages</span>
            <NavIcon path={ICON_ARROW} size={14} />
          </button>
        )}
      </header>

      {/* Alert list */}
      <div className="alerts-list" role="list">
        {alerts.length === 0 ? (
          <div className="alerts-empty" role="status">
            <p className="alerts-empty__text">No ingredient shortages detected for scheduled orders.</p>
          </div>
        ) : (
          alerts.map(item => {
            const isCritical = item.urgency === 'critical'
            const isWarning = item.urgency === 'warning'
            const urgencyClass = isCritical ? 'is-critical' : isWarning ? 'is-warning' : 'is-info'

            return (
              <article
                key={item.id}
                className={`alert-item ${urgencyClass}`}
                role="listitem"
              >
                <div className="alert-item__side-strip" aria-hidden="true" />

                <div className="alert-item__content">
                  <div className="alert-item__main-row">
                    <div className="alert-item__info">
                      <div className="alert-item__header-line">
                        <h3 className="alert-item__name">{item.name}</h3>
                        <span className="alert-item__category">{item.category}</span>
                      </div>

                      <div className="alert-item__stock-metrics">
                        <span className="stock-metric">
                          Current: <strong>{item.currentStock}</strong>
                        </span>
                        <span className="stock-divider" aria-hidden="true">/</span>
                        <span className="stock-metric">
                          Required: <strong>{item.requiredStock}</strong>
                        </span>
                        <span className={`stock-deficit-pill ${urgencyClass}`}>
                          {item.deficit}
                        </span>
                      </div>
                    </div>

                    <div className="alert-item__status-wrap">
                      <span className={`alert-urgency-badge ${urgencyClass}`}>
                        <NavIcon path={ICON_ALERT} size={12} />
                        <span>{isCritical ? 'Critical Deficit' : isWarning ? 'Low Stock' : 'Reorder Notice'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="alert-item__meta-row">
                    <span className="alert-timing-note">
                      {item.impactTime}
                    </span>
                    <span className="alert-impact-dishes">
                      Affects {item.affectedDishesCount} planned recipe{item.affectedDishesCount > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>

      <footer className="alerts-card__footer">
        <p className="alerts-card__disclaimer">
          {isLive ? (
            <>
              <strong>Live Telemetry:</strong> Stock levels and projected deficits evaluated against active recipes via /api/brief.
            </>
          ) : (
            <>
              <strong>Demo Notice:</strong> Simulated inventory levels. In production, shortages trigger automated Bedrock recipe substitutions verified by the kitchen owner before execution.
            </>
          )}
        </p>
      </footer>
    </section>
  )
}
