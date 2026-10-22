/* ============================================================
   frontend/src/hooks/useSchedulePlanData.ts
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Page Data Hook

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.8 (GET /api/plan?date=YYYY-MM-DD)
   - docs/Rest_API_Spec.md §3.5 (GET /api/orders?date=YYYY-MM-DD)
   - AGENTS.md (Rule 1: Numbers from code; Rule 10: Locked plan tasks never move)

   LIFECYCLE & STATE RULES:
   1. Requests verified endpoints (GET /api/plan and GET /api/orders) using shared ApiClient.
   2. Handles Loading, Success, Empty Plan (404 / 0 tasks), and Error states explicitly.
   3. NEVER silently falls back to mock data after a live API failure.
   4. Aborts previous in-flight requests on date changes and verifies request sequence counter
      to prevent stale responses from overwriting newer selections.
   5. Explicit mode toggle between 'live' and 'demo' ensures transparent testing.
   ============================================================ */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { OrderDTO, PlanGenerateResponseDTO, PlanResponseDTO } from '../types/dto.ts'
import type { SchedulePlanSummary, ScheduleTaskItem } from '../types/schedulePlan.ts'
import {
  apiClient as defaultApiClient,
  ApiClient,
  getDefaultConfig,
  completePlanTask,
  generatePlan,
  getOrders,
  getPlan,
  ApiError,
  ConfigurationError,
  NetworkError
} from '../api/index.ts'
import {
  adaptPlanTasksToScheduleItems,
  deriveSchedulePlanSummary
} from '../api/adapters/planAdapter.ts'
import { formatDateIST } from '../api/adapters/orderAdapter.ts'
import { getTodayDateIST } from './useOverviewData.ts'
import {
  DEMO_SCHEDULE_METADATA,
  DEMO_SCHEDULE_ITEMS,
  DEMO_SCHEDULE_SUMMARY,
  DEMO_SCHEDULE_PLAN
} from '../pages/schedulePlan/schedulePlanData.ts'

export type SchedulePlanMode = 'live' | 'demo'

export interface UseSchedulePlanDataOptions {
  readonly client?: ApiClient
  readonly initialDate?: string
  readonly initialMode?: SchedulePlanMode
}

interface LivePayload {
  readonly plan: PlanResponseDTO | null
  readonly orders: readonly OrderDTO[]
  readonly tasks: ScheduleTaskItem[]
  readonly summary: SchedulePlanSummary
  readonly isPlanNotFound: boolean
}

export interface SchedulePlanDataResult {
  readonly mode: SchedulePlanMode
  readonly isLive: boolean
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly isMissingConfig: boolean
  readonly isEmpty: boolean
  readonly isPlanNotFound: boolean
  readonly isGenerating: boolean
  readonly generateError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly generateSuccessMessage: string | null
  readonly targetDate: string
  readonly formattedDate: string
  readonly kitchenName: string
  readonly planVersion: string
  readonly summary: SchedulePlanSummary
  readonly tasks: readonly ScheduleTaskItem[]
  readonly lateOrderIds: readonly string[]
  readonly isCompletingTask: boolean
  readonly completingTaskId: string | null
  readonly completeTaskError: ApiError | ConfigurationError | NetworkError | Error | null
  readonly completeTaskSuccessMessage: string | null
  readonly markTaskDone: (taskId: string) => Promise<boolean>
  readonly setTargetDate: (newDate: string) => void
  readonly generateSchedule: () => Promise<PlanGenerateResponseDTO | null>
  readonly clearGenerateState: () => void
  readonly refetch: () => Promise<void>
  readonly setMode: (mode: SchedulePlanMode) => void
}

