/* ============================================================
   frontend/src/api/adapters/orderAdapter.ts
   OperAI / Cloud Kitchen Rescue — Order DTO to View-Model Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.5 (Order DTO)
   - frontend/src/types/liveOperations.ts (LiveOrder View Model)
   - frontend/docs/stage-2.1-corrective-audit.md (§5 Status Mapping)

   CRITICAL RULES:
   1. DO NOT map 'completed' to 'dispatched'. Food is ready at the pass ('ready').
   2. DO NOT map 'partial' to 'plating'. 'partial' means partial fulfillment.
   3. DO NOT treat 'delayed' as a physical station; it is an urgency flag.
   4. DO NOT invent backend progress percentages.
   5. DO NOT treat deadline as creation timestamp.
   ============================================================ */

import type { OrderChannelDTO, OrderDTO, OrderStatusDTO } from '../../types/dto'
import type { LiveOrder, OrderItem, OrderStatus, OrderUrgency } from '../../types/liveOperations'

export const CHANNEL_DISPLAY_MAP: Record<OrderChannelDTO, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  swiggy: 'Swiggy',
  zomato: 'Zomato',
  direct: 'Direct Call'
}

/**
 * Format an ISO 8601 timestamp with offset into IST 12-hour time string (e.g. "12:30 PM").
 */
export function formatTimeIST(isoString: string): string {
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    }).format(date)
  } catch {
    return '—'
  }
}

/**
 * Formats a YYYY-MM-DD string into an IST display string (e.g. "Saturday, 17 Oct 2026").
 */
export function formatDateIST(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number)
    if (!year || !month || !day) return dateStr
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Kolkata'
    }).format(date)
  } catch {
    return dateStr
  }
}

/**
 * Maps backend OrderStatusDTO to frontend OrderStatus view-model tab.
 * Returns null for statuses that cannot be semantically defended in the current UI tabs.
 */
export function mapOrderStatus(status: OrderStatusDTO): OrderStatus | null {
  switch (status) {
    case 'new':
    case 'planned':
      return 'queued'

    case 'in_progress':
      return 'prep'

    case 'completed':
      // Food preparation completed and boxed; waiting at pickup counter.
      // HARD RULE: Must NOT be mapped to 'dispatched'.
      return 'ready'

    case 'delayed':
      // HARD RULE: Do NOT map delayed orders to physical 'prep'.
      // 'delayed' is a solver deadline-risk flag, NOT a physical kitchen stage.
      // The order is awaiting kitchen fulfillment; safest presentation fallback
      // is 'queued' with a 'critical' urgency badge, explicitly avoiding the false
      // claim that physical cooking or preparation has already commenced.
      return 'queued'

    case 'partial':
      // HARD RULE: Must NOT be mapped to 'plating'.
      // Backend 'partial' means shortage-adjusted partial fulfillment.
      // The current UI has no 'partial' tab; marked UNRESOLVED.
      return null

    case 'cancelled':
      // Cancelled orders are excluded from active preparation queues.
      return null
  }
}

/**
 * Calculates order urgency based on minutes remaining until deadline or delayed status.
 */
export function calculateOrderUrgency(minutesUntilDue: number, status: OrderStatusDTO): OrderUrgency {
  if (status === 'delayed' || minutesUntilDue <= 5) {
    return 'critical'
  }
  if (minutesUntilDue <= 15) {
    return 'warning'
  }
  return 'normal'
}

/**
 * Transforms an OrderDTO from GET /api/orders into a LiveOrder view model.
 * Returns null if the order status has no valid semantic mapping in the live queue.
 *
 * CANONICAL IDENTITY & DISPLAY FALLBACK:
 * - order.id (UUID) is the canonical identifier preserved across the system.
 * - 'ref' (#ORD-XXXX) is a presentation-only display fallback derived from the UUID,
 *   NOT a sequential backend order number or platform receipt reference.
 *
 * @param order Source OrderDTO from backend
 * @param now Reference timestamp for relative urgency calculation (defaults to current time)
 */
