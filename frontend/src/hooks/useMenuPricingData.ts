/* ============================================================
   frontend/src/hooks/useMenuPricingData.ts
   OperAI / Cloud Kitchen Rescue — Menu & Pricing Data Hook

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.3 (GET /api/menu)
   - docs/Rest_API_Spec.md §3.4 (POST /api/pricing/analyze)
   - docs/Database_Schema.md §3.3 (menu_items)
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels)

   RULES:
   1. Requests verified GET /api/menu with AbortSignal cancellation.
   2. Handles Loading, Error, Empty, and Success states explicitly.
   3. NEVER silently falls back to mock data after a live API failure.
   4. Clear separation between catalog retrieval and pricing what-if analysis.
   5. Pricing analysis is simulation-only; does not mutate live catalog prices.
   ============================================================ */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  MenuActiveFilter,
  MenuMarginFilter,
  MenuItemViewModel,
  MenuSortDirection,
  MenuSortField,
  MenuSummaryMetrics,
  PricingAnalysisViewModel
} from '../types/menuPricing.ts'
import { getMenu, analyzePricing } from '../api/endpoints.ts'
import { apiClient as defaultApiClient, ApiClient, getDefaultConfig } from '../api/client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../api/errors.ts'
import {
  adaptMenuItemsToViewModels,
  adaptPricingAnalysisToViewModel,
  calculateSimulatedPricingAnalysis,
  deriveMenuSummary
} from '../api/adapters/menuAdapter.ts'
import { DEMO_MENU_ITEMS, DEMO_MENU_METADATA } from '../pages/menuPricing/menuPricingData.ts'

export type MenuPricingMode = 'live' | 'demo'

export interface UseMenuPricingDataOptions {
  /** Custom ApiClient instance (e.g. for unit tests) */
  readonly client?: ApiClient
  /** Initial mode override */
  readonly initialMode?: MenuPricingMode
  /** Initial search query */
  readonly initialSearch?: string
  /** Initial margin filter */
  readonly initialMarginFilter?: MenuMarginFilter
}

export interface MenuPricingDataResult {
  readonly mode: MenuPricingMode
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly isMissingConfig: boolean
  readonly isLive: boolean
  readonly kitchenName: string
  readonly snapshotTime: string
  readonly rawMenuItems: readonly MenuItemViewModel[]
  readonly filteredMenuItems: readonly MenuItemViewModel[]
  readonly summary: MenuSummaryMetrics
  readonly searchQuery: string
  readonly marginFilter: MenuMarginFilter
  readonly activeFilter: MenuActiveFilter
  readonly sortField: MenuSortField
  readonly sortDirection: MenuSortDirection
  readonly selectedDishId: string | null
  readonly selectedDish: MenuItemViewModel | null
  readonly analyzingDishId: string | null
  readonly analysisResult: PricingAnalysisViewModel | null
  readonly analysisLoading: boolean
  readonly analysisError: Error | null
  readonly setSearchQuery: (query: string) => void
  readonly setMarginFilter: (filter: MenuMarginFilter) => void
  readonly setActiveFilter: (filter: MenuActiveFilter) => void
  readonly setSortField: (field: MenuSortField) => void
  readonly setSortDirection: (dir: MenuSortDirection) => void
  readonly setSelectedDishId: (id: string | null) => void
  readonly analyzeDishPrice: (dishId: string, customPrice?: number) => Promise<void>
  readonly clearAnalysis: () => void
  readonly refetch: () => Promise<void>
  readonly setMode: (mode: MenuPricingMode) => void
}

