/* ============================================================
   frontend/src/api/adapters/planAdapter.ts
   OperAI / Cloud Kitchen Rescue — Plan Task DTO to View-Model Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.8 (PlanTaskDTO)
   - frontend/src/types/liveOperations.ts (LivePrepTask View Model)
   - frontend/src/types/overview.ts (PrepTaskItem View Model)

   RULES:
   1. The backend has NO physical "stations" table. Workstations are derived
      from task_type ('prep' | 'cook' | 'pack') and burner_no.
   2. DO NOT fabricate station capacity rows or station utilization percentages.
   3. Tasks have NO priority column in the DB; priority is derived as 'critical'
      if order is in late_orders, else 'medium'.
   4. Preserves locked status per AGENTS.md Rule 10.
   ============================================================ */

import type { OrderDTO, PlanResponseDTO, PlanTaskDTO, PlanTaskStatusDTO } from '../../types/dto.ts'
import type { LivePrepTask, LiveTaskPriority, LiveTaskStatus } from '../../types/liveOperations.ts'
import type { PrepTaskItem, TaskPriority, TaskStatus } from '../../types/overview.ts'
import type { SchedulePlanSummary, ScheduleTaskItem } from '../../types/schedulePlan.ts'
import { CHANNEL_DISPLAY_MAP, formatDateIST, formatTimeIST } from './orderAdapter.ts'

/**
 * Derives a human-readable workstation resource label from task_type and burner_no.
 *
 * ARCHITECTURAL CONTEXT:
 * The backend contains NO physical "stations" table; tasks are scheduled by 'cook_no' and 'burner_no'.
 * This derived string is an assignment descriptor to satisfy the view-model's required 'station' field,
 * and must NOT be interpreted as a claim of an authenticated physical kitchen room entity.
 */
export function deriveWorkstationLabel(task: PlanTaskDTO): string {
  switch (task.task_type) {
    case 'cook':
      return task.burner_no !== null ? `Burner #${task.burner_no}` : 'Hot Line'
    case 'prep':
      return 'Prep Station'
    case 'pack':
      return 'Packaging & Pass'
  }
}

/**
 * Maps PlanTaskStatusDTO to LiveTaskStatus for Live Operations timeline.
 * Returns null if task is cancelled.
 */
export function mapLiveTaskStatus(status: PlanTaskStatusDTO): LiveTaskStatus | null {
  switch (status) {
    case 'done':
      return 'completed'
    case 'in_progress':
      return 'in-progress'
    case 'scheduled':
      return 'upcoming'
    case 'cancelled':
      return null
  }
}

/**
 * Maps PlanTaskStatusDTO and lock state to Overview TaskStatus.
 * Returns null if task is cancelled.
 */
export function mapOverviewTaskStatus(task: PlanTaskDTO): TaskStatus | null {
  if (task.locked) {
    return 'locked'
  }
  switch (task.status) {
    case 'done':
      return 'completed'
    case 'in_progress':
      return 'in-progress'
    case 'scheduled':
      return 'upcoming'
    case 'cancelled':
      return null
  }
}

/**
 * Calculates task duration in minutes from start_at and end_at.
 */
export function calculateDurationMins(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime()
  const end = new Date(endAt).getTime()
  if (isNaN(start) || isNaN(end) || end <= start) {
    return 0
  }
  return Math.round((end - start) / 60000)
}

/**
 * Transforms a PlanTaskDTO into a LivePrepTask view model for Live Operations.
 * Returns null if the task is cancelled.
 *
 * VIEW-MODEL ASSUMPTIONS & CONTRACT NOTES:
 * 1. Priority: Derived from solver late_orders. If task.order_id is in late_orders,
 *    priority is 'critical' (deadline at risk). The backend does NOT store a task priority
 *    column; 'medium' is a view-model fallback, NOT a backend-measured priority.
 * 2. ProgressPct: Discrete states only (100 for done, 0 for scheduled/in-progress).
 *    The backend does not track partial task completion percentages.
 */
export function adaptTaskToLivePrepTask(
  task: PlanTaskDTO,
  lateOrderIds: readonly string[] = []
): LivePrepTask | null {
  const status = mapLiveTaskStatus(task.status)
  if (!status) {
    return null
  }

  const isLate = lateOrderIds.includes(task.order_id)
  const priority: LiveTaskPriority = isLate ? 'critical' : 'medium'

  return {
    id: task.id,
    title: `${task.dish} (${task.task_type.toUpperCase()})`,
    station: deriveWorkstationLabel(task),
    scheduledTime: formatTimeIST(task.start_at),
    durationMins: calculateDurationMins(task.start_at, task.end_at),
    status,
    priority,
    // Backend DB tracks discrete statuses; no intermediate percentage is stored
    progressPct: task.status === 'done' ? 100 : 0,
    assignedTo: `Cook #${task.cook_no}`,
    isLocked: task.locked
  }
}

/**
 * Transforms an array of PlanTaskDTOs into LivePrepTasks.
 */
export function adaptTasksToLivePrepTasks(
  tasks: readonly PlanTaskDTO[],
  lateOrderIds: readonly string[] = []
): LivePrepTask[] {
  return tasks
    .map((task) => adaptTaskToLivePrepTask(task, lateOrderIds))
    .filter((task): task is LivePrepTask => task !== null)
}

