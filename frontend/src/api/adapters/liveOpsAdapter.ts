/* ============================================================
   frontend/src/api/adapters/liveOpsAdapter.ts
   OperAI / Cloud Kitchen Rescue — Live Operations Presentation Adapters

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.5 (Orders), §3.8 (Plan), §3.9 (Brief), §3.11 (Actions)
   - frontend/src/types/liveOperations.ts (LiveOrder, OpsMetric, OpsAlert)
   - AGENTS.md Rule 1 (Numbers from code) & Rule 9 (Honest data labels)
   ============================================================ */

import type {
  BriefResponseDTO,
  OrderDTO,
  PlanResponseDTO,
  ProposedActionDTO
} from '../../types/dto.ts'
import type {
  AlertSeverity,
  OpsAlert,
  OpsMetric
} from '../../types/liveOperations.ts'
import {
  adaptOrderToLiveOpsQueue,
  adaptOrdersToLiveOpsQueue
} from './orderAdapter.ts'
import {
  adaptActionsToOpsAlerts
} from './actionAdapter.ts'

export { adaptOrderToLiveOpsQueue, adaptOrdersToLiveOpsQueue }

export interface LiveOpsMetricsSourceData {
  readonly orders: readonly OrderDTO[]
  readonly plan?: PlanResponseDTO | null
  readonly brief?: BriefResponseDTO | null
  readonly pendingActions?: readonly ProposedActionDTO[]
  readonly now?: Date
}

/**
 * Derives the four primary operational summary metrics for the Live Operations header bar.
 * All numbers are computed from verified backend contracts, never fabricated.
 *
 * Metric 1: "Active Orders"
 *   - Count of scheduled non-cancelled orders that are currently in-flight (not yet completed).
 *   - Subtext breaks down in-prep vs queued commitments.
 *
 * Metric 2: "Near Deadline"
 *   - Count of active orders due within 15 minutes or flagged as delayed by the solver.
 *
 * Metric 3: "Tasks In Progress"
 *   - Count of discrete plan tasks currently attended or on burner (status === 'in_progress').
 *
 * Metric 4: "Needs Attention"
 *   - Sum of inventory shortages, pending recovery proposals, and solver late orders.
 */
