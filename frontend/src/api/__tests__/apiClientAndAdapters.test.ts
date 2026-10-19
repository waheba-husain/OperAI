/* ============================================================
   frontend/src/api/__tests__/apiClientAndAdapters.test.ts
   OperAI / Cloud Kitchen Rescue — API Client & Adapter Unit Tests

   Runs on Node 24 native test runner without extra dependencies:
   node --test src/api/__tests__/apiClientAndAdapters.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError, ConfigurationError, NetworkError } from '../errors.ts'
import {
  adaptOrderToLiveOrder,
  mapOrderStatus
} from '../adapters/orderAdapter.ts'
import {
  adaptTaskToLivePrepTask,
  adaptTaskToOverviewItem,
  deriveWorkstationLabel
} from '../adapters/planAdapter.ts'
import {
  adaptBriefToAiBriefing,
  adaptShortageToIngredientAlert
} from '../adapters/briefAdapter.ts'
import {
  adaptActionToOpsAlert
} from '../adapters/actionAdapter.ts'
import { deriveOverviewKpis } from '../adapters/kpiAdapter.ts'

import type {
  BriefResponseDTO,
  OrderDTO,
  PlanTaskDTO,
  ProposedActionDTO,
  ShortageDTO
} from '../../types/dto.ts'

/* ── 1. API Client Tests ───────────────────────────────────── */

test('ApiClient: URL construction and query parameter formatting', () => {
  const client = new ApiClient({ baseUrl: 'http://localhost:8000', apiKey: 'test-key' })

  const url = client.buildUrl('/api/orders', {
    date: '2026-10-17',
    status: 'planned',
    limit: 50,
    ignoredUndefined: undefined,
    ignoredNull: null
  })

  assert.equal(
    url,
    'http://localhost:8000/api/orders?date=2026-10-17&status=planned&limit=50'
  )
})

test('ApiClient: throws ConfigurationError on invalid baseUrl', () => {
  assert.throws(
    () => new ApiClient({ baseUrl: 'not-a-valid-url' }),
    (err: unknown) => {
      assert(err instanceof ConfigurationError)
      assert.equal(err.missingKey, 'VITE_API_BASE_URL')
      return true
    }
  )
})

test('ApiClient: throws ConfigurationError when API key is missing for authenticated endpoints', async () => {
  const client = new ApiClient({ baseUrl: 'http://localhost:8000', apiKey: undefined })

  await assert.rejects(
    async () => {
      await client.get('/api/orders')
    },
    (err: unknown) => {
      assert(err instanceof ConfigurationError)
      assert.equal(err.missingKey, 'VITE_API_KEY')
      return true
    }
  )
})

test('ApiClient: attaches X-API-Key header to authenticated requests', async () => {
  let capturedHeaders: HeadersInit | undefined = undefined

  const mockFetch: typeof fetch = async (input, init) => {
    capturedHeaders = init?.headers
    return new Response(JSON.stringify({ data: [], count: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'demo-secret-key-123',
    fetchFn: mockFetch
  })

  const result = await client.get<{ count: number }>('/api/orders')
  assert.equal(result.count, 0)
  assert.equal((capturedHeaders as unknown as Record<string, string>)['X-API-Key'], 'demo-secret-key-123')
})

test('ApiClient: parses backend error envelope into ApiError', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'ACTION_NOT_PENDING',
          message: 'Action a1 was already executed.',
          details: { action_id: 'a1' }
        }
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await client.post('/api/actions/a1/approve', { confirm_option_number: 1 })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'ACTION_NOT_PENDING')
      assert.equal(err.message, 'Action a1 was already executed.')
      assert.deepEqual(err.details, { action_id: 'a1' })
      return true
    }
  )
})

test('ApiClient: maps fetch failures to NetworkError', async () => {
  const mockFetch: typeof fetch = async () => {
    throw new TypeError('Failed to fetch (ECONNREFUSED)')
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await client.get('/api/plan', { date: '2026-10-17' })
    },
    (err: unknown) => {
      assert(err instanceof NetworkError)
      assert.match(err.message, /Network failure connecting to/)
      return true
    }
  )
})

/* ── 2. Order Adapter Tests ────────────────────────────────── */

const sampleOrder: OrderDTO = {
  id: 'c8e2-4821-uuid',
  customer_name: 'Aarav Sharma',
  channel: 'whatsapp',
  deadline: '2026-10-17T12:30:00+05:30',
  status: 'planned',
  total_amount: 360.00,
  items: [
    { menu_item_id: 'm1', name: 'Paneer Biryani', quantity: 2, unit_price: 180.00 }
  ]
}

test('orderAdapter: adapts OrderDTO to LiveOrder preserving ID and formatting ref', () => {
  const now = new Date('2026-10-17T12:15:00+05:30')
  const liveOrder = adaptOrderToLiveOrder(sampleOrder, now)

  assert(liveOrder !== null)
  assert.equal(liveOrder.id, 'c8e2-4821-uuid')
  assert.equal(liveOrder.ref, '#ORD-C8E2')
  assert.equal(liveOrder.channel, 'WhatsApp')
  assert.equal(liveOrder.channelRef, 'Aarav Sharma • WhatsApp')
  assert.equal(liveOrder.status, 'queued')
  assert.equal(liveOrder.progressPct, 0)
  assert.equal(liveOrder.minutesUntilDue, 15)
  assert.equal(liveOrder.urgency, 'warning')
  assert.equal(liveOrder.items.length, 1)
  assert.equal(liveOrder.items[0].name, 'Paneer Biryani')
})