/**
 * Transforms a PlanTaskDTO into a PrepTaskItem view model for Overview.
 * Returns null if the task is cancelled.
 */
export function adaptTaskToOverviewItem(
  task: PlanTaskDTO,
  lateOrderIds: readonly string[] = []
): PrepTaskItem | null {
  const status = mapOverviewTaskStatus(task)
  if (!status) {
    return null
  }

  const isLate = lateOrderIds.includes(task.order_id)
  const priority: TaskPriority = isLate ? 'critical' : 'medium'
  const startIST = formatTimeIST(task.start_at)
  const endIST = formatTimeIST(task.end_at)

  return {
    id: task.id,
    title: `${task.dish} (${task.task_type.toUpperCase()})`,
    station: deriveWorkstationLabel(task),
    timeWindow: `${startIST} – ${endIST}`,
    priority,
    status,
    progressPct: task.status === 'done' ? 100 : 0,
    isLocked: task.locked
  }
}

/**
 * Transforms an array of PlanTaskDTOs into Overview PrepTaskItems.
 */
export function adaptTasksToOverviewItems(
  tasks: readonly PlanTaskDTO[],
  lateOrderIds: readonly string[] = []
): PrepTaskItem[] {
  return tasks
    .map((task) => adaptTaskToOverviewItem(task, lateOrderIds))
    .filter((task): task is PrepTaskItem => task !== null)
}

/**
 * Transforms a single PlanTaskDTO into a ScheduleTaskItem view model.
 * Preserves all documented fields (cook_no, burner_no, task_type, locked, status)
 * without fabricating physical telemetry or non-existent backend properties.
 */
export function adaptPlanTaskToScheduleItem(
  task: PlanTaskDTO,
  lateOrderIds: readonly string[] = [],
  orders: readonly OrderDTO[] = []
): ScheduleTaskItem {
  const isLate = lateOrderIds.includes(task.order_id)
  const matchingOrder = orders.find((o) => o.id === task.order_id)

  const startTimeFormatted = formatTimeIST(task.start_at)
  const endTimeFormatted = formatTimeIST(task.end_at)
  const timeWindow = `${startTimeFormatted} – ${endTimeFormatted}`
  const durationMins = calculateDurationMins(task.start_at, task.end_at)

  let customerName: string | undefined
  let channel: string | undefined
  let orderDeadline: string | undefined

  if (matchingOrder) {
    customerName = matchingOrder.customer_name
    channel = CHANNEL_DISPLAY_MAP[matchingOrder.channel] ?? matchingOrder.channel
    orderDeadline = formatTimeIST(matchingOrder.deadline)
  }

  return {
    id: task.id,
    orderId: task.order_id,
    orderItemId: task.order_item_id,
    dish: task.dish,
    taskType: task.task_type,
    burnerNo: task.burner_no,
    cookNo: task.cook_no,
    startAt: task.start_at,
    endAt: task.end_at,
    startTimeFormatted,
    endTimeFormatted,
    timeWindow,
    durationMins,
    status: task.status,
    isLocked: task.locked,
    isLateOrder: isLate,
    workstationLabel: deriveWorkstationLabel(task),
    assignedCookLabel: `Cook #${task.cook_no}`,
    assignedBurnerLabel: task.burner_no !== null ? `Burner #${task.burner_no}` : 'None (off-burner)',
    customerName,
    channel,
    orderDeadline
  }
}

/**
 * Transforms an array of PlanTaskDTOs into ScheduleTaskItems.
 * Preserves all tasks, including cancelled ones, so filtering can be handled transparently in the UI.
 */
export function adaptPlanTasksToScheduleItems(
  tasks: readonly PlanTaskDTO[],
  lateOrderIds: readonly string[] = [],
  orders: readonly OrderDTO[] = []
): ScheduleTaskItem[] {
  return tasks.map((task) => adaptPlanTaskToScheduleItem(task, lateOrderIds, orders))
}

/**
 * Derives kitchen plan summary metrics directly from code.
 *
 * HARD RULE (AGENTS.md Rule 1):
 * All counts and metrics are computed in TypeScript code; none are hallucinated by LLMs.
 * Cook and burner counts represent distinct identifiers in the current plan,
 * not evidence of authenticated physical hardware sensors.
 */
export function deriveSchedulePlanSummary(
  plan: PlanResponseDTO | null,
  targetDate: string
): SchedulePlanSummary {
  const tasks = plan?.tasks ?? []
  const activeTasks = tasks.filter((t) => t.status !== 'cancelled')

  const uniqueCooks = new Set(activeTasks.map((t) => t.cook_no))
  const uniqueBurners = new Set(
    activeTasks.filter((t) => t.burner_no !== null).map((t) => t.burner_no as number)
  )

  const scheduledCount = tasks.filter((t) => t.status === 'scheduled').length
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length
  const lockedCount = tasks.filter((t) => t.locked).length

  return {
    planVersion: plan ? `v${plan.plan_version}` : '—',
    date: targetDate,
    formattedDate: formatDateIST(targetDate),
    totalTasks: tasks.length,
    activeTasksCount: activeTasks.length,
    scheduledCount,
    inProgressCount,
    doneCount,
    cancelledCount,
    lockedCount,
    lateOrderCount: plan?.late_orders?.length ?? 0,
    activeCooksCount: uniqueCooks.size,
    activeBurnersCount: uniqueBurners.size
  }
}
