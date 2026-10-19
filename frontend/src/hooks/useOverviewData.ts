/* ============================================================
   frontend/src/hooks/useOverviewData.ts
   OperAI / Cloud Kitchen Rescue — Overview Page Data Hook

   SOURCE OF TRUTH:
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels)
   - docs/Rest_API_Spec.md (§3.3 Menu, §3.5 Orders, §3.8 Plan, §3.9 Brief, §3.11 Actions)
   - frontend/docs/stage-2.1-corrective-audit.md
   - frontend/docs/stage-2.3-corrective-review.md

   LIFECYCLE & STATE RULES:
   1. Requests verified endpoints in parallel (Orders, Plan, Brief, Actions, Menu).
   2. Handles Loading, Success, Empty, and Error states explicitly.
   3. NEVER silently falls back to mock data after a live API failure.
   4. Missing configuration (VITE_API_KEY) is surfaced clearly.
   5. Explicit mode toggle between 'live' and 'demo' ensures transparent testing.
   ============================================================ */

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  KpiItem,
  AiKitchenBriefing,
  HourlyPerformancePoint,
  StationHealth,
  IngredientAlert,
  PrepTaskItem
} from '../types/overview'
import {
  DEMO_METADATA,
  DEMO_KPIS,
  DEMO_AI_BRIEFING,
  DEMO_HOURLY_PERFORMANCE,
  DEMO_STATION_HEALTH,
  DEMO_INGREDIENT_ALERTS,
  DEMO_PREP_TASKS
} from '../pages/overview/overviewData.ts'
import {
  getOrders,
  getPlan,
  getBrief,
  getActions,
  getMenu
} from '../api/endpoints.ts'
import { apiClient as defaultApiClient, ApiClient, getDefaultConfig } from '../api/client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../api/errors.ts'
import { deriveOverviewKpis } from '../api/adapters/kpiAdapter.ts'
import { adaptBriefToAiBriefing, adaptBriefToIngredientAlerts } from '../api/adapters/briefAdapter.ts'
import { adaptTasksToOverviewItems } from '../api/adapters/planAdapter.ts'

export type OverviewMode = 'live' | 'demo'

export interface UseOverviewDataOptions {
  /** Target evaluation date in IST (YYYY-MM-DD); defaults to current IST date */
  readonly date?: string
  /** Custom ApiClient instance (e.g. for unit tests) */
  readonly client?: ApiClient
  /** Initial mode override */
  readonly initialMode?: OverviewMode
}

export interface OverviewDataResult {
  readonly mode: OverviewMode
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly isMissingConfig: boolean
  readonly isLive: boolean
  readonly isEmpty: boolean
  readonly date: string
  readonly formattedDate: string
  readonly kitchenName: string
  readonly planVersion: string
  readonly kpis: readonly KpiItem[]
  readonly aiBriefing: AiKitchenBriefing
  readonly ingredientAlerts: readonly IngredientAlert[]
  readonly prepTasks: readonly PrepTaskItem[]
  /** Performance data remains simulated per Stage 2.4A Step 5 */
  readonly performanceData: readonly HourlyPerformancePoint[]
  /** Station telemetry remains simulated per Stage 2.4A Step 5 */
  readonly stationHealth: readonly StationHealth[]
  readonly avgStationUtilization: number | null
  readonly rawOrdersCount: number
  readonly isPlanLoaded: boolean
  readonly refetch: () => Promise<void>
  readonly setMode: (mode: OverviewMode) => void
}

/**
 * Returns the current date in Asia/Kolkata (IST) in ISO format YYYY-MM-DD.
 */