test('orderAdapter: maps completed to ready (NEVER dispatched)', () => {
  const completedOrder: OrderDTO = { ...sampleOrder, status: 'completed' }
  const liveOrder = adaptOrderToLiveOrder(completedOrder)

  assert(liveOrder !== null)
  assert.equal(liveOrder.status, 'ready')
  assert.notEqual(liveOrder.status, 'dispatched')
  assert.equal(liveOrder.progressPct, 100)
})

test('orderAdapter: partial and cancelled statuses return null (unresolved / excluded)', () => {
  assert.equal(mapOrderStatus('partial'), null)
  assert.equal(mapOrderStatus('cancelled'), null)

  const partialOrder: OrderDTO = { ...sampleOrder, status: 'partial' }
  assert.equal(adaptOrderToLiveOrder(partialOrder), null)

  const cancelledOrder: OrderDTO = { ...sampleOrder, status: 'cancelled' }
  assert.equal(adaptOrderToLiveOrder(cancelledOrder), null)
})

test('orderAdapter: maps delayed status to queued with critical urgency (NOT prep)', () => {
  const delayedOrder: OrderDTO = { ...sampleOrder, status: 'delayed' }
  const liveOrder = adaptOrderToLiveOrder(delayedOrder, new Date('2026-10-17T11:00:00+05:30'))

  assert(liveOrder !== null)
  // HARD RULE: Delayed orders are queued awaiting fulfillment, NOT actively cooking in prep
  assert.equal(liveOrder.status, 'queued')
  assert.notEqual(liveOrder.status, 'prep')
  assert.equal(liveOrder.urgency, 'critical')
})

test('orderAdapter: handles invalid deadline timestamps safely', () => {
  const invalidDateOrder: OrderDTO = { ...sampleOrder, deadline: 'invalid-iso-string' }
  const liveOrder = adaptOrderToLiveOrder(invalidDateOrder)

  assert(liveOrder !== null)
  assert.equal(liveOrder.dueTime, '—')
  assert.equal(liveOrder.minutesUntilDue, 0)
  assert.equal(liveOrder.urgency, 'normal')
})

/* ── 3. Plan Adapter Tests ─────────────────────────────────── */

const sampleTask: PlanTaskDTO = {
  id: 't-101',
  order_id: 'o-1',
  order_item_id: 'oi-1',
  dish: 'Paneer Biryani',
  task_type: 'cook',
  burner_no: 2,
  cook_no: 1,
  start_at: '2026-10-17T11:20:00+05:30',
  end_at: '2026-10-17T11:55:00+05:30',
  status: 'scheduled',
  locked: false
}

test('planAdapter: derives workstation label without fabricated stations table', () => {
  assert.equal(deriveWorkstationLabel(sampleTask), 'Burner #2')
  assert.equal(deriveWorkstationLabel({ ...sampleTask, task_type: 'prep', burner_no: null }), 'Prep Station')
  assert.equal(deriveWorkstationLabel({ ...sampleTask, task_type: 'pack', burner_no: null }), 'Packaging & Pass')
})

test('planAdapter: calculates duration and maps to LivePrepTask', () => {
  const liveTask = adaptTaskToLivePrepTask(sampleTask, [])

  assert(liveTask !== null)
  assert.equal(liveTask.id, 't-101')
  assert.equal(liveTask.durationMins, 35)
  assert.equal(liveTask.station, 'Burner #2')
  assert.equal(liveTask.assignedTo, 'Cook #1')
  assert.equal(liveTask.status, 'upcoming')
  assert.equal(liveTask.priority, 'medium')
})

test('planAdapter: marks priority as critical if order is in late_orders', () => {
  const liveTask = adaptTaskToLivePrepTask(sampleTask, ['o-1'])
  assert(liveTask !== null)
  assert.equal(liveTask.priority, 'critical')
})

test('planAdapter: preserves locked state in Overview PrepTaskItem', () => {
  const lockedTask: PlanTaskDTO = { ...sampleTask, locked: true, status: 'in_progress' }
  const overviewItem = adaptTaskToOverviewItem(lockedTask, [])

  assert(overviewItem !== null)
  assert.equal(overviewItem.status, 'locked')
  assert.equal(overviewItem.isLocked, true)
})

/* ── 4. Brief Adapter Tests ────────────────────────────────── */

const sampleShortage: ShortageDTO = {
  ingredient_id: 'ing_paneer',
  name: 'Paneer',
  unit: 'kg',
  stock_qty: 1.0,
  needed_qty: 1.92,
  short_by: 0.92
}