export function useMenuPricingData(options?: UseMenuPricingDataOptions): MenuPricingDataResult {
  const customClient = options?.client
  const initialMode = options?.initialMode
  const initialSearch = options?.initialSearch
  const initialMarginFilter = options?.initialMarginFilter

  const activeClient = customClient ?? defaultApiClient

  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  const [mode, setMode] = useState<MenuPricingMode>(() => {
    if (initialMode) return initialMode
    return hasApiKey ? 'live' : 'demo'
  })

  const [isLoading, setIsLoading] = useState<boolean>(mode === 'live')
  const [error, setError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [liveItems, setLiveItems] = useState<readonly MenuItemViewModel[] | null>(null)
  const [snapshotTime, setSnapshotTime] = useState<string>(
    mode === 'live' ? '' : DEMO_MENU_METADATA.snapshotTime
  )

  // Filters & sorting
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch ?? '')
  const [marginFilter, setMarginFilter] = useState<MenuMarginFilter>(initialMarginFilter ?? 'all')
  const [activeFilter, setActiveFilter] = useState<MenuActiveFilter>('all')
  const [sortField, setSortField] = useState<MenuSortField>('margin')
  const [sortDirection, setSortDirection] = useState<MenuSortDirection>('asc')
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null)

  // Pricing analysis state
  const [analyzingDishId, setAnalyzingDishId] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<PricingAnalysisViewModel | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState<boolean>(false)
  const [analysisError, setAnalysisError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (mode !== 'live') {
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const res = await getMenu({ signal: controller.signal, client: activeClient })
      const adapted = adaptMenuItemsToViewModels(res.data, 'verified')
      setLiveItems(adapted)
      setSnapshotTime('Live API catalog — Verified backend')
      setError(null)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (err instanceof NetworkError && err.isAborted) {
        return
      }

      // Hard rule: NEVER silently fall back to mock data on live errors
      setError(err instanceof Error ? err : new Error(String(err)))
      setLiveItems(null)
    } finally {
      setIsLoading(false)
    }
  }, [mode, activeClient])

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

  // Catalog items based on mode
  const rawMenuItems: readonly MenuItemViewModel[] = useMemo(() => {
    if (mode === 'live') {
      return liveItems ?? []
    }
    return adaptMenuItemsToViewModels(DEMO_MENU_ITEMS, 'simulated')
  }, [mode, liveItems])

  // Summary economics
  const summary: MenuSummaryMetrics = useMemo(() => {
    return deriveMenuSummary(rawMenuItems)
  }, [rawMenuItems])

  // Search, filter, and sort
  const filteredMenuItems: readonly MenuItemViewModel[] = useMemo(() => {
    let list = [...rawMenuItems]

    // Search query
    const q = searchQuery.trim().toLowerCase()
    if (q.length > 0) {
      list = list.filter((item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
    }

    // Margin status filter
    if (marginFilter !== 'all') {
      list = list.filter((item) => item.marginStatus === marginFilter)
    }

    // Active status filter
    if (activeFilter === 'active') {
      list = list.filter((item) => item.isActive)
    } else if (activeFilter === 'inactive') {
      list = list.filter((item) => !item.isActive)
    }

    // Sorting
    list.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'price':
          comparison = a.price - b.price
          break
        case 'profit': {
          const valA = a.profitPerOrder ?? -Infinity
          const valB = b.profitPerOrder ?? -Infinity
          comparison = valA - valB
          break
        }
        case 'margin': {
          const valA = a.marginPct ?? -Infinity
          const valB = b.marginPct ?? -Infinity
          comparison = valA - valB
          break
        }
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return list
  }, [rawMenuItems, searchQuery, marginFilter, activeFilter, sortField, sortDirection])

  const selectedDish: MenuItemViewModel | null = useMemo(() => {
    if (!selectedDishId) return null
    return rawMenuItems.find((item) => item.id === selectedDishId) ?? null
  }, [rawMenuItems, selectedDishId])

  // Interactive pricing analysis function
  const analyzeDishPrice = useCallback(
    async (dishId: string, customPrice?: number) => {
      setAnalyzingDishId(dishId)
      setAnalysisLoading(true)
      setAnalysisError(null)

      try {
        if (mode === 'live') {
          const res = await analyzePricing(
            {
              menu_item_id: dishId,
              ...(customPrice !== undefined ? { price: customPrice } : {}),
              propose_change: false
            },
            { client: activeClient }
          )
          setAnalysisResult(adaptPricingAnalysisToViewModel(res))
        } else {
          // Demo mode calculation using exact spec
          const demoItem = DEMO_MENU_ITEMS.find((d) => d.id === dishId)
          if (!demoItem) {
            throw new Error(`Dish with ID ${dishId} was not found in catalog.`)
          }
          const simulated = calculateSimulatedPricingAnalysis(
            demoItem,
            customPrice,
            DEMO_MENU_METADATA.assumptions
          )
          setAnalysisResult(adaptPricingAnalysisToViewModel(simulated))
        }
      } catch (err: unknown) {
        setAnalysisError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setAnalysisLoading(false)
      }
    },
    [mode, activeClient]
  )

  const clearAnalysis = useCallback(() => {
    setAnalyzingDishId(null)
    setAnalysisResult(null)
    setAnalysisError(null)
  }, [])

  return {
    mode,
    isLoading,
    error,
    isMissingConfig: !hasApiKey,
    isLive: mode === 'live',
    kitchenName: DEMO_MENU_METADATA.kitchenName,
    snapshotTime,
    rawMenuItems,
    filteredMenuItems,
    summary,
    searchQuery,
    marginFilter,
    activeFilter,
    sortField,
    sortDirection,
    selectedDishId,
    selectedDish,
    analyzingDishId,
    analysisResult,
    analysisLoading,
    analysisError,
    setSearchQuery,
    setMarginFilter,
    setActiveFilter,
    setSortField,
    setSortDirection,
    setSelectedDishId,
    analyzeDishPrice,
    clearAnalysis,
    refetch: fetchData,
    setMode
  }
}
