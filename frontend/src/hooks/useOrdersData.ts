/* ============================================================
   frontend/src/hooks/useOrdersData.ts
   OperAI / Cloud Kitchen Rescue — Orders Page Data Hook

   SOURCE OF TRUTH:
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data labels)
   - docs/Rest_API_Spec.md §3.5 (GET /api/orders)
   - docs/Database_Schema.md §3.6 (orders table)

   LIFECYCLE & SAFETY RULES:
   1. Requests verified GET /api/orders with cancellation signal.
   2. Handles Loading, Success, Empty, and Error states explicitly.
   3. NEVER silently falls back to mock data after a live API failure.
   4. Surfaces missing configuration (VITE_API_KEY) transparently.
   5. Explicit mode toggle between 'live' and 'demo' ensures transparent testing.
   6. Search, filter, and sort computations are deterministic code.
   ============================================================ */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { OrderChannelDTO } from '../types/dto.ts'
import type {
  OrderFilterTab,
  OrderSortDirection,
  OrderSortField,
  OrderViewModel,
  OrdersSummaryMetrics
} from '../types/orders.ts'
import { getOrders } from '../api/endpoints.ts'
import { apiClient as defaultApiClient, ApiClient, getDefaultConfig } from '../api/client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../api/errors.ts'
import {
  adaptOrdersToViewModels,
  deriveOrdersSummary,
  formatDeadlineDateIST,
  formatTimeIST
} from '../api/adapters/orderAdapter.ts'
import { DEMO_ORDERS, DEMO_ORDERS_METADATA } from '../pages/orders/ordersData.ts'
import { getTodayDateIST, formatOverviewDateIST } from './useOverviewData.ts'

export type OrdersMode = 'live' | 'demo'

export interface UseOrdersDataOptions {
  /** Target evaluation date in IST (YYYY-MM-DD); defaults to today in live mode, or demo date in demo mode */
  readonly date?: string
  /** Reference timestamp for relative deadline calculations (defaults to current clock in live mode, or simulated snapshot in demo mode) */
  readonly referenceTime?: Date
  /** Initial status filter */
  readonly initialStatus?: OrderFilterTab
  /** Custom ApiClient instance (e.g. for unit tests) */
  readonly client?: ApiClient
  /** Initial mode override */
  readonly initialMode?: OrdersMode
}

export interface OrdersDataResult {
  readonly mode: OrdersMode
  readonly isLoading: boolean
  readonly error: ApiError | ConfigurationError | NetworkError | Error | null
  readonly isMissingConfig: boolean
  readonly isLive: boolean
  readonly isEmpty: boolean
  readonly date: string
  readonly formattedDate: string
  readonly kitchenName: string
  readonly snapshotTime: string
  readonly shift: string
  readonly rawOrders: readonly OrderViewModel[]
  readonly filteredOrders: readonly OrderViewModel[]
  readonly summary: OrdersSummaryMetrics
  readonly searchQuery: string
  readonly statusFilter: OrderFilterTab
  readonly channelFilter: 'all' | OrderChannelDTO
  readonly sortField: OrderSortField
  readonly sortDirection: OrderSortDirection
  readonly selectedOrderId: string | null
  readonly selectedOrder: OrderViewModel | null
  readonly setSearchQuery: (query: string) => void
  readonly setStatusFilter: (status: OrderFilterTab) => void
  readonly setChannelFilter: (channel: 'all' | OrderChannelDTO) => void
  readonly setSortField: (field: OrderSortField) => void
  readonly setSortDirection: (dir: OrderSortDirection) => void
  readonly setSelectedOrderId: (id: string | null) => void
  readonly refetch: () => Promise<void>
  readonly setMode: (mode: OrdersMode) => void
}

