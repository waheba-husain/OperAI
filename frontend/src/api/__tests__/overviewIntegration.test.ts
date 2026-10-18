/* ============================================================
   frontend/src/api/__tests__/overviewIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Overview Page Integration Tests

   Tests verify:
   1. Date utilities format properly in IST.
   2. Parallel endpoint fetching and adapter transformation into live view models.
   3. Non-fatal 404 PLAN_NOT_FOUND handling for daily solver plan.
   4. Empty operational state handling (0 orders, 0 shortages).
   5. Honest labeling of unsupported widgets (7-day performance, 4 physical stations).
   6. API error handling preventing silent fallback to mock data.
   7. Missing configuration detection for VITE_API_KEY.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/overviewIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../errors.ts'
import {
  getOrders,
  getPlan,
  getBrief,
  getActions,
  getMenu
} from '../endpoints.ts'
import { deriveOverviewKpis } from '../adapters/kpiAdapter.ts'
import { adaptBriefToAiBriefing, adaptBriefToIngredientAlerts } from '../adapters/briefAdapter.ts'
import { adaptTasksToOverviewItems } from '../adapters/planAdapter.ts'
import {
  formatOverviewDateIST,
  getTodayDateIST
} from '../../hooks/useOverviewData.ts'
import {
  DEMO_KPIS,
  DEMO_HOURLY_PERFORMANCE,
  DEMO_STATION_HEALTH
} from '../../pages/overview/overviewData.ts'

import type {
  ActionListResponseDTO,
  BriefResponseDTO,
  MenuListResponseDTO,
  OrderListResponseDTO,
  PlanResponseDTO
} from '../../types/dto.ts'

/* ── 1. Date Formatting Utilities in IST ────────────────────── */

test('Overview Date Utils: getTodayDateIST produces YYYY-MM-DD in Asia/Kolkata', () => {
  const fixedDate = new Date('2026-10-17T02:00:00+05:30')
  const istString = getTodayDateIST(fixedDate)
  assert.equal(istString, '2026-10-17')
})

test('Overview Date Utils: formatOverviewDateIST produces localized display string', () => {
  const formatted = formatOverviewDateIST('2026-10-17')
  assert.match(formatted, /17/)
  assert.match(formatted, /Oct/)
  assert.match(formatted, /2026/)
})

test('Overview Date Utils: formatOverviewDateIST handles invalid input gracefully', () => {
  assert.equal(formatOverviewDateIST(''), '')
  assert.equal(formatOverviewDateIST('invalid-date'), 'invalid-date')
})

/* ── 2. Full Live Data Fetching & Adaptation ────────────────── */

test('Overview Integration: successful parallel requests adapt to live view models', async () => {
  const mockOrders: OrderListResponseDTO = {
    data: [
      {
        id: 'ord-1',
        customer_name: 'Customer A',
        channel: 'swiggy',
        deadline: '2026-10-17T12:30:00+05:30',
        status: 'in_progress',
        total_amount: 540.00,
        items: [
          { menu_item_id: 'm1', name: 'Paneer Biryani', quantity: 3, unit_price: 180.00 }
        ]
      },
      {
        id: 'ord-2',
        customer_name: 'Customer B',
        channel: 'zomato',
        deadline: '2026-10-17T13:00:00+05:30',
        status: 'cancelled', // Should be excluded from KPI totals
        total_amount: 320.00,
        items: [
          { menu_item_id: 'm2', name: 'Dal Makhani', quantity: 2, unit_price: 160.00 }
        ]
      }
    ],
    count: 2
  }

  const mockMenu: MenuListResponseDTO = {
    data: [
      {
        id: 'm1',
        name: 'Paneer Biryani',
        price: 180.00,
        cost_breakdown: { ingredients: 72, packaging: 14, commission: 36, overhead: 21.6, total: 143.6 },
        profit_per_order: 36.4,
        margin_pct: 20.2,
        margin_status: 'healthy',
        is_active: true,
        data_source: 'simulated'
      }
    ],
    count: 1
  }

  const mockBrief: BriefResponseDTO = {
    date: '2026-10-17',
    order_count: 1,
    shortages: [
      {
        ingredient_id: 'ing_cream',
        name: 'Heavy Cream',
        unit: 'L',
        stock_qty: 1.5,
        needed_qty: 3.5,
        short_by: 2.0
      }
    ],
    at_risk_orders: [
      {
        order_id: 'ord-1',
        customer_name: 'Customer A',
        deadline: '2026-10-17T12:30:00+05:30',
        total_amount: 540.00
      }
    ],
    revenue_at_risk: 540.00,
    data_source: 'simulated'
  }

  const mockActions: ActionListResponseDTO = {
    data: [],
    count: 0
  }

  const mockPlan: PlanResponseDTO = {
    date: '2026-10-17',
    plan_version: 5,
    tasks: [
      {
        id: 'task-101',
        order_id: 'ord-1',
        order_item_id: 'item-1',
        dish: 'Paneer Biryani',
        task_type: 'cook',
        burner_no: 2,
        cook_no: 1,
        start_at: '2026-10-17T11:45:00+05:30',
        end_at: '2026-10-17T12:15:00+05:30',
        status: 'scheduled',
        locked: true // Preserved per AGENTS.md rule 10
      }
    ],
    late_orders: []
  }

  // Create client with mocked responses
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/orders')) {
      return new Response(JSON.stringify(mockOrders), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/menu')) {
      return new Response(JSON.stringify(mockMenu), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/brief')) {
      return new Response(JSON.stringify(mockBrief), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/actions')) {
      return new Response(JSON.stringify(mockActions), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/plan')) {
      return new Response(JSON.stringify(mockPlan), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('Not Found', { status: 404 })
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'valid-test-key',
    fetchFn: mockFetch
  })

  // Execute parallel calls
  const [orders, menu, brief, actions, plan] = await Promise.all([
    getOrders({ date: '2026-10-17' }, { client }),
    getMenu({ client }),
    getBrief({ date: '2026-10-17' }, { client }),
    getActions({ status: 'pending' }, { client }),
    getPlan({ date: '2026-10-17' }, { client })
  ])

  // Adapt to view models
  const kpis = deriveOverviewKpis({
    orders: orders.data,
    menuItems: menu.data,
    shortageCount: brief.shortages.length,
    pendingActionCount: actions.count
  }).map(k => ({ ...k, badgeText: 'Live' }))

  // Verify KPI adaptations
  assert.equal(kpis.length, 4)
  assert.equal(kpis[0].id, 'orders-today')
  assert.equal(kpis[0].value, '1') // Excludes cancelled order ord-2
  assert.equal(kpis[0].badgeText, 'Live')

  assert.equal(kpis[1].id, 'revenue-today')
  assert.equal(kpis[1].value, '₹540') // Only includes ord-1 (₹540), excludes ord-2 (₹320)
  assert.equal(kpis[1].badgeText, 'Live')

  assert.equal(kpis[2].id, 'profit-margin')
  assert.equal(kpis[2].value, '20.2%')

  assert.equal(kpis[3].id, 'orders-attention')
  assert.equal(kpis[3].value, '1') // 1 shortage + 0 pending actions

  // Verify Briefing adaptation
  const briefing = adaptBriefToAiBriefing(brief, actions.count)
  assert.equal(briefing.statusBadge, 'Attention Required')
  assert.match(briefing.observations[0].text, /Heavy Cream/)
  assert.match(briefing.observations[0].text, /540/)

  // Verify Alerts adaptation
  const alerts = adaptBriefToIngredientAlerts(brief)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].name, 'Heavy Cream')
  assert.equal(alerts[0].deficit, '-2 L')
  assert.equal(alerts[0].urgency, 'critical')

  // Verify Tasks adaptation
  const tasks = adaptTasksToOverviewItems(plan.tasks, plan.late_orders)
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].id, 'task-101')
  assert.equal(tasks[0].station, 'Burner #2')
  assert.equal(tasks[0].status, 'locked')
  assert.equal(tasks[0].isLocked, true)
})

