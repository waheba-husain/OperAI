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
import type { OrderDTO, PlanResponseDTO } from '../types/dto.ts'
import type { SchedulePlanSummary, ScheduleTaskItem } from '../types/schedulePlan.ts'
import {
  apiClient as defaultApiClient,
  ApiClient,
  getDefaultConfig,
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
  readonly targetDate: string
  readonly formattedDate: string
  readonly kitchenName: string
  readonly planVersion: string
  readonly summary: SchedulePlanSummary
  readonly tasks: readonly ScheduleTaskItem[]
  readonly lateOrderIds: readonly string[]
  readonly setTargetDate: (newDate: string) => void
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

  useEffect(() => {
    fetchData()
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
      targetDate,
      formattedDate: formatDateIST(targetDate),
      kitchenName: DEMO_SCHEDULE_METADATA.kitchenName,
      planVersion: livePayload.summary.planVersion,
      summary: livePayload.summary,
      tasks: livePayload.tasks,
      lateOrderIds: livePayload.plan?.late_orders ?? [],
      setTargetDate,
      refetch: fetchData,
      setMode
    }
  }

  // Demo mode or while loading/error
  const isLiveMode = mode === 'live'

  return {
    mode,
    isLive: false,
    isLoading,
    error,
    isMissingConfig: !hasApiKey,
    isEmpty: false,
    isPlanNotFound: false,
    targetDate,
    formattedDate: formatDateIST(targetDate),
    kitchenName: DEMO_SCHEDULE_METADATA.kitchenName,
    planVersion: isLiveMode ? '—' : DEMO_SCHEDULE_SUMMARY.planVersion,
    summary: isLiveMode ? deriveSchedulePlanSummary(null, targetDate) : DEMO_SCHEDULE_SUMMARY,
    tasks: isLiveMode ? [] : DEMO_SCHEDULE_ITEMS,
    lateOrderIds: isLiveMode ? [] : DEMO_SCHEDULE_PLAN.late_orders,
    setTargetDate,
    refetch: fetchData,
    setMode
  }
}