export function getTodayDateIST(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

/**
 * Formats a YYYY-MM-DD string into an IST display string (e.g. "Saturday, 17 Oct 2026").
 */
export function formatOverviewDateIST(dateStr: string): string {
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

interface LivePayload {
  kpis: KpiItem[]
  aiBriefing: AiKitchenBriefing
  ingredientAlerts: IngredientAlert[]
  prepTasks: PrepTaskItem[]
  planVersion: string
  ordersCount: number
  isPlanLoaded: boolean
}

export function useOverviewData(options?: UseOverviewDataOptions): OverviewDataResult {
  const activeClient = options?.client ?? defaultApiClient
  const targetDate = options?.date ?? getTodayDateIST()

  // Detect whether API key is configured
  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  // Determine initial mode: if initialMode is explicitly specified, use it;
  // otherwise, default to 'live' if apiKey exists, or 'demo' if unconfigured.
  const [mode, setMode] = useState<OverviewMode>(() => {
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
      const [ordersRes, briefRes, actionsRes, menuRes, planRes] = await Promise.all([
        getOrders({ date: targetDate }, { signal: controller.signal, client: activeClient }),
        getBrief({ date: targetDate }, { signal: controller.signal, client: activeClient }),
        getActions({ status: 'pending' }, { signal: controller.signal, client: activeClient }),
        getMenu({ signal: controller.signal, client: activeClient }),
        planPromise
      ])

      // 3. Adapt verified data to view models
      const adaptedKpis = deriveOverviewKpis({
        orders: ordersRes.data,
        menuItems: menuRes.data,
        shortageCount: briefRes.shortages.length,
        pendingActionCount: actionsRes.count
      }).map((kpi) => ({
        ...kpi,
        badgeText: 'Live'
      }))

      const adaptedBriefing = adaptBriefToAiBriefing(briefRes, actionsRes.count)
      const adaptedAlerts = adaptBriefToIngredientAlerts(briefRes)
      const adaptedTasks = planRes ? adaptTasksToOverviewItems(planRes.tasks, planRes.late_orders) : []
      const planVersion = planRes ? `Plan v${planRes.plan_version}` : 'No Active Plan'

      setLivePayload({
        kpis: adaptedKpis,
        aiBriefing: adaptedBriefing,
        ingredientAlerts: adaptedAlerts,
        prepTasks: adaptedTasks,
        planVersion,
        ordersCount: ordersRes.count,
        isPlanLoaded: planRes !== null
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

  // Derive average station utilization from station health (simulated benchmark)
  const avgStationUtilization = DEMO_STATION_HEALTH.length > 0
    ? Math.round(
        DEMO_STATION_HEALTH.reduce((sum, s) => sum + s.utilizationPct, 0) / DEMO_STATION_HEALTH.length
      )
    : null

  // Empty state check for live data
  const isEmpty = mode === 'live' && livePayload !== null && livePayload.ordersCount === 0 && livePayload.prepTasks.length === 0

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
      kitchenName: DEMO_METADATA.kitchenName,
      planVersion: livePayload.planVersion,
      kpis: livePayload.kpis,
      aiBriefing: livePayload.aiBriefing,
      ingredientAlerts: livePayload.ingredientAlerts,
      prepTasks: livePayload.prepTasks,
      // Unsupported widgets remain explicitly simulated per Step 5
      performanceData: DEMO_HOURLY_PERFORMANCE,
      stationHealth: DEMO_STATION_HEALTH,
      avgStationUtilization,
      rawOrdersCount: livePayload.ordersCount,
      isPlanLoaded: livePayload.isPlanLoaded,
      refetch: fetchData,
      setMode
    }
  }

  // Demo mode or fallback while loading/error
  return {
    mode,
    isLoading,
    error,
    isMissingConfig: !hasApiKey,
    isLive: false,
    isEmpty: false,
    date: targetDate,
    formattedDate: formatOverviewDateIST(targetDate),
    kitchenName: DEMO_METADATA.kitchenName,
    planVersion: DEMO_METADATA.planVersion,
    kpis: DEMO_KPIS,
    aiBriefing: DEMO_AI_BRIEFING,
    ingredientAlerts: DEMO_INGREDIENT_ALERTS,
    prepTasks: DEMO_PREP_TASKS,
    performanceData: DEMO_HOURLY_PERFORMANCE,
    stationHealth: DEMO_STATION_HEALTH,
    avgStationUtilization,
    rawOrdersCount: DEMO_KPIS.length,
    isPlanLoaded: true,
    refetch: fetchData,
    setMode
  }
}
