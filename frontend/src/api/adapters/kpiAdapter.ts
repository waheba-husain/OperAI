/* ============================================================
   frontend/src/api/adapters/kpiAdapter.ts
   OperAI / Cloud Kitchen Rescue — Overview KPI Derivation Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.3 (GET /api/menu), §3.5 (GET /api/orders),
     §3.9 (GET /api/brief), §3.11 (GET /api/actions)
   - frontend/src/types/overview.ts (KpiItem View Model)
   - AGENTS.md Rule 1 (Numbers come from code) & Rule 9 (No invented deltas)

   CRITICAL RULES:
   1. Cancelled orders MUST be excluded from scheduled order count and gross value.
   2. Sum of total_amount is Gross Scheduled Order Value (GMV), NOT net profit or realized bank revenue.
   3. Average dish margin from /api/menu is unweighted catalog dish margin, NOT overall kitchen profitability.
   4. Trends (e.g. "+18% vs yesterday") are left undefined; single-date queries cannot provide historical deltas.
   ============================================================ */

import type { MenuItemDTO, OrderDTO } from '../../types/dto'
import type { KpiItem } from '../../types/overview'

export interface KpiSourceData {
  /** Daily orders from GET /api/orders?date={date} */
  readonly orders: readonly OrderDTO[]
  /** Menu catalog from GET /api/menu */
  readonly menuItems?: readonly MenuItemDTO[]
  /** Active shortage count from GET /api/brief */
  readonly shortageCount?: number
  /** Pending proposed actions count from GET /api/actions?status=pending */
  readonly pendingActionCount?: number
}

/**
 * Derives the four primary Overview KPI items from verified API data.
 *
 * KPI 1: "Active Orders Scheduled" (Orders Scheduled Today)
 *   - Meaning: Count of valid customer orders scheduled or fulfilled for the target date.
 *   - Statuses included: 'new', 'planned', 'in_progress', 'delayed', 'partial', 'completed'.
 *   - Statuses excluded: 'cancelled' (voided orders that will not be fulfilled).
 *   - Classification: Derived from GET /api/orders.
 *
 * KPI 2: "Gross Scheduled Order Value" (Today's Scheduled Revenue)
 *   - Meaning: Total bill amount (GMV) of non-cancelled orders scheduled for the target date.
 *   - Calculation: sum(order.total_amount) for orders with status !== 'cancelled'.
 *   - Limitation: Represents gross customer commitments, NOT net margin or settled revenue.
 *   - Classification: Derived from GET /api/orders.
 *
 * KPI 3: "Avg Dish Margin (Catalog)"
 *   - Meaning: Simple arithmetic mean of active menu item profit margins.
 *   - Calculation: sum(item.margin_pct) / count(active_items).
 *   - Limitation: Does NOT equate to overall kitchen profitability (unweighted by order volume;
 *     does not account for fixed kitchen labor or overhead beyond allocated unit amounts).
 *   - Classification: Derived from GET /api/menu.
 *
 * KPI 4: "Attention Required"
 *   - Meaning: Count of operational items requiring kitchen owner review or approval.
 *   - Calculation: count(shortages) + count(pending_actions).
 *   - Classification: Derived from GET /api/brief + GET /api/actions.
 */
export function deriveOverviewKpis(data: KpiSourceData): KpiItem[] {
  const { orders, menuItems = [], shortageCount = 0, pendingActionCount = 0 } = data

  // Exclude cancelled orders from operational metrics
  const validOrders = orders.filter((o) => o.status !== 'cancelled')
  const totalOrders = validOrders.length
  const completedOrders = validOrders.filter((o) => o.status === 'completed').length
  const inPrepOrders = validOrders.filter((o) => o.status === 'in_progress').length
  const queuedOrders = validOrders.filter((o) => o.status === 'new' || o.status === 'planned' || o.status === 'delayed').length

  // 1. Orders Scheduled Today
  const ordersKpi: KpiItem = {
    id: 'orders-today',
    label: 'Orders Scheduled Today',
    value: String(totalOrders),
    supportingText: totalOrders > 0
      ? `${completedOrders} ready • ${inPrepOrders} in prep • ${queuedOrders} queued`
      : 'No active orders scheduled for this date',
    variant: 'primary',
    icon: 'receipt'
  }

  // 2. Gross Scheduled Order Value
  const totalGrossValue = validOrders.reduce((sum, order) => sum + order.total_amount, 0)
  const formattedGrossValue = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(totalGrossValue)

  const revenueKpi: KpiItem = {
    id: 'revenue-today',
    label: 'Gross Scheduled Order Value',
    value: formattedGrossValue,
    supportingText: totalOrders > 0
      ? `Gross bill value across ${totalOrders} active orders (excl. cancelled)`
      : 'No active orders scheduled',
    variant: 'revenue',
    icon: 'currency-inr'
  }

  // 3. Average Catalog Dish Margin
  const activeDishes = menuItems.filter((i) => i.is_active)
  let avgMarginText = '—'
  let marginSupporting = 'Catalog data pending'

  if (activeDishes.length > 0) {
    const avgMargin = activeDishes.reduce((sum, item) => sum + item.margin_pct, 0) / activeDishes.length
    avgMarginText = `${avgMargin.toFixed(1)}%`
    marginSupporting = `Unweighted dish margin across ${activeDishes.length} active menu items`
  }

  const marginKpi: KpiItem = {
    id: 'profit-margin',
    label: 'Avg Dish Margin (Catalog)',
    value: avgMarginText,
    supportingText: marginSupporting,
    variant: 'margin',
    icon: 'trending-up'
  }

  // 4. Attention Required
  const attentionCount = shortageCount + pendingActionCount
  const attentionKpi: KpiItem = {
    id: 'orders-attention',
    label: 'Attention Required',
    value: String(attentionCount),
    supportingText: `${shortageCount} inventory shortages • ${pendingActionCount} pending proposals`,
    variant: 'attention',
    icon: 'alert-triangle'
  }

  return [ordersKpi, revenueKpi, marginKpi, attentionKpi]
}
