/* ============================================================
   src/types/liveOperations.ts
   TypeScript definitions for the OperAI Live Operations page.
   All data represented here is simulated demo data per AGENTS.md rule 9.
   ============================================================ */

import type { OrderStatusDTO } from './dto.ts'

export type OrderStatus =
  | 'queued'
  | 'prep'
  | 'plating'
  | 'ready'
  | 'dispatched'

export type OrderUrgency = 'critical' | 'warning' | 'normal'

export type LiveTaskStatus = 'completed' | 'in-progress' | 'upcoming'
export type LiveTaskPriority = 'critical' | 'high' | 'medium' | 'low'

export type StationStatus = 'busy' | 'normal' | 'light' | 'idle'

export type AlertSeverity = 'critical' | 'warning' | 'info'

/* ── Operational Summary ───────────────────────────────────── */
export interface OpsMetric {
  readonly id: string
  readonly label: string
  readonly value: string | number
  readonly unit?: string
  readonly subtext: string
  readonly variant: 'default' | 'warning' | 'critical' | 'positive'
  readonly iconPath: string
}

/* ── Order Queue ───────────────────────────────────────────── */
export interface OrderItem {
  readonly name: string
  readonly qty: number
}

export interface LiveOrder {
  readonly id: string
  /** e.g. "#ORD-4821" */
  readonly ref: string
  readonly items: readonly OrderItem[]
  readonly status: OrderStatus
  readonly progressPct: number
  /** "12:45 PM" */
  readonly dueTime: string
  /** Minutes until due. Negative = overdue. */
  readonly minutesUntilDue: number
  readonly urgency: OrderUrgency
  /** Documented channels: whatsapp, instagram, swiggy, zomato, direct (per DB schema) */
  readonly channel: string
  /** Delivery platform order reference or customer channel identifier (no dine-in table or driver tracking in this MVP) */
  readonly channelRef: string
  /** Canonical backend status from GET /api/orders per Rest_API_Spec.md §3.5 */
  readonly rawStatus?: OrderStatusDTO
}

/* ── Preparation Timeline ──────────────────────────────────── */
export interface LivePrepTask {
  readonly id: string
  readonly title: string
  readonly station: string
  readonly scheduledTime: string
  readonly durationMins: number
  readonly status: LiveTaskStatus
  readonly priority: LiveTaskPriority
  readonly progressPct?: number
  readonly assignedTo: string
  readonly isLocked?: boolean
}

/* ── Kitchen Stations ──────────────────────────────────────── */
export interface LiveStation {
  readonly id: string
  readonly name: string
  readonly shortName: string
  readonly status: StationStatus
  readonly capacityPct: number
  readonly activeTasks: number
  readonly totalSlots: number
  readonly assignedCooks: number
  readonly currentTask: string
}

/* ── Operational Alerts ────────────────────────────────────── */
export interface OpsAlert {
  readonly id: string
  readonly severity: AlertSeverity
  readonly title: string
  readonly detail: string
  readonly context: string
  readonly timeAgo: string
}
