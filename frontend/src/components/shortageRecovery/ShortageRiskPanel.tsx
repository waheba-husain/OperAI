/* ============================================================
   frontend/src/components/shortageRecovery/ShortageRiskPanel.tsx
   OperAI / Cloud Kitchen Rescue — Shortage & Risk Presentation Panel

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.9 (GET /api/brief)
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels)
   ============================================================ */

import { useState } from 'react'
import type { AtRiskOrderViewModel, ShortageItemViewModel } from '../../types/shortageRecovery.ts'
import './ShortageRiskPanel.css'

export interface ShortageRiskPanelProps {
  readonly shortages: readonly ShortageItemViewModel[]
  readonly atRiskOrders: readonly AtRiskOrderViewModel[]
  readonly isProposing: boolean
  readonly selectedIngredientId: string | null
  readonly onSelectIngredient: (id: string) => void
  readonly onRequestProposal: (ingredientId: string, reportedQty?: number) => void
}

export function ShortageRiskPanel({
  shortages,
  atRiskOrders,
  isProposing,
  selectedIngredientId,
  onSelectIngredient,
  onRequestProposal
}: ShortageRiskPanelProps) {
  const [reportedQtyMap, setReportedQtyMap] = useState<Record<string, string>>({})

  const handleQtyChange = (ingredientId: string, val: string) => {
    setReportedQtyMap((prev) => ({ ...prev, [ingredientId]: val }))
  }

  const handleTrigger = (shortage: ShortageItemViewModel) => {
    onSelectIngredient(shortage.ingredientId)
    const rawVal = reportedQtyMap[shortage.ingredientId]
    let parsed: number | undefined = undefined
    if (rawVal !== undefined && rawVal.trim() !== '') {
      parsed = Number(rawVal.trim())
    }
    onRequestProposal(shortage.ingredientId, parsed)
  }

  return (
    <section className="shortage-risk-panel" aria-labelledby="shortages-heading">
      <div className="shortage-risk-panel__header">
        <div>
          <span className="shortage-risk-panel__kicker">INVENTORY DEFICIT RADAR</span>
          <h2 id="shortages-heading" className="shortage-risk-panel__title">
            Identified Ingredient Shortages & Risk Horizon
          </h2>
        </div>
        <span className="shortage-risk-panel__count-tag">
          {shortages.length} shortage{shortages.length === 1 ? '' : 's'} detected
        </span>
      </div>

      {shortages.length === 0 ? (
        <div className="shortage-empty-card" role="status">
          <div className="shortage-empty-icon" aria-hidden="true">✓</div>
          <h3 className="shortage-empty-title">Zero Inventory Deficits Detected</h3>
          <p className="shortage-empty-desc">
            Current stock quantities cover all scheduled dish preparation needs for this service date.
          </p>
        </div>
      ) : (
        <div className="shortage-list" role="list">
          {shortages.map((item) => {
            const isSelected = selectedIngredientId === item.ingredientId
            const isCurrentlyProposing = isProposing && isSelected
            const customQtyStr = reportedQtyMap[item.ingredientId] ?? ''

            return (
              <div
                key={item.ingredientId}
                role="listitem"
                className={`shortage-card ${isSelected ? 'shortage-card--selected' : ''}`}
              >
                <div className="shortage-card__top">
                  <div className="shortage-card__info">
                    <span className="shortage-card__badge-deficit">{item.formattedDeficit}</span>
                    <h3 className="shortage-card__name">{item.name}</h3>
                  </div>

                  {item.formattedRevenueAtRisk && (
                    <div className="shortage-card__financial">
                      <span className="shortage-card__financial-label">Exposure</span>
                      <span className="shortage-card__financial-val">
                        {item.formattedRevenueAtRisk}
                      </span>
                    </div>
                  )}
                </div>

                {/* Stock vs Needed figures */}
                <div className="shortage-card__metrics-grid">
                  <div className="shortage-metric-box">
                    <span className="shortage-metric-label">Current Stock:</span>
                    <span className="shortage-metric-val">{item.formattedStock}</span>
                  </div>
                  <div className="shortage-metric-box">
                    <span className="shortage-metric-label">Recipe Needed:</span>
                    <span className="shortage-metric-val">{item.formattedNeeded}</span>
                  </div>
                  <div className="shortage-metric-box">
                    <span className="shortage-metric-label">Deficit:</span>
                    <span className="shortage-metric-val">{item.formattedDeficit}</span>
                  </div>
                  {item.earliestDeadlineFormatted && (
                    <div className="shortage-metric-box">
                      <span className="shortage-metric-label">Earliest Deadline:</span>
                      <span className="shortage-metric-val">{item.earliestDeadlineFormatted}</span>
                    </div>
                  )}
                </div>

                {/* Reported Stock Input & Trigger */}
                <div className="shortage-card__actions">
                  <div className="shortage-qty-input-group">
                    <label
                      htmlFor={`reported-qty-${item.ingredientId}`}
                      className="shortage-qty-label"
                    >
                      Report Physical Stock ({item.unit}):
                    </label>
                    <input
                      id={`reported-qty-${item.ingredientId}`}
                      type="number"
                      step="any"
                      min="0"
                      className="shortage-qty-input"
                      placeholder={`Default: ${item.stockQty}`}
                      value={customQtyStr}
                      onChange={(e) => handleQtyChange(item.ingredientId, e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    className="shortage-propose-btn"
                    disabled={isProposing}
                    onClick={() => handleTrigger(item)}
                  >
                    {isCurrentlyProposing ? (
                      <>
                        <span className="shortage-spinner" aria-hidden="true" />
                        Simulating Recovery...
                      </>
                    ) : (
                      'Simulate Recovery Options'
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Affected Orders List */}
      {atRiskOrders.length > 0 && (
        <div className="at-risk-orders-section">
          <h3 className="at-risk-orders-title">
            Orders Impacted by Inventory Shortages ({atRiskOrders.length})
          </h3>
          <div className="at-risk-orders-grid">
            {atRiskOrders.map((order) => (
              <div key={order.orderId} className="at-risk-order-card">
                <div className="at-risk-order-card__header">
                  <span className="at-risk-order-ref">{order.orderRef}</span>
                  <span className="at-risk-order-amt">{order.totalAmountFormatted}</span>
                </div>
                <div className="at-risk-order-card__customer">{order.customerName}</div>
                <div className="at-risk-order-card__due">
                  Due by <strong>{order.deadlineFormatted}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
