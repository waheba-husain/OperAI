/* ============================================================
   frontend/src/types/schedulePlan.ts
   OperAI / Cloud Kitchen Rescue — Schedule & Plan View Models

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.8 (GET /api/plan) & §3.5 (GET /api/orders)
   - docs/Database_Schema.md §3.8 (plan_tasks table)
   - AGENTS.md (Rule 1: Numbers from code; Rule 10: Locked plan tasks never move)
   ============================================================ */

import type { PlanTaskStatusDTO, PlanTaskTypeDTO } from './dto.ts'

export type ScheduleTaskStatus = PlanTaskStatusDTO
export type ScheduleTaskType = PlanTaskTypeDTO

/** Filter options for Schedule & Plan task board */
export type ScheduleFilterStatus =
  | 'all-active'
  | 'in_progress'
  | 'scheduled'
  | 'done'
  | 'cancelled'
  | 'locked'

/**
 * Presentation view-model for a single scheduled kitchen task block.
 * Preserves all documented fields from PlanTaskDTO without fabricating telemetry.
 */
export interface ScheduleTaskItem {
  readonly id: string
  readonly orderId: string
  readonly orderItemId: string
  readonly dish: string
  readonly taskType: ScheduleTaskType
  readonly burnerNo: number | null
  readonly cookNo: number
  readonly startAt: string // ISO 8601 with offset
  readonly endAt: string   // ISO 8601 with offset
  readonly startTimeFormatted: string
  readonly endTimeFormatted: string
  readonly timeWindow: string
  readonly durationMins: number
  readonly status: ScheduleTaskStatus
  readonly isLocked: boolean
  readonly isLateOrder: boolean
  readonly workstationLabel: string
  readonly assignedCookLabel: string
  readonly assignedBurnerLabel: string
  /** Order details joined from GET /api/orders when available */
  readonly customerName?: string
  readonly channel?: string
  readonly orderDeadline?: string
}

/**
 * Summary metrics for the Schedule & Plan header bar and ribbon.
 * Computed strictly from code, never hallucinated by LLM.
 */
export interface SchedulePlanSummary {
  readonly planVersion: string
  readonly date: string
  readonly formattedDate: string
  readonly totalTasks: number
  readonly activeTasksCount: number
  readonly scheduledCount: number
  readonly inProgressCount: number
  readonly doneCount: number
  readonly cancelledCount: number
  readonly lockedCount: number
  readonly lateOrderCount: number
  readonly activeCooksCount: number
  readonly activeBurnersCount: number
}