export function deriveOpsMetrics(data: LiveOpsMetricsSourceData): OpsMetric[] {
  const {
    orders,
    plan,
    brief,
    pendingActions = [],
    now = new Date()
  } = data

  const validOrders = orders.filter((o) => o.status !== 'cancelled')
  const inFlightOrders = validOrders.filter((o) => o.status !== 'completed')

  const inPrepCount = inFlightOrders.filter((o) => o.status === 'in_progress').length
  const queuedCount = inFlightOrders.filter(
    (o) => o.status === 'new' || o.status === 'planned' || o.status === 'delayed'
  ).length
  const partialCount = inFlightOrders.filter((o) => o.status === 'partial').length

  let activeSubtext = 'No active orders in service'
  if (inFlightOrders.length > 0) {
    const parts = [`${inPrepCount} in prep`, `${queuedCount} queued`]
    if (partialCount > 0) {
      parts.push(`${partialCount} partial`)
    }
    activeSubtext = parts.join(' • ')
  }

  // Metric 1: Active Orders
  const activeOrdersMetric: OpsMetric = {
    id: 'active-orders',
    label: 'Active Orders',
    value: inFlightOrders.length,
    subtext: activeSubtext,
    variant: 'default',
    iconPath: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 1 1 6 0H9z'
  }

  // Metric 2: Near Deadline
  // Evaluates in-flight orders only. Orders with status === 'delayed' are counted immediately
  // regardless of parseable deadline. Orders due within 15 minutes are counted once even if
  // multiple conditions match. Invalid deadlines for non-delayed orders return false.
  const nearDeadlineCount = inFlightOrders.filter((o) => {
    if (o.status === 'delayed') return true
    if (!o.deadline) return false
    const deadlineTime = new Date(o.deadline).getTime()
    if (isNaN(deadlineTime)) return false
    const dueMins = Math.round((deadlineTime - now.getTime()) / 60000)
    return dueMins <= 15
  }).length

  const nearDeadlineMetric: OpsMetric = {
    id: 'near-deadline',
    label: 'Near Deadline',
    value: nearDeadlineCount,
    subtext: nearDeadlineCount > 0
      ? 'Due within 15 min or delayed'
      : 'All active orders on schedule',
    variant: nearDeadlineCount > 0 ? 'warning' : 'default',
    iconPath: 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-14v6l4 2'
  }

  // Metric 3: Tasks In Progress
  const inProgressTasks = plan?.tasks.filter((t) => t.status === 'in_progress') ?? []
  const upcomingTasks = plan?.tasks.filter((t) => t.status === 'scheduled') ?? []

  const prepInProgressMetric: OpsMetric = {
    id: 'prep-in-progress',
    label: 'Tasks In Progress',
    value: inProgressTasks.length,
    subtext: plan
      ? `${upcomingTasks.length} upcoming in solver plan`
      : 'No active solver plan',
    variant: 'default',
    iconPath: 'M22 12h-4l-3 9L9 3l-3 9H2'
  }

  // Metric 4: Needs Attention
  // Composite counter summing three discrete backend risk indicators:
  // (1) ingredient shortages from GET /api/brief,
  // (2) pending recovery proposals from GET /api/actions, and
  // (3) solver deadline risks from GET /api/plan (late_orders).
  // Subtext explicitly reports the category components to ensure clear semantics.
  const shortageCount = brief?.shortages.length ?? 0
  const pendingCount = pendingActions.length
  const lateOrdersCount = plan?.late_orders.length ?? 0
  const attentionCount = shortageCount + pendingCount + lateOrdersCount

  let attentionSubtext = 'All inventory & timelines nominal'
  if (attentionCount > 0) {
    const parts: string[] = []
    if (shortageCount > 0) parts.push(`${shortageCount} shortage(s)`)
    if (pendingCount > 0) parts.push(`${pendingCount} proposal(s)`)
    if (lateOrdersCount > 0) parts.push(`${lateOrdersCount} late order(s)`)
    attentionSubtext = parts.join(' • ')
  }

  const attentionMetric: OpsMetric = {
    id: 'attention-needed',
    label: 'Needs Attention',
    value: attentionCount,
    subtext: attentionSubtext,
    variant: attentionCount > 0 ? 'critical' : 'positive',
    iconPath: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01'
  }

  return [activeOrdersMetric, nearDeadlineMetric, prepInProgressMetric, attentionMetric]
}

export interface LiveOpsAlertsSourceData {
  readonly brief?: BriefResponseDTO | null
  readonly actions?: readonly ProposedActionDTO[]
  readonly plan?: PlanResponseDTO | null
}

/**
 * Derives operational alert cards for the Live Operations right-side panel.
 * Combines verified shortages, pending recovery proposals, and solver deadline risks.
 */
export function deriveLiveOpsAlerts(data: LiveOpsAlertsSourceData): OpsAlert[] {
  const alerts: OpsAlert[] = []

  // 1. Inventory Shortages from GET /api/brief
  if (data.brief?.shortages && data.brief.shortages.length > 0) {
    for (const shortage of data.brief.shortages) {
      const severity: AlertSeverity = shortage.short_by > 0 ? 'critical' : 'warning'
      alerts.push({
        id: `alt-shortage-${shortage.ingredient_id}`,
        severity,
        title: `${shortage.name} Stock Deficit`,
        detail: `Short by ${shortage.short_by} ${shortage.unit}. Current stock is ${shortage.stock_qty} ${shortage.unit}, needed ${shortage.needed_qty} ${shortage.unit}.`,
        context: `Exposes ₹${data.brief.revenue_at_risk.toFixed(0)} across ${data.brief.at_risk_orders.length} order(s).`,
        timeAgo: 'Live Horizon'
      })
    }
  }

  // 2. Solver Late Orders from GET /api/plan
  if (data.plan?.late_orders && data.plan.late_orders.length > 0) {
    alerts.push({
      id: 'alt-solver-late-orders',
      severity: 'critical',
      title: `${data.plan.late_orders.length} Order(s) At Deadline Risk`,
      detail: 'Current solver schedule indicates deadlines cannot be met without sequence or menu adjustment.',
      context: `Plan version ${data.plan.plan_version} • Solver constraint flag`,
      timeAgo: 'Live Plan'
    })
  }

  // 3. Pending Proposals from GET /api/actions?status=pending
  if (data.actions && data.actions.length > 0) {
    const actionAlerts = adaptActionsToOpsAlerts(data.actions)
    alerts.push(...actionAlerts)
  }

  return alerts
}