export function useSchedulePlanData(options?: UseSchedulePlanDataOptions): SchedulePlanDataResult {
  const activeClient = options?.client ?? defaultApiClient
  const [targetDate, setTargetDate] = useState<string>(
    () => options?.initialDate ?? getTodayDateIST()
  )

  // Detect whether API key is configured
  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  // Initial mode selection: explicit option > api key presence > demo
  const [mode, setMode] = useState<SchedulePlanMode>(() => {
    if (options?.initialMode) return options.initialMode
    return hasApiKey ? 'live' : 'demo'
  })

  const [isLoading, setIsLoading] = useState<boolean>(mode === 'live')
  const [error, setError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [livePayload, setLivePayload] = useState<LivePayload | null>(null)

  // Plan generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false)
  const [generateError, setGenerateError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [generateSuccessMessage, setGenerateSuccessMessage] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [completeTaskError, setCompleteTaskError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [completeTaskSuccessMessage, setCompleteTaskSuccessMessage] = useState<string | null>(null)
  const [demoCompletedTaskIds, setDemoCompletedTaskIds] = useState<ReadonlySet<string>>(new Set())

  const clearGenerateState = useCallback(() => {
    setGenerateError(null)
    setGenerateSuccessMessage(null)
  }, [])

  const handleSetTargetDate = useCallback((newDate: string) => {
    setTargetDate(newDate)
    setGenerateError(null)
    setGenerateSuccessMessage(null)
  }, [])

  const abortControllerRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef<number>(0)

  const fetchData = useCallback(async () => {
    if (mode !== 'live') {
      setIsLoading(false)
      setError(null)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Increment sequence id to prevent race conditions across rapid date changes
    const currentSeq = ++requestSeqRef.current

    setIsLoading(true)
    setError(null)

    try {
      // 1. Fetch Plan (treat 404 PLAN_NOT_FOUND as non-fatal missing plan)
      let isNotFound = false
      const planPromise = getPlan(
        { date: targetDate },
        { signal: controller.signal, client: activeClient }
      ).catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 404 || err.code === 'PLAN_NOT_FOUND')) {
          isNotFound = true
          return null
        }
        throw err
      })

      // 2. Fetch Orders for customer & deadline context
      const ordersPromise = getOrders(
        { date: targetDate },
        { signal: controller.signal, client: activeClient }
      ).catch((err: unknown) => {
        // If orders fail with 404, fallback to empty list
        if (err instanceof ApiError && err.status === 404) {
          return { data: [], count: 0 }
        }
        throw err
      })

      const [planRes, ordersRes] = await Promise.all([planPromise, ordersPromise])

      // If a newer request has started, discard this result
      if (currentSeq !== requestSeqRef.current) {
        return
      }

      const tasks = planRes
        ? adaptPlanTasksToScheduleItems(planRes.tasks, planRes.late_orders, ordersRes.data)
        : []

      const summary = deriveSchedulePlanSummary(planRes, targetDate)

      setLivePayload({
        plan: planRes,
        orders: ordersRes.data,
        tasks,
        summary,
        isPlanNotFound: isNotFound
      })
      setError(null)
    } catch (err: unknown) {
      if (currentSeq !== requestSeqRef.current) {
        return
      }

      // Ignore abort errors from cleanup
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (err instanceof NetworkError && err.isAborted) {
        return
      }

      // HARD RULE: Never silently fall back to mock data on API errors
      setError(err instanceof Error ? err : new Error(String(err)))
      setLivePayload(null)
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setIsLoading(false)
      }
    }
  }, [mode, targetDate, activeClient])

  const generateSchedule = useCallback(async (): Promise<PlanGenerateResponseDTO | null> => {
    if (isGenerating) return null
    setIsGenerating(true)
    setGenerateError(null)
    setGenerateSuccessMessage(null)

    try {
      const res = await generatePlan(
        { date: targetDate, regenerate: false },
        { client: activeClient }
      )
      setGenerateSuccessMessage(
        `Schedule v${res.plan_version} generated successfully: ${res.orders_scheduled} orders scheduled, ${res.task_count} tasks created (${res.solver} solver).`
      )
      await fetchData()
      return res
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err))
      setGenerateError(errorObj)
      return null
    } finally {
      setIsGenerating(false)
    }
  }, [isGenerating, targetDate, activeClient, fetchData])

  const markTaskDone = useCallback(
    async (taskId: string): Promise<boolean> => {
      if (completingTaskId) {
        return false
      }
      setCompletingTaskId(taskId)
      setCompleteTaskError(null)
      setCompleteTaskSuccessMessage(null)

      try {
        if (mode === 'live') {
          const res = await completePlanTask(taskId, { client: activeClient })
          setCompleteTaskSuccessMessage(res.message || 'Task marked as done')
          await fetchData()
        } else {
          setDemoCompletedTaskIds((prev) => new Set([...prev, taskId]))
          setCompleteTaskSuccessMessage('Task marked as done (demo mode)')
        }
        return true
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err))
        setCompleteTaskError(errorObj)
        return false
      } finally {
        setCompletingTaskId(null)
      }
    },
    [completingTaskId, mode, activeClient, fetchData]
  )

  useEffect(() => {
    const run = async () => {
      await fetchData()
    }
    void run()
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [fetchData])

  // Empty state check for live data
  const isEmpty =
    mode === 'live' &&
    livePayload !== null &&
    livePayload.tasks.length === 0

  if (mode === 'live' && livePayload) {
    return {
      mode: 'live',
      isLive: true,
      isLoading,
      error,
      isMissingConfig: !hasApiKey,
      isEmpty,
      isPlanNotFound: livePayload.isPlanNotFound,
      isGenerating,
      generateError,
      generateSuccessMessage,
      targetDate,
      formattedDate: formatDateIST(targetDate),
      kitchenName: DEMO_SCHEDULE_METADATA.kitchenName,
      planVersion: livePayload.summary.planVersion,
      summary: livePayload.summary,
      tasks: livePayload.tasks,
      lateOrderIds: livePayload.plan?.late_orders ?? [],
      isCompletingTask: completingTaskId !== null,
      completingTaskId,
      completeTaskError,
      completeTaskSuccessMessage,
      markTaskDone,
      setTargetDate: handleSetTargetDate,
      generateSchedule,
      clearGenerateState,
      refetch: fetchData,
      setMode
    }
  }

  // Demo mode or while loading/error
  const isLiveMode = mode === 'live'

  const demoTasks =
    demoCompletedTaskIds.size === 0
      ? DEMO_SCHEDULE_ITEMS
      : DEMO_SCHEDULE_ITEMS.map((item) =>
          demoCompletedTaskIds.has(item.id)
            ? {
                ...item,
                status: 'done' as const,
                statusLabel: 'Done',
                isLocked: true
              }
            : item
        )

  return {
    mode,
    isLive: false,
    isLoading,
    error,
    isMissingConfig: !hasApiKey,
    isEmpty: false,
    isPlanNotFound: false,
    isGenerating,
    generateError,
    generateSuccessMessage,
    targetDate,
    formattedDate: formatDateIST(targetDate),
    kitchenName: DEMO_SCHEDULE_METADATA.kitchenName,
    planVersion: isLiveMode ? '—' : DEMO_SCHEDULE_SUMMARY.planVersion,
    summary: isLiveMode ? deriveSchedulePlanSummary(null, targetDate) : DEMO_SCHEDULE_SUMMARY,
    tasks: isLiveMode ? [] : demoTasks,
    lateOrderIds: isLiveMode ? [] : DEMO_SCHEDULE_PLAN.late_orders,
    isCompletingTask: completingTaskId !== null,
    completingTaskId,
    completeTaskError,
    completeTaskSuccessMessage,
    markTaskDone,
    setTargetDate: handleSetTargetDate,
    generateSchedule,
    clearGenerateState,
    refetch: fetchData,
    setMode
  }
}
