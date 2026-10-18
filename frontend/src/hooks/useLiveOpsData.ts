/* ============================================================
   frontend/src/hooks/useLiveOpsData.ts
   OperAI / Cloud Kitchen Rescue — Live Operations Page Data Hook

   SOURCE OF TRUTH:
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels; Rule 10: Locked tasks)
   - docs/Rest_API_Spec.md (§3.5 Orders, §3.8 Plan, §3.9 Brief, §3.11 Actions)
   - frontend/docs/stage-2.1-corrective-audit.md
   - frontend/docs/stage-2.3-corrective-review.md
   - frontend/docs/stage-2.4a-overview-integration.md

   LIFECYCLE & STATE RULES:
   1. Requests verified endpoints in parallel (Orders, Plan, Brief, Actions).
   2. Handles Loading, Success, Empty, and Error states explicitly.
   3. NEVER silently falls back to mock data after a live API failure.
   4. Missing configuration (VITE_API_KEY) is surfaced clearly.
   5. Explicit mode toggle between 'live' and 'demo' ensures transparent testing.
   6. Station telemetry remains explicitly simulated (backend lacks physical stations entity).
   ============================================================ */

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  LiveOrder,
  LivePrepTask,
  LiveStation,
  OpsAlert,
  OpsMetric
} from '../types/liveOperations.ts'
import {
  LIVE_OPS_METADATA,
  LIVE_METRICS,
  LIVE_ORDERS,
  LIVE_PREP_TASKS,
  LIVE_STATIONS,
  LIVE_ALERTS
} from '../pages/liveOperations/liveOperationsData.ts'
import {
  getOrders,
  getPlan,
  getBrief,
  getActions
} from '../api/endpoints.ts'
import { apiClient as defaultApiClient, ApiClient, getDefaultConfig } from '../api/client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../api/errors.ts'
import { adaptOrdersToLiveOpsQueue, formatTimeIST } from '../api/adapters/orderAdapter.ts'
import { adaptTasksToLivePrepTasks } from '../api/adapters/planAdapter.ts'
import { deriveOpsMetrics, deriveLiveOpsAlerts } from '../api/adapters/liveOpsAdapter.ts'
import { getTodayDateIST, formatOverviewDateIST } from './useOverviewData.ts'

export type LiveOpsMode = 'live' | 'demo'

export interface UseLiveOpsDataOptions {
  /** Target evaluation date in IST (YYYY-MM-DD); defaults to current IST date */
  readonly date?: string
  /** Custom ApiClient instance (e.g. for unit tests) */
  readonly client?: ApiClient
  /** Initial mode override */
  readonly initialMode?: LiveOpsMode
}

export interface LiveOpsDataResult {
  readonly mode: LiveOpsMode
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly isMissingConfig: boolean
  readonly isLive: boolean
  readonly isEmpty: boolean
  readonly date: string
  readonly formattedDate: string
  readonly kitchenName: string
  readonly planVersion: string
  readonly snapshotTime: string
  readonly shift: string
  readonly metrics: readonly OpsMetric[]
  readonly orders: readonly LiveOrder[]
  readonly prepTasks: readonly LivePrepTask[]
  /** Station telemetry remains simulated per Stage 2.4B Step 5 */
  readonly stations: readonly LiveStation[]
  readonly alerts: readonly OpsAlert[]
  readonly rawOrdersCount: number
  readonly isPlanLoaded: boolean
  readonly refetch: () => Promise<void>
  readonly setMode: (mode: LiveOpsMode) => void
}

interface LivePayload {
  metrics: OpsMetric[]
  orders: LiveOrder[]
  prepTasks: LivePrepTask[]
  alerts: OpsAlert[]
  planVersion: string
  ordersCount: number
  isPlanLoaded: boolean
  snapshotTime: string
}

