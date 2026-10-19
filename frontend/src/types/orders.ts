/* ============================================================
   frontend/src/types/orders.ts
   OperAI / Cloud Kitchen Rescue — Orders View-Model Types

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.5 (GET /api/orders)
   - docs/Database_Schema.md §3.6 (orders table) & §3.7 (order_items table)
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels)
   ============================================================ */

import type { DataSourceDTO, OrderChannelDTO, OrderStatusDTO } from './dto.ts'

export type OrderDeadlineStatus = 'overdue' | 'due-soon' | 'normal'

export interface OrderItemViewModel {
  readonly menuItemId: string
  readonly name: string
  readonly quantity: number
  readonly unitPrice: number
  readonly formattedUnitPrice: string
  readonly subtotal: number
  readonly formattedSubtotal: string
}

export interface OrderViewModel {
  /** Canonical backend UUID (PK) */
  readonly id: string
  /** Presentation reference derived from UUID, e.g. "#ORD-A1B2" */
  readonly ref: string
  readonly customerName: string
  readonly customerPhone?: string
  readonly channel: OrderChannelDTO
  readonly channelLabel: string
  readonly deadline: string // ISO 8601 with offset
  readonly formattedDeadlineTime: string // e.g. "12:30 PM"
  readonly formattedDeadlineDate: string // e.g. "17 Oct 2026"
  readonly minutesUntilDue: number // Negative if overdue
  readonly deadlineStatus: OrderDeadlineStatus
  readonly status: OrderStatusDTO
  readonly statusLabel: string
  readonly totalAmount: number
  readonly formattedTotalAmount: string // e.g. "₹360.00"
  readonly itemsCount: number
  readonly items: readonly OrderItemViewModel[]
  readonly dataSource: DataSourceDTO
}

export type OrderSortField = 'deadline' | 'totalAmount' | 'customerName' | 'status'
export type OrderSortDirection = 'asc' | 'desc'
export type OrderFilterTab = 'all' | OrderStatusDTO

export interface OrdersSummaryMetrics {
  readonly totalOrders: number
  readonly activeOrders: number // 'new' | 'planned' | 'in_progress' | 'delayed' | 'partial'
  readonly completedOrders: number // 'completed'
  readonly delayedOrders: number // 'delayed' or overdue
  readonly cancelledOrders: number // 'cancelled'
  readonly totalRevenue: number
  readonly formattedTotalRevenue: string
  readonly channelBreakdown: Readonly<Record<OrderChannelDTO, number>>
}