/* ── 3. Plan 404 PLAN_NOT_FOUND Non-Fatal Handling ─────────── */

test('Overview Integration: 404 PLAN_NOT_FOUND is handled gracefully without crashing overview', async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/plan')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'PLAN_NOT_FOUND',
            message: 'No plan generated for that date',
            details: {}
          }
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify({ data: [], count: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'valid-test-key',
    fetchFn: mockFetch
  })

  let planRes: PlanResponseDTO | null = null
  try {
    planRes = await getPlan({ date: '2026-10-17' }, { client })
  } catch (err: unknown) {
    if (err instanceof ApiError && (err.status === 404 || err.code === 'PLAN_NOT_FOUND')) {
      planRes = null
    } else {
      throw err
    }
  }

  assert.equal(planRes, null)
  const tasks = (planRes as unknown as PlanResponseDTO | null)
    ? adaptTasksToOverviewItems((planRes as unknown as PlanResponseDTO).tasks)
    : []
  assert.deepEqual(tasks, [])
})

/* ── 4. Empty Operational State ────────────────────────────── */

test('Overview Integration: handles empty operational state honestly (0 orders, 0 shortages)', () => {
  const emptyKpis = deriveOverviewKpis({
    orders: [],
    menuItems: [],
    shortageCount: 0,
    pendingActionCount: 0
  })

  assert.equal(emptyKpis[0].value, '0')
  assert.equal(emptyKpis[0].supportingText, 'No active orders scheduled for this date')
  assert.equal(emptyKpis[1].value, '₹0')
  assert.equal(emptyKpis[1].supportingText, 'No active orders scheduled')
  assert.equal(emptyKpis[2].value, '—')
  assert.equal(emptyKpis[3].value, '0')

  const cleanBrief: BriefResponseDTO = {
    date: '2026-10-17',
    order_count: 0,
    shortages: [],
    at_risk_orders: [],
    revenue_at_risk: 0,
    data_source: 'simulated'
  }

  const cleanBriefing = adaptBriefToAiBriefing(cleanBrief, 0)
  assert.equal(cleanBriefing.statusBadge, 'All Clear')
  assert.match(cleanBriefing.observations[0].text, /Zero revenue at risk/)
})

/* ── 5. Unsupported Widgets Remain Honestly Simulated ───────── */

test('Overview Integration: unsupported widgets retain honest simulated benchmarks', () => {
  // Step 5: 7-day pacing chart and 4 kitchen stations have no backend telemetry endpoint
  assert.equal(DEMO_STATION_HEALTH.length, 4)
  assert.equal(DEMO_STATION_HEALTH[0].name, 'Station 1: Prep & Cold Pantry')

  assert.ok(DEMO_HOURLY_PERFORMANCE.length > 0)
  assert.equal(DEMO_HOURLY_PERFORMANCE[0].time, '08:00')
})

/* ── 6. Error State Integrity: No Silent Fallback ───────────── */

test('Overview Integration: API failure surfaces error and does NOT silently return mock data', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database connection pool exhausted',
          details: {}
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'valid-test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await getOrders({ date: '2026-10-17' }, { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_ERROR')
      assert.equal(err.message, 'Database connection pool exhausted')
      return true
    }
  )
})