const sampleBrief: BriefResponseDTO = {
  date: '2026-10-17',
  order_count: 26,
  shortages: [sampleShortage],
  at_risk_orders: [
    { order_id: 'o-1', customer_name: 'Aarav', deadline: '2026-10-17T12:30:00+05:30', total_amount: 360 }
  ],
  revenue_at_risk: 1180.00,
  data_source: 'simulated'
}

test('briefAdapter: adapts ShortageDTO to IngredientAlert', () => {
  const alert = adaptShortageToIngredientAlert(sampleShortage, '2026-10-17T12:30:00+05:30', 4)

  assert.equal(alert.id, 'ing_paneer')
  assert.equal(alert.name, 'Paneer')
  assert.equal(alert.currentStock, '1 kg')
  assert.equal(alert.requiredStock, '1.92 kg')
  assert.equal(alert.deficit, '-0.92 kg')
  assert.equal(alert.urgency, 'critical')
  assert.equal(alert.affectedDishesCount, 4)
  assert.equal(alert.category, 'Kitchen Inventory')
})

test('briefAdapter: synthesizes AiKitchenBriefing observation', () => {
  const briefing = adaptBriefToAiBriefing(sampleBrief, 2)

  assert.equal(briefing.statusBadge, 'Attention Required')
  assert.equal(briefing.observations.length, 2)
  assert.match(briefing.observations[0].text, /1 shortage\(s\) detected \(Paneer\)/)
  assert.match(briefing.observations[1].text, /2 proposed action\(s\)/)
})

/* ── 5. Action Adapter Tests ───────────────────────────────── */

const sampleAction: ProposedActionDTO = {
  id: 'a1',
  group_id: 'g1',
  option_number: 1,
  action_type: 'recovery',
  title: 'Use tofu instead of paneer in 4 orders',
  status: 'pending',
  impact: {
    late_orders: 0,
    orders_protected: 4,
    extra_cost: -147.20,
    score: 0.82
  },
  base_plan_version: 4,
  expires_at: '2026-10-16T21:30:00+05:30'
}

test('actionAdapter: adapts ProposedActionDTO to OpsAlert', () => {
  const alert = adaptActionToOpsAlert(sampleAction)

  assert.equal(alert.id, 'a1')
  assert.equal(alert.title, 'Use tofu instead of paneer in 4 orders')
  assert.equal(alert.severity, 'warning')
  assert.match(alert.detail, /Protects 4 order\(s\); saves ₹147.20/)
  assert.match(alert.context, /Option #1/)
})

/* ── 6. KPI Adapter Tests ──────────────────────────────────── */

test('kpiAdapter: calculates Overview KPIs, excludes cancelled orders, and preserves honesty', () => {
  const cancelledOrder: OrderDTO = { ...sampleOrder, id: 'o-cancelled', status: 'cancelled', total_amount: 500 }
  const completedOrder: OrderDTO = { ...sampleOrder, id: 'o-2', status: 'completed', total_amount: 360 }

  const kpis = deriveOverviewKpis({
    // 2 valid orders (sampleOrder + completedOrder) = 720; 1 cancelled order (500) ignored
    orders: [sampleOrder, completedOrder, cancelledOrder],
    menuItems: [
      {
        id: 'm1',
        name: 'Paneer Biryani',
        price: 180,
        cost_breakdown: { ingredients: 72, packaging: 14, commission: 36, overhead: 21, total: 143 },
        profit_per_order: 37,
        margin_pct: 20.5,
        margin_status: 'below_target',
        is_active: true,
        data_source: 'simulated'
      },
      {
        id: 'm2-inactive',
        name: 'Seasonal Halwa',
        price: 100,
        cost_breakdown: { ingredients: 40, packaging: 10, commission: 20, overhead: 10, total: 80 },
        profit_per_order: 20,
        margin_pct: 20.0,
        margin_status: 'below_target',
        is_active: false, // Inactive dishes must be excluded from active catalog average
        data_source: 'simulated'
      }
    ],
    shortageCount: 1,
    pendingActionCount: 1
  })

  assert.equal(kpis.length, 4)

  // 1. Orders KPI: Must equal 2 (cancelled excluded)
  assert.equal(kpis[0].id, 'orders-today')
  assert.equal(kpis[0].value, '2')
  assert.match(kpis[0].supportingText, /1 ready • 0 in prep • 1 queued/)
  assert.equal(kpis[0].trend, undefined) // HARD RULE: No invented trend deltas

  // 2. Revenue KPI: Must equal 720 (360 + 360; cancelled 500 excluded)
  assert.equal(kpis[1].id, 'revenue-today')
  assert.equal(kpis[1].label, 'Gross Scheduled Order Value')
  assert.match(kpis[1].value, /720/)
  assert.match(kpis[1].supportingText, /excl\. cancelled/)

  // 3. Margin KPI: Average of active dishes (m1: 20.5%, m2 ignored)
  assert.equal(kpis[2].id, 'profit-margin')
  assert.equal(kpis[2].label, 'Avg Dish Margin (Catalog)')
  assert.equal(kpis[2].value, '20.5%')

  // 4. Attention KPI: 1 shortage + 1 proposal = 2
  assert.equal(kpis[3].id, 'orders-attention')
  assert.equal(kpis[3].value, '2')
})
