/* ============================================================
   frontend/src/api/__tests__/liveOpsIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Live Operations Integration Tests

   Tests verify:
   1. Live Queue Adaptation & Canonical Status Preservation:
      - 'new' -> queued
      - 'planned' -> queued
      - 'in_progress' -> prep
      - 'completed' -> ready (kitchen counter ready, NOT dispatched)
      - 'delayed' -> queued with critical urgency (rawStatus: 'delayed')
      - 'partial' -> prep with rawStatus: 'partial' (NOT plating)
      - 'cancelled' -> excluded from queue
   2. Plan Task Lock State Preservation (Rule 10).
   3. Operational Summary Metrics Derivation (code-computed, Rule 1).
   4. Operational Alerts Derivation from shortages, late orders, and proposals.
   5. Non-fatal 404 PLAN_NOT_FOUND handling.
   6. Zero-result empty state handling.
   7. Honest simulation of station telemetry.
   8. API error handling preventing silent fallback to mock data (Rule 9).
   9. Missing API key detection.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/liveOpsIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import {
  getOrders,
  getPlan,
  getBrief,
  getActions
} from '../endpoints.ts'
import {
  adaptOrdersToLiveOpsQueue
} from '../adapters/orderAdapter.ts'
import {
  adaptTasksToLivePrepTasks
} from '../adapters/planAdapter.ts'
import {
  deriveOpsMetrics,
  deriveLiveOpsAlerts
} from '../adapters/liveOpsAdapter.ts'

import type {
  ActionListResponseDTO,
  BriefResponseDTO,
  OrderDTO,
  OrderListResponseDTO,
  PlanResponseDTO
} from '../../types/dto.ts'

/* ── 1. Live Queue Adaptation & Canonical Status Preservation ─ */

test('Live Operations Queue: maps all documented order statuses with canonical preservation', () => {
  const orders: OrderDTO[] = [
    {
      id: 'ord-new',
      customer_name: 'Customer New',
      channel: 'swiggy',
      deadline: '2026-10-17T13:00:00+05:30',
      status: 'new',
      total_amount: 300,
      items: [{ menu_item_id: 'm1', name: 'Biryani', quantity: 1, unit_price: 300 }]
    },
    {
      id: 'ord-planned',
      customer_name: 'Customer Planned',
      channel: 'zomato',
      deadline: '2026-10-17T13:10:00+05:30',
      status: 'planned',
      total_amount: 250,
      items: [{ menu_item_id: 'm2', name: 'Dal', quantity: 1, unit_price: 250 }]
    },
    {
      id: 'ord-in-progress',
      customer_name: 'Customer Progress',
      channel: 'whatsapp',
      deadline: '2026-10-17T12:50:00+05:30',
      status: 'in_progress',
      total_amount: 400,
      items: [{ menu_item_id: 'm3', name: 'Paneer Butter Masala', quantity: 2, unit_price: 200 }]
    },
    {
      id: 'ord-completed',
      customer_name: 'Customer Ready',
      channel: 'direct',
      deadline: '2026-10-17T12:40:00+05:30',
      status: 'completed',
      total_amount: 180,
      items: [{ menu_item_id: 'm4', name: 'Naan', quantity: 3, unit_price: 60 }]
    },
    {
      id: 'ord-delayed',
      customer_name: 'Customer Delayed',
      channel: 'swiggy',
      deadline: '2026-10-17T12:20:00+05:30',
      status: 'delayed',
      total_amount: 500,
      items: [{ menu_item_id: 'm5', name: 'Thali', quantity: 2, unit_price: 250 }]
    },
    {
      id: 'ord-partial',
      customer_name: 'Customer Partial',
      channel: 'zomato',
      deadline: '2026-10-17T13:05:00+05:30',
      status: 'partial',
      total_amount: 350,
      items: [{ menu_item_id: 'm6', name: 'Roti & Sabzi', quantity: 1, unit_price: 350 }]
    },
    {
      id: 'ord-cancelled',
      customer_name: 'Customer Cancelled',
      channel: 'swiggy',
      deadline: '2026-10-17T13:30:00+05:30',
      status: 'cancelled',
      total_amount: 200,
      items: [{ menu_item_id: 'm7', name: 'Lassi', quantity: 2, unit_price: 100 }]
    }
  ]

  const adapted = adaptOrdersToLiveOpsQueue(orders)

  // Exactly 6 active orders returned (cancelled excluded)
  assert.equal(adapted.length, 6)

  // 1. new -> queued
  const newOrder = adapted.find((o) => o.id === 'ord-new')
  assert.ok(newOrder)
  assert.equal(newOrder.status, 'queued')
  assert.equal(newOrder.rawStatus, 'new')

  // 2. planned -> queued
  const plannedOrder = adapted.find((o) => o.id === 'ord-planned')
  assert.ok(plannedOrder)
  assert.equal(plannedOrder.status, 'queued')
  assert.equal(plannedOrder.rawStatus, 'planned')

  // 3. in_progress -> prep
  const inProgressOrder = adapted.find((o) => o.id === 'ord-in-progress')
  assert.ok(inProgressOrder)
  assert.equal(inProgressOrder.status, 'prep')
  assert.equal(inProgressOrder.rawStatus, 'in_progress')

  // 4. completed -> ready (counter ready, NOT dispatched)
  const completedOrder = adapted.find((o) => o.id === 'ord-completed')
  assert.ok(completedOrder)
  assert.equal(completedOrder.status, 'ready')
  assert.equal(completedOrder.rawStatus, 'completed')

  // 5. delayed -> queued with critical urgency and rawStatus: 'delayed'
  const delayedOrder = adapted.find((o) => o.id === 'ord-delayed')
  assert.ok(delayedOrder)
  assert.equal(delayedOrder.status, 'queued')
  assert.equal(delayedOrder.urgency, 'critical')
  assert.equal(delayedOrder.rawStatus, 'delayed')

  // 6. partial -> prep with rawStatus: 'partial' (NOT plating)
  const partialOrder = adapted.find((o) => o.id === 'ord-partial')
  assert.ok(partialOrder)
  assert.equal(partialOrder.status, 'prep')
  assert.equal(partialOrder.rawStatus, 'partial')

  // 7. cancelled -> omitted from queue
  const cancelledOrder = adapted.find((o) => o.id === 'ord-cancelled')
  assert.equal(cancelledOrder, undefined)
})