export function useLiveOpsData(options?: UseLiveOpsDataOptions): LiveOpsDataResult {
  const activeClient = options?.client ?? defaultApiClient
  const targetDate = options?.date ?? getTodayDateIST()

  // Detect whether API key is configured
  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  // Determine initial mode: if initialMode is explicitly specified, use it;
  // otherwise, default to 'live' if apiKey exists, or 'demo' if unconfigured.
  const [mode, setMode] = useState<LiveOpsMode>(() => {
    if (options?.initialMode) return options.initialMode
    return hasApiKey ? 'live' : 'demo'
  })

  const [isLoading, setIsLoading] = useState<boolean>(mode === 'live')
  const [error, setError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [livePayload, setLivePayload] = useState<LivePayload | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

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

    setIsLoading(true)
    setError(null)

    try {
      // 1. Fetch Plan (treat 404 PLAN_NOT_FOUND as non-fatal missing plan)
      const planPromise = getPlan({ date: targetDate }, { signal: controller.signal, client: activeClient })
        .catch((err: unknown) => {
          if (err instanceof ApiError && (err.status === 404 || err.code === 'PLAN_NOT_FOUND')) {
            return null
          }
          throw err
        })

      // 2. Fetch parallel endpoints
      const [ordersRes, briefRes, actionsRes, planRes] = await Promise.all([
        getOrders({ date: targetDate }, { signal: controller.signal, client: activeClient }),
        getBrief({ date: targetDate }, { signal: controller.signal, client: activeClient }),
        getActions({ status: 'pending' }, { signal: controller.signal, client: activeClient }),
        planPromise
      ])

      // 3. Adapt verified data to view models
      const adaptedOrders = adaptOrdersToLiveOpsQueue(ordersRes.data)
      const adaptedTasks = planRes ? adaptTasksToLivePrepTasks(planRes.tasks, planRes.late_orders) : []
      const adaptedMetrics = deriveOpsMetrics({
        orders: ordersRes.data,
        plan: planRes,
        brief: briefRes,
        pendingActions: actionsRes.data
      })
      const adaptedAlerts = deriveLiveOpsAlerts({
        brief: briefRes,
        actions: actionsRes.data,
        plan: planRes
      })

      const planVersion = planRes ? `Plan v${planRes.plan_version}` : 'No Active Plan'
      const snapshotTime = `${formatTimeIST(new Date().toISOString())} IST`

      setLivePayload({
        metrics: adaptedMetrics,
        orders: adaptedOrders,
        prepTasks: adaptedTasks,
        alerts: adaptedAlerts,
        planVersion,
        ordersCount: ordersRes.count,
        isPlanLoaded: planRes !== null,
        snapshotTime
      })
      setError(null)
    } catch (err: unknown) {
      // Ignore abort errors from cleanup
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (err instanceof NetworkError && err.isAborted) {
        return
      }

      // Hard rule: NEVER silently fall back to mock data on API errors
      setError(err instanceof Error ? err : new Error(String(err)))
      setLivePayload(null)
    } finally {
      setIsLoading(false)
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
    livePayload.ordersCount === 0 &&
    livePayload.prepTasks.length === 0

  if (mode === 'live' && livePayload) {
    return {
      mode: 'live',
      isLoading,
      error,
      isMissingConfig: !hasApiKey,
      isLive: true,
      isEmpty,
      date: targetDate,
      formattedDate: formatOverviewDateIST(targetDate),
      kitchenName: LIVE_OPS_METADATA.kitchenName,
      planVersion: livePayload.planVersion,
      snapshotTime: livePayload.snapshotTime,
      shift: `Live Service · ${formatOverviewDateIST(targetDate)}`,
      metrics: livePayload.metrics,
      orders: livePayload.orders,
      prepTasks: livePayload.prepTasks,
      // Stations remain explicitly simulated per Stage 2.4B Step 5
      stations: LIVE_STATIONS,
      alerts: livePayload.alerts,
      rawOrdersCount: livePayload.ordersCount,
      isPlanLoaded: livePayload.isPlanLoaded,
      refetch: fetchData,
      setMode
    }
  }

  // Demo mode or while loading/error
  return {
    mode,
    isLoading,
    error,
    isMissingConfig: !hasApiKey,
    isLive: false,
    isEmpty: false,
    date: targetDate,
    formattedDate: formatOverviewDateIST(targetDate),
    kitchenName: LIVE_OPS_METADATA.kitchenName,
    planVersion: LIVE_OPS_METADATA.planVersion,
    snapshotTime: LIVE_OPS_METADATA.snapshotTime,
    shift: LIVE_OPS_METADATA.shift,
    metrics: mode === 'live' && error ? [] : LIVE_METRICS,
    orders: mode === 'live' && error ? [] : LIVE_ORDERS,
    prepTasks: mode === 'live' && error ? [] : LIVE_PREP_TASKS,
    stations: LIVE_STATIONS,
    alerts: mode === 'live' && error ? [] : LIVE_ALERTS,
    rawOrdersCount: LIVE_ORDERS.length,
    isPlanLoaded: true,
    refetch: fetchData,
    setMode
  }
}