export function useOrdersData(options?: UseOrdersDataOptions): OrdersDataResult {
  const customClient = options?.client
  const customDate = options?.date
  const customReferenceTime = options?.referenceTime
  const initialStatus = options?.initialStatus
  const initialMode = options?.initialMode

  const activeClient = customClient ?? defaultApiClient

  const envConfig = getDefaultConfig()
  const hasApiKey = Boolean(activeClient.config.apiKey ?? envConfig.apiKey)

  const [mode, setMode] = useState<OrdersMode>(() => {
    if (initialMode) return initialMode
    return hasApiKey ? 'live' : 'demo'
  })

  const targetDate = customDate ?? (mode === 'live' ? getTodayDateIST() : DEMO_ORDERS_METADATA.serviceDate)

  /**
   * Consistent reference time for deadline deltas:
   * - In demo mode: Anchored to the demo snapshot timestamp (e.g. 12:15 PM IST on 2026-10-17)
   * - In live mode: Uses current client clock or user-injected referenceTime
   */
  const effectiveReferenceTime: Date = useMemo(() => {
    if (customReferenceTime) {
      return customReferenceTime
    }
    if (mode === 'demo') {
      return new Date(DEMO_ORDERS_METADATA.simulatedNowIso)
    }
    return new Date()
  }, [customReferenceTime, mode])

  const [isLoading, setIsLoading] = useState<boolean>(mode === 'live')
  const [error, setError] = useState<ApiError | ConfigurationError | NetworkError | Error | null>(null)
  const [liveOrders, setLiveOrders] = useState<readonly OrderViewModel[] | null>(null)
  const [snapshotTime, setSnapshotTime] = useState<string>(
    mode === 'live' ? '' : DEMO_ORDERS_METADATA.snapshotTime
  )

  // Filters and sorting state
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<OrderFilterTab>(initialStatus ?? 'all')
  const [channelFilter, setChannelFilter] = useState<'all' | OrderChannelDTO>('all')
  const [sortField, setSortField] = useState<OrderSortField>('deadline')
  const [sortDirection, setSortDirection] = useState<OrderSortDirection>('asc')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

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
      // Query orders from verified API endpoint
      const res = await getOrders(
        { date: targetDate, limit: 100 },
        { signal: controller.signal, client: activeClient }
      )

      const liveNow = customReferenceTime ?? new Date()
      const adapted = adaptOrdersToViewModels(res.data, 'verified', liveNow)
      setLiveOrders(adapted)
      setSnapshotTime(`${formatTimeIST(liveNow.toISOString())} IST`)
      setError(null)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (err instanceof NetworkError && err.isAborted) {
        return
      }

      // Hard rule: NEVER silently fall back to mock data on API errors
      setError(err instanceof Error ? err : new Error(String(err)))
      setLiveOrders(null)
    } finally {
      setIsLoading(false)
    }
  }, [mode, targetDate, activeClient, customReferenceTime])

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

  const handleSetMode = useCallback((newMode: OrdersMode) => {
    setMode(newMode)
    if (newMode !== 'live') {
      setIsLoading(false)
      setError(null)
      setSnapshotTime(DEMO_ORDERS_METADATA.snapshotTime)
    }
  }, [])

  // Derive source orders based on mode with consistent reference timestamp
  const rawOrders: readonly OrderViewModel[] = useMemo(() => {
    if (mode === 'live') {
      return liveOrders ?? []
    }
    return adaptOrdersToViewModels(DEMO_ORDERS, 'simulated', effectiveReferenceTime)
  }, [mode, liveOrders, effectiveReferenceTime])

  // Derive operational summary metrics from raw orders
  const summary = useMemo(() => {
    return deriveOrdersSummary(rawOrders)
  }, [rawOrders])

  // Filter and sort orders
  const filteredOrders: readonly OrderViewModel[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    const result = rawOrders.filter((order) => {
      // Status filter
      if (statusFilter !== 'all' && order.status !== statusFilter) {
        return false
      }

      // Channel filter
      if (channelFilter !== 'all' && order.channel !== channelFilter) {
        return false
      }

      // Search query filter
      if (q.length > 0) {
        const matchesRef = order.ref.toLowerCase().includes(q)
        const matchesId = order.id.toLowerCase().includes(q)
        const matchesCustomer = order.customerName.toLowerCase().includes(q)
        const matchesChannel = order.channelLabel.toLowerCase().includes(q)
        const matchesItem = order.items.some((item) => item.name.toLowerCase().includes(q))
        if (!matchesRef && !matchesId && !matchesCustomer && !matchesChannel && !matchesItem) {
          return false
        }
      }

      return true
    })

    // Sort
    result.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'deadline': {
          const timeA = new Date(a.deadline).getTime()
          const timeB = new Date(b.deadline).getTime()
          comparison = timeA - timeB
          break
        }
        case 'totalAmount':
          comparison = a.totalAmount - b.totalAmount
          break
        case 'customerName':
          comparison = a.customerName.localeCompare(b.customerName)
          break
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return result
  }, [rawOrders, searchQuery, statusFilter, channelFilter, sortField, sortDirection])

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null
    return rawOrders.find((o) => o.id === selectedOrderId) ?? null
  }, [rawOrders, selectedOrderId])

  const isEmpty = mode === 'live' && liveOrders !== null && liveOrders.length === 0

  return {
    mode,
    isLoading,
    error,
    isMissingConfig: !hasApiKey,
    isLive: mode === 'live' && liveOrders !== null && error === null,
    isEmpty,
    date: targetDate,
    formattedDate: formatDeadlineDateIST(`${targetDate}T00:00:00+05:30`) || formatOverviewDateIST(targetDate),
    kitchenName: DEMO_ORDERS_METADATA.kitchenName,
    snapshotTime,
    shift: DEMO_ORDERS_METADATA.shift,
    rawOrders,
    filteredOrders,
    summary,
    searchQuery,
    statusFilter,
    channelFilter,
    sortField,
    sortDirection,
    selectedOrderId,
    selectedOrder,
    setSearchQuery,
    setStatusFilter,
    setChannelFilter,
    setSortField,
    setSortDirection,
    setSelectedOrderId,
    refetch: fetchData,
    setMode: handleSetMode
  }
}