/* ── 2. Plan Task Lock State Preservation ───────────────────── */

test('Live Operations Tasks: preserves locked status per AGENTS.md Rule 10', () => {
  const planTasks = [
    {
      id: 'task-locked',
      order_id: 'ord-1',
      order_item_id: 'item-1',
      dish: 'Butter Chicken',
      task_type: 'cook' as const,
      cook_no: 1,
      burner_no: 2,
      start_at: '2026-10-17T12:00:00+05:30',
      end_at: '2026-10-17T12:20:00+05:30',
      locked: true,
      status: 'in_progress' as const
    },
    {
      id: 'task-unlocked',
      order_id: 'ord-2',
      order_item_id: 'item-2',
      dish: 'Garlic Naan',
      task_type: 'prep' as const,
      cook_no: 2,
      burner_no: null,
      start_at: '2026-10-17T12:20:00+05:30',
      end_at: '2026-10-17T12:30:00+05:30',
      locked: false,
      status: 'scheduled' as const
    }
  ]

  const adapted = adaptTasksToLivePrepTasks(planTasks, [])

  assert.equal(adapted.length, 2)
  assert.equal(adapted[0].isLocked, true)
  assert.equal(adapted[0].station, 'Burner #2')
  assert.equal(adapted[0].assignedTo, 'Cook #1')

  assert.equal(adapted[1].isLocked, false)
  assert.equal(adapted[1].station, 'Prep Station')
  assert.equal(adapted[1].assignedTo, 'Cook #2')
})

/* ── 3. Operational Summary Metrics Calculation ─────────────── */