export function adaptOrderToLiveOrder(order: OrderDTO, now: Date = new Date()): LiveOrder | null {
  const status = mapOrderStatus(order.status)
  if (!status) {
    return null
  }

  // Safely evaluate deadline timestamp
  const deadlineDate = new Date(order.deadline)
  const isInvalidDate = isNaN(deadlineDate.getTime())
  const minutesUntilDue = isInvalidDate
    ? 0
    : Math.round((deadlineDate.getTime() - now.getTime()) / 60000)

  const urgency = isInvalidDate
    ? (order.status === 'delayed' ? 'critical' : 'normal')
    : calculateOrderUrgency(minutesUntilDue, order.status)

  const channelDisplay = CHANNEL_DISPLAY_MAP[order.channel] ?? order.channel

  // Transform line items
  const items: OrderItem[] = order.items.map((item) => ({
    name: item.name,
    qty: item.quantity
  }))

  return {
    id: order.id, // Canonical backend UUID
    ref: `#ORD-${order.id.slice(0, 4).toUpperCase()}`, // Display-only fallback reference
    items,
    status,
    // Backend DB does not track intermediate completion percentages.
    // Explicitly 100 for completed orders, 0 for active orders; no partial percentages fabricated.
    progressPct: order.status === 'completed' ? 100 : 0,
    dueTime: isInvalidDate ? '—' : formatTimeIST(order.deadline),
    minutesUntilDue,
    urgency,
    channel: channelDisplay,
    channelRef: `${order.customer_name} • ${channelDisplay}`
  }
}

/**
 * Adapts an array of OrderDTOs, filtering out unmappable (cancelled/unresolved) records.
 */
export function adaptOrdersToLiveOrders(orders: readonly OrderDTO[], now: Date = new Date()): LiveOrder[] {
  return orders
    .map((order) => adaptOrderToLiveOrder(order, now))
    .filter((order): order is LiveOrder => order !== null)
}

/**
 * Adapts an OrderDTO specifically for Live Operations queue presentation.
 * Preserves the canonical backend status via `rawStatus`.
 *
 * CANONICAL ORDER STATUS BEHAVIOR (per AGENTS.md and Stage 2.4B §4):
 * - 'completed': Maps to presentation status 'ready' (food is boxed and ready at pickup counter, NEVER 'dispatched').
 * - 'delayed': Solver late-risk flag; maps to presentation status 'queued' with 'critical' urgency and rawStatus 'delayed'.
 * - 'partial': Represents shortage-adjusted partial fulfillment; maps to presentation status 'prep' with rawStatus 'partial'
 *   so it is visibly tracked in active prep work without being falsely mapped to 'plating'.
 * - 'cancelled': Returns null (cancelled orders are strictly excluded from active kitchen preparation).
 * - 'new' | 'planned': Maps to presentation status 'queued'.
 * - 'in_progress': Maps to presentation status 'prep'.
 */
export function adaptOrderToLiveOpsQueue(order: OrderDTO, now: Date = new Date()): LiveOrder | null {
  if (order.status === 'cancelled') {
    return null
  }

  let presentationStatus: OrderStatus
  switch (order.status) {
    case 'new':
    case 'planned':
    case 'delayed':
      presentationStatus = 'queued'
      break
    case 'in_progress':
    case 'partial':
      presentationStatus = 'prep'
      break
    case 'completed':
      presentationStatus = 'ready'
      break
  }

  const deadlineDate = new Date(order.deadline)
  const isInvalidDate = isNaN(deadlineDate.getTime())
  const minutesUntilDue = isInvalidDate
    ? 0
    : Math.round((deadlineDate.getTime() - now.getTime()) / 60000)

  const urgency = isInvalidDate
    ? (order.status === 'delayed' ? 'critical' : 'normal')
    : calculateOrderUrgency(minutesUntilDue, order.status)

  const channelDisplay = CHANNEL_DISPLAY_MAP[order.channel] ?? order.channel

  const items: OrderItem[] = order.items.map((item) => ({
    name: item.name,
    qty: item.quantity
  }))

  return {
    id: order.id,
    ref: `#ORD-${order.id.slice(0, 4).toUpperCase()}`,
    items,
    status: presentationStatus,
    rawStatus: order.status,
    progressPct: order.status === 'completed' ? 100 : 0,
    dueTime: isInvalidDate ? '—' : formatTimeIST(order.deadline),
    minutesUntilDue,
    urgency,
    channel: channelDisplay,
    channelRef: `${order.customer_name} • ${channelDisplay}`
  }
}

/**
 * Transforms an array of OrderDTOs into LiveOrder view models for the Live Operations queue.
 */
export function adaptOrdersToLiveOpsQueue(orders: readonly OrderDTO[], now: Date = new Date()): LiveOrder[] {
  return orders
    .map((order) => adaptOrderToLiveOpsQueue(order, now))
    .filter((order): order is LiveOrder => order !== null)
}

