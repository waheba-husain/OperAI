/* ============================================================
   frontend/src/components/menuPricing/MenuTable.tsx
   OperAI / Cloud Kitchen Rescue — Menu Catalog & Economics Table
   ============================================================ */

import type { MenuItemViewModel } from '../../types/menuPricing.ts'
import './MenuTable.css'

export interface MenuTableProps {
  readonly items: readonly MenuItemViewModel[]
  readonly onSelectDish: (id: string) => void
  readonly onOpenAnalysis: (id: string) => void
  readonly selectedDishId: string | null
  readonly onResetFilters?: () => void
  readonly isFiltered?: boolean
  readonly isLoading?: boolean
}

function getMarginBadgeClass(status: string): string {
  switch (status) {
    case 'healthy':
      return 'menu-badge--success'
    case 'below_target':
      return 'menu-badge--warning'
    case 'loss':
      return 'menu-badge--danger'
    default:
      return 'menu-badge--neutral'
  }
}

export function MenuTable({
  items,
  onSelectDish,
  onOpenAnalysis,
  selectedDishId,
  onResetFilters,
  isFiltered = false,
  isLoading = false
}: MenuTableProps) {
  if (isLoading && items.length === 0) {
    return (
      <div className="menu-loading-state" role="status" aria-live="polite">
        <div className="menu-spinner" aria-hidden="true" />
        <p className="menu-loading-text">Loading kitchen menu catalog...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="menu-empty-state" role="region" aria-label="No menu dishes found">
        <div className="menu-empty-icon" aria-hidden="true">
          🍽️
        </div>
        <h3 className="menu-empty-title">No menu dishes found</h3>
        <p className="menu-empty-desc">
          {isFiltered
            ? 'No dishes match your active search or margin filter. Try clearing filters.'
            : 'There are currently no items in the kitchen menu catalog.'}
        </p>
        {isFiltered && onResetFilters && (
          <button
            type="button"
            className="menu-empty-reset-btn"
            onClick={onResetFilters}
          >
            Reset Filters
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="menu-table-container">
      {/* ── Desktop Table ────────────────────────────────────── */}
      <div className="menu-table-wrapper">
        <table className="menu-table" aria-label="Kitchen Menu Catalog & Unit Economics">
          <thead>
            <tr>
              <th scope="col" className="col-dish">Dish / ID</th>
              <th scope="col" className="col-price text-right">Selling Price</th>
              <th scope="col" className="col-breakdown">Cost Breakdown</th>
              <th scope="col" className="col-total-cost text-right">Total Cost</th>
              <th scope="col" className="col-profit text-right">Net Profit</th>
              <th scope="col" className="col-margin text-center">Margin %</th>
              <th scope="col" className="col-status">Status</th>
              <th scope="col" className="col-actions text-center">Simulation</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isSelected = selectedDishId === item.id
              const isLoss = item.marginStatus === 'loss'
              const isBelowTarget = item.marginStatus === 'below_target'

              return (
                <tr
                  key={item.id}
                  className={`menu-table-row ${isSelected ? 'menu-table-row--selected' : ''} ${
                    isLoss ? 'menu-table-row--loss' : isBelowTarget ? 'menu-table-row--warning' : ''
                  }`}
                  onClick={() => onSelectDish(item.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectDish(item.id)
                    }
                  }}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`Menu item ${item.name}`}
                >
                  {/* Dish Name & Canonical ID */}
                  <td className="col-dish">
                    <span className="menu-dish-name">{item.name}</span>
                    <span className="menu-dish-id" title={item.id}>
                      {item.id}
                    </span>
                  </td>

                  {/* Selling Price */}
                  <td className="col-price text-right">
                    <span className="menu-price-text">{item.formattedPrice}</span>
                  </td>

                  {/* Cost Breakdown */}
                  <td className="col-breakdown">
                    {item.hasFinancialAnalysis && item.costBreakdown ? (
                      <div className="menu-breakdown-chips">
                        <span className="menu-cost-chip" title="Raw ingredient cost">
                          Ing: {item.costBreakdown.formattedIngredients}
                        </span>
                        <span className="menu-cost-chip" title="Packaging container cost">
                          Pack: {item.costBreakdown.formattedPackaging}
                        </span>
                        <span className="menu-cost-chip" title="Platform commission (20%)">
                          Comm: {item.costBreakdown.formattedCommission}
                        </span>
                        <span className="menu-cost-chip" title="Allocated kitchen overhead (12%)">
                          Overhead: {item.costBreakdown.formattedOverhead}
                        </span>
                      </div>
                    ) : (
                      <span className="menu-cost-unavailable" title="Live financial breakdown not returned by catalog">
                        Analysis Pending
                      </span>
                    )}
                  </td>

                  {/* Total Unit Cost */}
                  <td className="col-total-cost text-right">
                    <span className="menu-total-cost-text">
                      {item.costBreakdown ? item.costBreakdown.formattedTotal : '—'}
                    </span>
                  </td>

                  {/* Net Profit */}
                  <td className="col-profit text-right">
                    <span
                      className={`menu-profit-text ${
                        (item.profitPerOrder ?? 0) < 0 ? 'menu-profit-text--negative' : ''
                      }`}
                    >
                      {item.formattedProfitPerOrder}
                    </span>
                  </td>

                  {/* Margin % */}
                  <td className="col-margin text-center">
                    <span
                      className={`menu-margin-text ${
                        item.marginPct === null
                          ? 'menu-margin-text--unknown'
                          : item.marginPct < 0
                          ? 'menu-margin-text--negative'
                          : item.marginPct < 25
                          ? 'menu-margin-text--warning'
                          : 'menu-margin-text--healthy'
                      }`}
                    >
                      {item.formattedMarginPct}
                    </span>
                  </td>

                  {/* Margin Health Status */}
                  <td className="col-status">
                    <span className={`menu-status-pill ${getMarginBadgeClass(item.marginStatus)}`}>
                      {item.marginStatusLabel}
                    </span>
                  </td>

                  {/* Action / Analyze Button */}
                  <td className="col-actions text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="menu-action-btn"
                      onClick={() => onOpenAnalysis(item.id)}
                      aria-label={`Analyze pricing for ${item.name}`}
                    >
                      Analyze What-If →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile Cards List ─────────────────────────────────── */}
      <div className="menu-mobile-list" role="list">
        {items.map((item) => {
          const isSelected = selectedDishId === item.id
          const isLoss = item.marginStatus === 'loss'

          return (
            <div
              key={item.id}
              className={`menu-mobile-card ${isSelected ? 'menu-mobile-card--selected' : ''} ${
                isLoss ? 'menu-mobile-card--loss' : ''
              }`}
              onClick={() => onSelectDish(item.id)}
              role="listitem"
            >
              <div className="menu-mobile-card__header">
                <div>
                  <span className="menu-dish-name">{item.name}</span>
                  <span className="menu-dish-id">{item.id}</span>
                </div>
                <span className={`menu-status-pill ${getMarginBadgeClass(item.marginStatus)}`}>
                  {item.marginStatusLabel}
                </span>
              </div>

              <div className="menu-mobile-card__metrics">
                <div className="menu-mobile-metric">
                  <span className="menu-mobile-metric-label">Price</span>
                  <span className="menu-mobile-metric-val">{item.formattedPrice}</span>
                </div>
                <div className="menu-mobile-metric">
                  <span className="menu-mobile-metric-label">Total Cost</span>
                  <span className="menu-mobile-metric-val">
                    {item.costBreakdown ? item.costBreakdown.formattedTotal : '—'}
                  </span>
                </div>
                <div className="menu-mobile-metric">
                  <span className="menu-mobile-metric-label">Profit</span>
                  <span
                    className={`menu-mobile-metric-val ${
                      (item.profitPerOrder ?? 0) < 0 ? 'menu-profit-text--negative' : ''
                    }`}
                  >
                    {item.formattedProfitPerOrder}
                  </span>
                </div>
                <div className="menu-mobile-metric">
                  <span className="menu-mobile-metric-label">Margin</span>
                  <span
                    className={`menu-mobile-metric-val ${
                      item.marginPct === null
                        ? 'menu-margin-text--unknown'
                        : item.marginPct < 25
                        ? 'menu-margin-text--warning'
                        : 'menu-margin-text--healthy'
                    }`}
                  >
                    {item.formattedMarginPct}
                  </span>
                </div>
              </div>

              <div className="menu-mobile-card__footer">
                {item.hasFinancialAnalysis && item.costBreakdown ? (
                  <div className="menu-mobile-breakdown-subtext">
                    Ing: {item.costBreakdown.formattedIngredients} · Pack: {item.costBreakdown.formattedPackaging} · Comm: {item.costBreakdown.formattedCommission} · Ovhd: {item.costBreakdown.formattedOverhead}
                  </div>
                ) : (
                  <div className="menu-mobile-breakdown-subtext menu-cost-unavailable">
                    Live financial analysis pending server-side calculation
                  </div>
                )}
                <button
                  type="button"
                  className="menu-action-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenAnalysis(item.id)
                  }}
                >
                  Analyze What-If →
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
