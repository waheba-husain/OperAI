/* ============================================================
   frontend/src/components/orders/OrdersSummaryCards.tsx
   OperAI / Cloud Kitchen Rescue — Orders Summary Metrics Grid
   ============================================================ */

import type { OrdersSummaryMetrics } from '../../types/orders.ts'
import './OrdersSummaryCards.css'

export interface OrdersSummaryCardsProps {
  readonly summary: OrdersSummaryMetrics
  readonly isLoading?: boolean
  readonly isFiltered?: boolean
  readonly activeFilterCount?: number
}

export function OrdersSummaryCards({
  summary,
  isLoading = false,
  isFiltered = false,
  activeFilterCount
}: OrdersSummaryCardsProps) {
  return (
    <section className="orders-summary-grid" aria-label="Orders summary metrics">
      {/* 1. Total Orders */}
      <div className="orders-summary-card">
        <div className="orders-summary-card__header">
          <span className="orders-summary-card__kicker">
            {isFiltered ? 'Filtered Orders' : 'Total Orders'}
          </span>
          <span className="orders-summary-card__icon" aria-hidden="true">📋</span>
        </div>
        <span className="orders-summary-card__val">
          {isLoading ? '—' : isFiltered && activeFilterCount !== undefined ? activeFilterCount : summary.totalOrders}
        </span>
        <span className="orders-summary-card__desc">
          {isFiltered
            ? `Showing matching orders (${summary.totalOrders} total in pipeline)`
            : 'Total orders in today’s service shift'}
        </span>
      </div>

      {/* 2. Active Orders in Kitchen */}
      <div className="orders-summary-card">
        <div className="orders-summary-card__header">
          <span className="orders-summary-card__kicker">In Preparation</span>
          <span className="orders-summary-card__icon" aria-hidden="true">🍳</span>
        </div>
        <span className="orders-summary-card__val orders-summary-card__val--info">
          {isLoading ? '—' : summary.activeOrders}
        </span>
        <span className="orders-summary-card__desc">
          Active kitchen fulfillment pipeline
        </span>
      </div>

      {/* 3. Delayed / Overdue Attention */}
      <div className="orders-summary-card">
        <div className="orders-summary-card__header">
          <span className="orders-summary-card__kicker">Attention Needed</span>
          <span className="orders-summary-card__icon" aria-hidden="true">⚠️</span>
        </div>
        <span
          className={`orders-summary-card__val ${
            summary.delayedOrders > 0 ? 'orders-summary-card__val--warning' : ''
          }`}
        >
          {isLoading ? '—' : summary.delayedOrders}
        </span>
        <span className="orders-summary-card__desc">
          {summary.delayedOrders > 0
            ? 'Orders delayed or past schedule deadline'
            : 'All active orders on track for deadline'}
        </span>
      </div>

      {/* 4. Completed Orders */}
      <div className="orders-summary-card">
        <div className="orders-summary-card__header">
          <span className="orders-summary-card__kicker">Ready / Fulfilled</span>
          <span className="orders-summary-card__icon" aria-hidden="true">✅</span>
        </div>
        <span className="orders-summary-card__val orders-summary-card__val--success">
          {isLoading ? '—' : summary.completedOrders}
        </span>
        <span className="orders-summary-card__desc">
          Prepared, boxed, or dispatched
        </span>
      </div>

      {/* 5. Revenue Exposure / Preserved */}
      <div className="orders-summary-card">
        <div className="orders-summary-card__header">
          <span className="orders-summary-card__kicker">Total Order Value</span>
          <span className="orders-summary-card__icon" aria-hidden="true">₹</span>
        </div>
        <span className="orders-summary-card__val orders-summary-card__val--primary">
          {isLoading ? '—' : summary.formattedTotalRevenue}
        </span>
        <span className="orders-summary-card__desc">
          Aggregated order value across active & completed
        </span>
      </div>
    </section>
  )
}
