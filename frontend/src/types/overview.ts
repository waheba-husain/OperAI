/* ============================================================
   src/types/overview.ts
   TypeScript definitions for the OperAI Overview dashboard.
   All data represented here is strictly simulated demo data,
   clearly labeled as simulated per AGENTS.md rules.
   ============================================================ */

export type UrgencyLevel = 'critical' | 'warning' | 'info'
export type TaskStatus = 'completed' | 'in-progress' | 'upcoming' | 'locked'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'

export interface KpiItem {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly supportingText: string
  readonly trend?: {
    readonly direction: 'up' | 'down' | 'neutral'
    readonly text: string
  }
  readonly badgeText?: string
  readonly variant: 'primary' | 'revenue' | 'margin' | 'attention'
  readonly icon: string
}

export interface AiBriefingObservation {
  readonly id: string
  readonly tag: string
  readonly text: string
  readonly urgency: 'alert' | 'positive' | 'notice'
}

export interface AiKitchenBriefing {
  readonly title: string
  readonly timestamp: string
  readonly statusBadge: string
  readonly observations: readonly AiBriefingObservation[]
  readonly recommendedAction: {
    readonly description: string
    readonly targetLabel: string
    readonly targetPageId?: string
  }
}

export interface HourlyPerformancePoint {
  readonly time: string       // e.g. "08:00"
  readonly revenue: number    // in INR e.g. 15400
  readonly orders: number     // order count e.g. 8
  readonly peak?: boolean
}

export interface StationHealth {
  readonly id: string
  readonly name: string
  readonly utilizationPct: number
  readonly activeCooks: number
  readonly status: 'normal' | 'busy' | 'light'
}

export interface IngredientAlert {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly currentStock: string
  readonly requiredStock: string
  readonly deficit: string
  readonly impactTime: string
  readonly urgency: UrgencyLevel
  readonly affectedDishesCount: number
}

export interface PrepTaskItem {
  readonly id: string
  readonly title: string
  readonly station: string
  readonly timeWindow: string
  readonly priority: TaskPriority
  readonly status: TaskStatus
  readonly progressPct?: number
  readonly isLocked?: boolean
}