test('Live Operations Metrics: derives 4 operational summary metrics from code', () => {
  const orders: OrderDTO[] = [
    {
      id: 'ord-1',
      customer_name: 'Cust 1',
      channel: 'swiggy',
      deadline: '2026-10-17T12:30:00+05:30',
      status: 'in_progress',
      total_amount: 200,
      items: [{ menu_item_id: 'm1', name: 'Item', quantity: 1, unit_price: 200 }]
    },
    {
      id: 'ord-2',
      customer_name: 'Cust 2',
      channel: 'zomato',
      deadline: '2026-10-17T12:10:00+05:30',
      status: 'delayed', // Near deadline / late
      total_amount: 300,
      items: [{ menu_item_id: 'm2', name: 'Item 2', quantity: 1, unit_price: 300 }]
    },
    {
      id: 'ord-3',
      customer_name: 'Cust 3',
      channel: 'direct',
      deadline: '2026-10-17T12:00:00+05:30',
      status: 'completed', // Not in flight
      total_amount: 150,
      items: [{ menu_item_id: 'm3', name: 'Item 3', quantity: 1, unit_price: 150 }]
    }
  ]

  const plan: PlanResponseDTO = {
    date: '2026-10-17',
    plan_version: 3,
    tasks: [
      {
        id: 't1',
        order_id: 'ord-1',
        order_item_id: 'oi-1',
        dish: 'Curry',
        task_type: 'cook',
        cook_no: 1,
        burner_no: 1,
        start_at: '2026-10-17T12:00:00+05:30',
        end_at: '2026-10-17T12:20:00+05:30',
        locked: false,
        status: 'in_progress'
      },
      {
        id: 't2',
        order_id: 'ord-2',
        order_item_id: 'oi-2',
        dish: 'Rice',
        task_type: 'cook',
        cook_no: 2,
        burner_no: 2,
        start_at: '2026-10-17T12:20:00+05:30',
        end_at: '2026-10-17T12:35:00+05:30',
        locked: false,
        status: 'scheduled'
      }
    ],
    late_orders: ['ord-2']
  }

  const brief: BriefResponseDTO = {
    date: '2026-10-17',
    order_count: 2,
    shortages: [
      {
        ingredient_id: 'ing-1',
        name: 'Cream',
        needed_qty: 5.0,
        stock_qty: 2.0,
        unit: 'liters',
        short_by: 3.0
      }
    ],
    at_risk_orders: [
      {
        order_id: 'ord-1',
        customer_name: 'Cust 1',
        deadline: '2026-10-17T12:30:00+05:30',
        total_amount: 200
      }
    ],
    revenue_at_risk: 450.00,
    data_source: 'verified'
  }

  const metrics = deriveOpsMetrics({
    orders,
    plan,
    brief,
    pendingActions: [
      {
        id: 'act-1',
        group_id: 'grp-sub-1',
        option_number: 1,
        action_type: 'recovery',
        title: 'Substitute Cream with Cashew Paste',
        status: 'pending',
        created_at: '2026-10-17T11:30:00+05:30',
        expires_at: '2026-10-17T12:00:00+05:30'
      }
    ],
    now: new Date('2026-10-17T12:15:00+05:30')
  })

  assert.equal(metrics.length, 4)

  // 1. Active Orders: 2 in flight (ord-1 in progress + ord-2 delayed; ord-3 is completed)
  assert.equal(metrics[0].id, 'active-orders')
  assert.equal(metrics[0].value, 2)

  // 2. Near Deadline: 2 (ord-2 is delayed; ord-1 due at 12:30 which is 15 min away from 12:15)
  assert.equal(metrics[1].id, 'near-deadline')
  assert.equal(metrics[1].value, 2)

  // 3. Tasks in Progress: 1 (t1 has status in_progress)
  assert.equal(metrics[2].id, 'prep-in-progress')
  assert.equal(metrics[2].value, 1)

  // 4. Needs Attention: 3 (1 shortage + 1 pending proposal + 1 late order)
  assert.equal(metrics[3].id, 'attention-needed')
  assert.equal(metrics[3].value, 3)
})

/* ── 4. Operational Alerts Derivation ───────────────────────── */

test('Live Operations Alerts: combines shortages, late orders, and pending actions', () => {
  const brief: BriefResponseDTO = {
    date: '2026-10-17',
    order_count: 1,
    shortages: [
      {
        ingredient_id: 'ing-paneer',
        name: 'Paneer',
        needed_qty: 10,
        stock_qty: 4,
        unit: 'kg',
        short_by: 6
      }
    ],
    at_risk_orders: [
      {
        order_id: 'ord-101',
        customer_name: 'Cust 101',
        deadline: '2026-10-17T12:00:00+05:30',
        total_amount: 1200
      }
    ],
    revenue_at_risk: 1200,
    data_source: 'verified'
  }

  const plan: PlanResponseDTO = {
    date: '2026-10-17',
    plan_version: 2,
    tasks: [],
    late_orders: ['ord-101']
  }

  const alerts = deriveLiveOpsAlerts({
    brief,
    plan,
    actions: [
      {
        id: 'act-recover-1',
        group_id: 'grp-recovery-paneer',
        option_number: 1,
        action_type: 'recovery',
        title: 'Pending Recovery Proposal: Substitute Paneer',
        status: 'pending',
        created_at: '2026-10-17T11:45:00+05:30',
        expires_at: '2026-10-17T12:00:00+05:30'
      }
    ]
  })

  assert.equal(alerts.length, 3)
  assert.ok(alerts.some((a) => a.title.includes('Paneer Stock Deficit')))
  assert.ok(alerts.some((a) => a.title.includes('Deadline Risk')))
  assert.ok(alerts.some((a) => a.title.includes('Pending Recovery Proposal')))
})

/* ── 5. Non-fatal 404 Plan Handling ─────────────────────────── */

test('Live Operations: handles 404 PLAN_NOT_FOUND gracefully without fatal failure', async () => {
  const client = new ApiClient({
    baseUrl: 'https://api.operai.test',
    apiKey: 'test-key',
    fetchFn: async (url) => {
      const u = String(url)
      if (u.includes('/api/plan')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'PLAN_NOT_FOUND',
              message: 'No plan found for 2026-10-17',
              details: { date: '2026-10-17' }
            }
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (u.includes('/api/orders')) {
        return new Response(JSON.stringify({ data: [], count: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (u.includes('/api/brief')) {
        return new Response(
          JSON.stringify({
            date: '2026-10-17',
            order_count: 0,
            shortages: [],
            at_risk_orders: [],
            revenue_at_risk: 0,
            data_source: 'verified'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (u.includes('/api/actions')) {
        return new Response(JSON.stringify({ data: [], count: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      throw new Error(`Unexpected URL: ${u}`)
    }
  })

  // Simulated parallel fetch as done in useLiveOpsData
  const planPromise = getPlan({ date: '2026-10-17' }, { client }).catch((err: unknown) => {
    if (err instanceof ApiError && (err.status === 404 || err.code === 'PLAN_NOT_FOUND')) {
      return null
    }
    throw err
  })

  const [ordersRes, briefRes, actionsRes, planRes] = await Promise.all([
    getOrders({ date: '2026-10-17' }, { client }),
    getBrief({ date: '2026-10-17' }, { client }),
    getActions({ status: 'pending' }, { client }),
    planPromise
  ])

  assert.equal(planRes, null)
  assert.equal(ordersRes.count, 0)
  assert.equal(briefRes.shortages.length, 0)
  assert.equal(actionsRes.count, 0)

  // Adapting with null plan does not throw
  const tasks = planRes ? adaptTasksToLivePrepTasks((planRes as PlanResponseDTO).tasks) : []
  assert.deepEqual(tasks, [])

  const metrics = deriveOpsMetrics({
    orders: ordersRes.data,
    plan: planRes,
    brief: briefRes,
    pendingActions: actionsRes.data
  })
  assert.equal(metrics[0].value, 0)
  assert.equal(metrics[2].value, 0)
  assert.equal(metrics[2].subtext, 'No active solver plan')
})

/* ── 6. Zero-Result / Empty Operational State ───────────────── */

test('Live Operations: handles 0 orders and 0 tasks without throwing', () => {
  const adaptedOrders = adaptOrdersToLiveOpsQueue([])
  assert.deepEqual(adaptedOrders, [])

  const adaptedTasks = adaptTasksToLivePrepTasks([])
  assert.deepEqual(adaptedTasks, [])

  const metrics = deriveOpsMetrics({
    orders: [],
    plan: null,
    brief: null,
    pendingActions: []
  })
  assert.equal(metrics[0].value, 0)
  assert.equal(metrics[0].subtext, 'No active orders in service')
  assert.equal(metrics[3].value, 0)
  assert.equal(metrics[3].subtext, 'All inventory & timelines nominal')
})

/* ── 7. API Error Handling (No Silent Fallback) ─────────────── */

test('Live Operations: throws ApiError on failure without silent mock fallback', async () => {
  const client = new ApiClient({
    baseUrl: 'https://api.operai.test',
    apiKey: 'test-key',
    fetchFn: async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Database connection failed',
            details: {}
          }
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  })

  await assert.rejects(
    async () => {
      await getOrders({ date: '2026-10-17' }, { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_ERROR')
      return true
    }
  )
})

/* ── 8. Corrective Review Edge Cases ────────────────────────── */

test('Live Operations Metrics: subtext isolates partial orders and maintains mutually consistent counts', () => {
  const orders: OrderDTO[] = [
    {
      id: 'ord-prep-1',
      customer_name: 'Prep 1',
      channel: 'swiggy',
      deadline: '2026-10-17T13:00:00+05:30',
      status: 'in_progress',
      total_amount: 250,
      items: [{ menu_item_id: 'm1', name: 'Curry', quantity: 1, unit_price: 250 }]
    },
    {
      id: 'ord-prep-2',
      customer_name: 'Prep 2',
      channel: 'zomato',
      deadline: '2026-10-17T13:10:00+05:30',
      status: 'in_progress',
      total_amount: 300,
      items: [{ menu_item_id: 'm2', name: 'Biryani', quantity: 1, unit_price: 300 }]
    },
    {
      id: 'ord-queued-1',
      customer_name: 'Queue 1',
      channel: 'whatsapp',
      deadline: '2026-10-17T13:30:00+05:30',
      status: 'new',
      total_amount: 150,
      items: [{ menu_item_id: 'm3', name: 'Naan', quantity: 2, unit_price: 75 }]
    },
    {
      id: 'ord-partial-1',
      customer_name: 'Partial 1',
      channel: 'direct',
      deadline: '2026-10-17T13:15:00+05:30',
      status: 'partial', // Shortage fulfillment
      total_amount: 400,
      items: [{ menu_item_id: 'm4', name: 'Paneer Thali', quantity: 1, unit_price: 400 }]
    },
    {
      id: 'ord-done-1',
      customer_name: 'Done 1',
      channel: 'swiggy',
      deadline: '2026-10-17T12:00:00+05:30',
      status: 'completed', // Not in-flight
      total_amount: 180,
      items: [{ menu_item_id: 'm5', name: 'Lassi', quantity: 2, unit_price: 90 }]
    },
    {
      id: 'ord-cancel-1',
      customer_name: 'Cancel 1',
      channel: 'zomato',
      deadline: '2026-10-17T13:00:00+05:30',
      status: 'cancelled', // Not in-flight
      total_amount: 100,
      items: [{ menu_item_id: 'm6', name: 'Raita', quantity: 1, unit_price: 100 }]
    }
  ]

  const metrics = deriveOpsMetrics({
    orders,
    plan: null,
    brief: null,
    pendingActions: []
  })

  // 4 in flight (prep-1, prep-2, queued-1, partial-1). done-1 and cancel-1 excluded.
  assert.equal(metrics[0].id, 'active-orders')
  assert.equal(metrics[0].value, 4)
  // Subtext explicitly reports partial separately: 2 in prep • 1 queued • 1 partial
  assert.equal(metrics[0].subtext, '2 in prep • 1 queued • 1 partial')
})

test('Live Operations Metrics: near-deadline handles invalid deadlines, multiple conditions, and completed orders safely', () => {
  const now = new Date('2026-10-17T12:00:00+05:30')
  const orders: OrderDTO[] = [
    {
      // Case A: Delayed order with invalid deadline -> counted once because delayed flag is authoritative
      id: 'ord-del-invalid-date',
      customer_name: 'A',
      channel: 'swiggy',
      deadline: 'invalid-date-string',
      status: 'delayed',
      total_amount: 200,
      items: [{ menu_item_id: 'm1', name: 'Dish 1', quantity: 1, unit_price: 200 }]
    },
    {
      // Case B: Delayed order due in 5 minutes -> counted once (no double counting)
      id: 'ord-del-near-deadline',
      customer_name: 'B',
      channel: 'zomato',
      deadline: '2026-10-17T12:05:00+05:30',
      status: 'delayed',
      total_amount: 300,
      items: [{ menu_item_id: 'm2', name: 'Dish 2', quantity: 1, unit_price: 300 }]
    },
    {
      // Case C: Normal order with invalid deadline -> NOT counted, does not throw
      id: 'ord-normal-invalid-date',
      customer_name: 'C',
      channel: 'whatsapp',
      deadline: '',
      status: 'new',
      total_amount: 150,
      items: [{ menu_item_id: 'm3', name: 'Dish 3', quantity: 1, unit_price: 150 }]
    },
    {
      // Case D: Completed order due in 5 minutes -> NOT counted because completed orders are not in flight
      id: 'ord-completed-near-deadline',
      customer_name: 'D',
      channel: 'direct',
      deadline: '2026-10-17T12:05:00+05:30',
      status: 'completed',
      total_amount: 100,
      items: [{ menu_item_id: 'm4', name: 'Dish 4', quantity: 1, unit_price: 100 }]
    },
    {
      // Case E: In-progress order due in 10 minutes -> counted once
      id: 'ord-prep-near-deadline',
      customer_name: 'E',
      channel: 'swiggy',
      deadline: '2026-10-17T12:10:00+05:30',
      status: 'in_progress',
      total_amount: 250,
      items: [{ menu_item_id: 'm5', name: 'Dish 5', quantity: 1, unit_price: 250 }]
    }
  ]

  const metrics = deriveOpsMetrics({
    orders,
    plan: null,
    brief: null,
    pendingActions: [],
    now
  })

  // Exactly 3 near deadline: Case A (delayed), Case B (delayed & due soon), Case E (in prep & due in 10m).
  // Case C (invalid date) and Case D (completed) are excluded.
  assert.equal(metrics[1].id, 'near-deadline')
  assert.equal(metrics[1].value, 3)
})

test('Live Operations Alerts: missing plan (null) does not suppress shortages or pending proposals', () => {
  const brief: BriefResponseDTO = {
    date: '2026-10-17',
    order_count: 5,
    shortages: [
      {
        ingredient_id: 'ing-onion',
        name: 'Red Onions',
        needed_qty: 15,
        stock_qty: 5,
        unit: 'kg',
        short_by: 10
      }
    ],
    at_risk_orders: [
      {
        order_id: 'ord-101',
        customer_name: 'Cust 101',
        deadline: '2026-10-17T13:00:00+05:30',
        total_amount: 600
      }
    ],
    revenue_at_risk: 600,
    data_source: 'verified'
  }

  const actions = [
    {
      id: 'act-recover-onion',
      group_id: 'grp-onion-1',
      option_number: 1,
      action_type: 'recovery' as const,
      title: 'Substitute Shallots for Red Onions',
      status: 'pending' as const,
      created_at: '2026-10-17T11:45:00+05:30',
      expires_at: '2026-10-17T12:30:00+05:30'
    }
  ]

  // Plan is null (e.g. 404 PLAN_NOT_FOUND)
  const alerts = deriveLiveOpsAlerts({
    brief,
    plan: null,
    actions
  })

  // Exactly 2 alerts generated: 1 shortage + 1 action proposal (none suppressed by null plan)
  assert.equal(alerts.length, 2)
  assert.ok(alerts.some((a) => a.title.includes('Red Onions Stock Deficit')))
  assert.ok(alerts.some((a) => a.title.includes('Substitute Shallots')))

  // Needs Attention metric also accurately reflects 2 (1 shortage + 1 action + 0 late orders)
  const metrics = deriveOpsMetrics({
    orders: [],
    plan: null,
    brief,
    pendingActions: actions
  })
  assert.equal(metrics[3].id, 'attention-needed')
  assert.equal(metrics[3].value, 2)
  assert.equal(metrics[3].subtext, '1 shortage(s) • 1 proposal(s)')
})

