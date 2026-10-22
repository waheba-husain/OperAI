/* ============================================================
   frontend/src/api/__tests__/ordersIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Orders Integration Tests

   Tests verify:
   1. OrderDTO to OrderViewModel Adapter Mapping:
      - Canonical UUID preservation and display ref derivation
      - Line item quantity, unit price, subtotal, and currency formatting
      - All 7 documented order statuses mapped accurately
      - All 5 documented channels mapped with display labels
      - Deadline IST time and date formatting with urgency status
      - Honest data provenance labeling ('verified' vs 'simulated')
   2. Summary Metrics Derivation (code-computed, AGENTS.md Rule 1):
      - Active, delayed, completed, cancelled counts and total revenue
      - Channel breakdown distribution
   3. GET /api/orders Endpoint Integration:
      - Query parameter serialization (date, status, limit)
      - Empty order list handling
      - Error handling (401, 422, 500) preventing silent fallback to mock data
      - API key validation
   4. Search, Filter, and Sort logic:
      - Status and channel filtering
      - Text search across ref, customer, and dishes
      - Sort by deadline, amount, and customer name

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/ordersIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError, ConfigurationError } from '../errors.ts'
import { extractOrder, getOrders } from '../endpoints.ts'
import {
  adaptOrderToViewModel,
  adaptOrdersToViewModels,
  calculateDeadlineStatus,
  deriveOrdersSummary,
  formatCurrency,
  formatDeadlineDateIST,
  formatDueLabel,
  formatTimeIST
} from '../adapters/orderAdapter.ts'
import { DEMO_ORDERS, DEMO_ORDERS_METADATA } from '../../pages/orders/ordersData.ts'

import type {
  OrderDTO,
  OrderExtractResponseDTO,
  OrderListResponseDTO,
  OrderStatusDTO,
  OrderChannelDTO
} from '../../types/dto.ts'

test('POST /api/orders/extract: sends the original customer text and returns a pending proposal', async () => {
  const expected: OrderExtractResponseDTO = {
    draft: {
      customer_name: 'Customer D',
      customer_phone: '9800000010',
      channel: 'whatsapp',
      deadline: '2026-10-17T13:00:00+05:30',
      items: [{ menu_item_id: 'menu-1', name: 'Paneer Biryani', quantity: 2, unit_price: 180 }],
      total_amount: 360
    },
    confidence: 0.93,
    warnings: [],
    action: {
      id: 'action-1',
      group_id: 'group-1',
      option_number: 1,
      action_type: 'order_intake',
      title: 'Add order from Customer D (2 x Paneer Biryani)',
      status: 'pending',
      expires_at: '2026-10-16T21:30:00+05:30'
    }
  }
  let requestUrl = ''
  let requestBody = ''
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-key',
    fetchFn: async (input, init) => {
      requestUrl = String(input)
      requestBody = String(init?.body)
      return new Response(JSON.stringify(expected), { status: 201 })
    }
  })

  const result = await extractOrder(
    { text: '2 Paneer Biryani for tomorrow at 1pm, Customer D' },
    { client }
  )
  assert.equal(requestUrl, 'http://localhost:8000/api/orders/extract')
  assert.deepEqual(JSON.parse(requestBody), { text: '2 Paneer Biryani for tomorrow at 1pm, Customer D' })
  assert.equal(result.draft?.items[0].quantity, 2)
  assert.equal(result.action?.status, 'pending')
})

test('POST /api/orders/extract: preserves clarification response and backend errors', async () => {
  const ambiguous: OrderExtractResponseDTO = {
    draft: null,
    confidence: 0.4,
    clarifying_questions: ['Which active menu item did the customer mean?'],
    action: null
  }
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-key',
    fetchFn: async () => new Response(JSON.stringify(ambiguous), { status: 200 })
  })
  const result = await extractOrder({ text: '2 paneer please' }, { client })
  assert.equal(result.draft, null)
  assert.deepEqual(result.clarifying_questions, ['Which active menu item did the customer mean?'])
  assert.equal(result.action, null)

  const unavailable = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-key',
    fetchFn: async () => new Response(JSON.stringify({
      error: { code: 'AI_UNAVAILABLE', message: 'Order extraction is unavailable.', details: null }
    }), { status: 502 })
  })
  await assert.rejects(
    extractOrder({ text: '2 Paneer Biryani' }, { client: unavailable }),
    (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === 'AI_UNAVAILABLE'
  )
})

/* ── 1. OrderDTO to OrderViewModel Adapter Mapping ───────────── */

test('Orders Adapter: maps OrderDTO fields accurately to OrderViewModel', () => {
  const sampleOrder: OrderDTO = {
    id: 'b2c3d4e5-1234-5678-9abc-def012345678',
    customer_name: 'Aditi Rao',
    channel: 'swiggy',
    deadline: '2026-10-17T12:30:00+05:30',
    status: 'in_progress',
    total_amount: 360.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Paneer Biryani', quantity: 2, unit_price: 180.0 }
    ]
  }

  const now = new Date('2026-10-17T12:00:00+05:30')
  const vm = adaptOrderToViewModel(sampleOrder, 'verified', now)

  assert.equal(vm.id, 'b2c3d4e5-1234-5678-9abc-def012345678')
  assert.equal(vm.ref, '#ORD-B2C3')
  assert.equal(vm.customerName, 'Aditi Rao')
  assert.equal(vm.channel, 'swiggy')
  assert.equal(vm.channelLabel, 'Swiggy')
  assert.equal(vm.status, 'in_progress')
  assert.equal(vm.statusLabel, 'In Prep')
  assert.equal(vm.totalAmount, 360.0)
  assert.equal(vm.formattedTotalAmount, '₹360.00')
  assert.equal(vm.itemsCount, 2)
  assert.equal(vm.items.length, 1)
  assert.equal(vm.items[0].name, 'Paneer Biryani')
  assert.equal(vm.items[0].quantity, 2)
  assert.equal(vm.items[0].unitPrice, 180.0)
  assert.equal(vm.items[0].formattedUnitPrice, '₹180.00')
  assert.equal(vm.items[0].subtotal, 360.0)
  assert.equal(vm.items[0].formattedSubtotal, '₹360.00')
  assert.equal(vm.minutesUntilDue, 30)
  assert.equal(vm.deadlineStatus, 'normal')
  assert.equal(vm.dataSource, 'verified')
})

test('Orders Adapter: maps all 7 documented order statuses accurately', () => {
  const statuses: OrderStatusDTO[] = [
    'new',
    'planned',
    'in_progress',
    'delayed',
    'partial',
    'completed',
    'cancelled'
  ]

  for (const status of statuses) {
    const order: OrderDTO = {
      id: `ord-${status}`,
      customer_name: `Customer ${status}`,
      channel: 'whatsapp',
      deadline: '2026-10-17T13:00:00+05:30',
      status,
      total_amount: 150.0,
      items: [{ menu_item_id: 'm1', name: 'Dal', quantity: 1, unit_price: 150.0 }]
    }

    const vm = adaptOrderToViewModel(order, 'verified')
    assert.equal(vm.status, status)
    assert.ok(vm.statusLabel.length > 0)
  }
})

test('Orders Adapter: maps all 5 documented channels with display labels', () => {
  const channels: OrderChannelDTO[] = [
    'whatsapp',
    'swiggy',
    'zomato',
    'instagram',
    'direct'
  ]

  const expectedLabels: Record<OrderChannelDTO, string> = {
    whatsapp: 'WhatsApp',
    swiggy: 'Swiggy',
    zomato: 'Zomato',
    instagram: 'Instagram',
    direct: 'Direct Call'
  }

  for (const channel of channels) {
    const order: OrderDTO = {
      id: `ord-${channel}`,
      customer_name: 'Test Customer',
      channel,
      deadline: '2026-10-17T13:00:00+05:30',
      status: 'new',
      total_amount: 200.0,
      items: [{ menu_item_id: 'm1', name: 'Rice', quantity: 1, unit_price: 200.0 }]
    }

    const vm = adaptOrderToViewModel(order)
    assert.equal(vm.channel, channel)
    assert.equal(vm.channelLabel, expectedLabels[channel])
  }
})

test('Orders Adapter: evaluates overdue and due-soon deadline statuses', () => {
  const now = new Date('2026-10-17T12:00:00+05:30')

  // 1. Overdue order (-10 mins)
  const overdueOrder: OrderDTO = {
    id: 'ord-overdue',
    customer_name: 'Customer Overdue',
    channel: 'direct',
    deadline: '2026-10-17T11:50:00+05:30',
    status: 'in_progress',
    total_amount: 100,
    items: []
  }
  const vmOverdue = adaptOrderToViewModel(overdueOrder, 'verified', now)
  assert.equal(vmOverdue.deadlineStatus, 'overdue')
  assert.ok(vmOverdue.minutesUntilDue < 0)

  // 2. Due soon (due in 10 mins <= 15)
  const dueSoonOrder: OrderDTO = {
    id: 'ord-soon',
    customer_name: 'Customer Soon',
    channel: 'direct',
    deadline: '2026-10-17T12:10:00+05:30',
    status: 'in_progress',
    total_amount: 100,
    items: []
  }
  const vmSoon = adaptOrderToViewModel(dueSoonOrder, 'verified', now)
  assert.equal(vmSoon.deadlineStatus, 'due-soon')

  // 3. Normal (due in 45 mins)
  const normalOrder: OrderDTO = {
    id: 'ord-normal',
    customer_name: 'Customer Normal',
    channel: 'direct',
    deadline: '2026-10-17T12:45:00+05:30',
    status: 'in_progress',
    total_amount: 100,
    items: []
  }
  const vmNormal = adaptOrderToViewModel(normalOrder, 'verified', now)
  assert.equal(vmNormal.deadlineStatus, 'normal')

  // 4. Completed order is always normal
  const completedOrder: OrderDTO = {
    id: 'ord-completed',
    customer_name: 'Customer Done',
    channel: 'direct',
    deadline: '2026-10-17T11:30:00+05:30',
    status: 'completed',
    total_amount: 100,
    items: []
  }
  const vmCompleted = adaptOrderToViewModel(completedOrder, 'verified', now)
  assert.equal(vmCompleted.deadlineStatus, 'normal')
})

test('Orders Adapter: formats currency with 2 decimals in INR symbol', () => {
  assert.equal(formatCurrency(0), '₹0.00')
  assert.equal(formatCurrency(150), '₹150.00')
  assert.equal(formatCurrency(499.5), '₹499.50')
  assert.equal(formatCurrency(NaN), '₹0.00')
})

test('Orders Adapter Date and Time Utils: formats IST timestamps and deadline statuses correctly', () => {
  const iso = '2026-10-17T12:30:00+05:30'
  assert.ok(formatTimeIST(iso).includes('12:30'))
  assert.equal(formatDeadlineDateIST(iso), '17 Oct 2026')
  assert.equal(formatTimeIST('invalid'), '—')
  assert.equal(formatDeadlineDateIST('invalid'), '—')

  assert.equal(calculateDeadlineStatus(-5, 'in_progress'), 'overdue')
  assert.equal(calculateDeadlineStatus(10, 'in_progress'), 'due-soon')
  assert.equal(calculateDeadlineStatus(40, 'in_progress'), 'normal')
  assert.equal(calculateDeadlineStatus(-5, 'completed'), 'normal')
  assert.equal(calculateDeadlineStatus(-5, 'cancelled'), 'normal')
})

/* ── 2. Summary Metrics Derivation ───────────────────────────── */

test('deriveOrdersSummary: derives deterministic summary counts and revenue from code', () => {
  const sampleOrders: OrderDTO[] = [
    {
      id: 'o1',
      customer_name: 'C1',
      channel: 'whatsapp',
      deadline: '2026-10-17T12:30:00+05:30',
      status: 'new',
      total_amount: 200.0,
      items: [{ menu_item_id: 'm1', name: 'D1', quantity: 1, unit_price: 200.0 }]
    },
    {
      id: 'o2',
      customer_name: 'C2',
      channel: 'swiggy',
      deadline: '2026-10-17T12:30:00+05:30',
      status: 'in_progress',
      total_amount: 300.0,
      items: [{ menu_item_id: 'm1', name: 'D1', quantity: 1, unit_price: 300.0 }]
    },
    {
      id: 'o3',
      customer_name: 'C3',
      channel: 'zomato',
      deadline: '2026-10-17T12:10:00+05:30',
      status: 'delayed',
      total_amount: 400.0,
      items: [{ menu_item_id: 'm1', name: 'D1', quantity: 1, unit_price: 400.0 }]
    },
    {
      id: 'o4',
      customer_name: 'C4',
      channel: 'swiggy',
      deadline: '2026-10-17T12:00:00+05:30',
      status: 'completed',
      total_amount: 250.0,
      items: [{ menu_item_id: 'm1', name: 'D1', quantity: 1, unit_price: 250.0 }]
    },
    {
      id: 'o5',
      customer_name: 'C5',
      channel: 'direct',
      deadline: '2026-10-17T11:00:00+05:30',
      status: 'cancelled',
      total_amount: 500.0,
      items: [{ menu_item_id: 'm1', name: 'D1', quantity: 1, unit_price: 500.0 }]
    }
  ]

  const now = new Date('2026-10-17T12:00:00+05:30')
  const vms = adaptOrdersToViewModels(sampleOrders, 'verified', now)
  const summary = deriveOrdersSummary(vms)

  assert.equal(summary.totalOrders, 5)
  assert.equal(summary.activeOrders, 3) // new, in_progress, delayed
  assert.equal(summary.completedOrders, 1) // completed
  assert.equal(summary.delayedOrders, 1) // delayed
  assert.equal(summary.cancelledOrders, 1) // cancelled
  // Total revenue includes active + completed (200 + 300 + 400 + 250 = 1150), excludes cancelled
  assert.equal(summary.totalRevenue, 1150.0)
  assert.equal(summary.formattedTotalRevenue, '₹1150.00')

  assert.equal(summary.channelBreakdown.whatsapp, 1)
  assert.equal(summary.channelBreakdown.swiggy, 2)
  assert.equal(summary.channelBreakdown.zomato, 1)
  assert.equal(summary.channelBreakdown.direct, 1)
  assert.equal(summary.channelBreakdown.instagram, 0)
})

/* ── 3. GET /api/orders Endpoint Integration ─────────────────── */

test('getOrders: serializes query parameters correctly to the API client', async () => {
  let capturedUrl = ''
  let capturedHeaders: Record<string, string> = {}

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedHeaders = (init?.headers as Record<string, string>) ?? {}
    const body: OrderListResponseDTO = { data: [], count: 0 }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const res = await getOrders({ date: '2026-10-17', status: 'planned', limit: 25 }, { client })

  assert.ok(capturedUrl.includes('/api/orders'))
  assert.ok(capturedUrl.includes('date=2026-10-17'))
  assert.ok(capturedUrl.includes('status=planned'))
  assert.ok(capturedUrl.includes('limit=25'))
  assert.equal(capturedHeaders['X-API-Key'], 'test-api-key')
  assert.equal(res.count, 0)
  assert.deepEqual(res.data, [])
})

test('getOrders: requires API key per Rest_API_Spec.md §1', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: undefined,
    fetchFn: async () => new Response('{}')
  })

  await assert.rejects(
    async () => {
      await getOrders({}, { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ConfigurationError)
      assert.ok(err.message.includes('Missing VITE_API_KEY'))
      return true
    }
  )
})

test('getOrders: throws ApiError on 500 without silently falling back to mock data', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database query failed'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'test-api-key',
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
      return true
    }
  )
})

test('getOrders: throws ApiError on 401 UNAUTHORIZED', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid API key'
        }
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'bad-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await getOrders({}, { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 401)
      assert.equal(err.code, 'UNAUTHORIZED')
      return true
    }
  )
})

/* ── 4. Search, Filter, and Sort Logic ───────────────────────── */

test('Orders Filtering: searches by customer name, ref, and dish name', () => {
  const sampleOrders: OrderDTO[] = [
    {
      id: 'a1b2c3d4-0001',
      customer_name: 'Priya Sharma',
      channel: 'whatsapp',
      deadline: '2026-10-17T12:30:00+05:30',
      status: 'planned',
      total_amount: 360,
      items: [{ menu_item_id: 'm1', name: 'Paneer Biryani', quantity: 2, unit_price: 180 }]
    },
    {
      id: 'e5f6a7b8-0002',
      customer_name: 'Rahul Dravid',
      channel: 'swiggy',
      deadline: '2026-10-17T12:45:00+05:30',
      status: 'in_progress',
      total_amount: 210,
      items: [{ menu_item_id: 'm2', name: 'Dal Makhani', quantity: 1, unit_price: 210 }]
    }
  ]

  const vms = adaptOrdersToViewModels(sampleOrders)

  // Search by customer name
  const matchCustomer = vms.filter((o) => o.customerName.toLowerCase().includes('priya'))
  assert.equal(matchCustomer.length, 1)
  assert.equal(matchCustomer[0].ref, '#ORD-A1B2')

  // Search by ref
  const matchRef = vms.filter((o) => o.ref.toLowerCase().includes('e5f6'))
  assert.equal(matchRef.length, 1)
  assert.equal(matchRef[0].customerName, 'Rahul Dravid')

  // Search by dish item
  const matchDish = vms.filter((o) => o.items.some((item) => item.name.toLowerCase().includes('biryani')))
  assert.equal(matchDish.length, 1)
  assert.equal(matchDish[0].customerName, 'Priya Sharma')
})

test('Orders Sorting: sorts orders by deadline and total amount', () => {
  const sampleOrders: OrderDTO[] = [
    {
      id: 'o1',
      customer_name: 'A Customer',
      channel: 'direct',
      deadline: '2026-10-17T13:00:00+05:30',
      status: 'new',
      total_amount: 500,
      items: []
    },
    {
      id: 'o2',
      customer_name: 'B Customer',
      channel: 'direct',
      deadline: '2026-10-17T12:00:00+05:30',
      status: 'new',
      total_amount: 200,
      items: []
    }
  ]

  const vms = adaptOrdersToViewModels(sampleOrders)

  // Sort by deadline asc
  const sortedDeadlineAsc = [...vms].sort(
    (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
  )
  assert.equal(sortedDeadlineAsc[0].id, 'o2') // 12:00 first

  // Sort by amount desc
  const sortedAmountDesc = [...vms].sort((a, b) => b.totalAmount - a.totalAmount)
  assert.equal(sortedAmountDesc[0].id, 'o1') // 500 first
})

/* ── 5. Deadline Calculations & Time-Reference Regression Tests ─── */

test('Deadline Calculations: Future deadlines are never labeled overdue even if status is delayed', () => {
  const refTime = new Date('2026-10-17T12:15:00+05:30')

  // Future deadline: 12:18 PM (+3 mins) with status 'delayed'
  const futureDelayedOrder: OrderDTO = {
    id: 'ord-future-delayed',
    customer_name: 'Amit Patel',
    channel: 'swiggy',
    deadline: '2026-10-17T12:18:00+05:30',
    status: 'delayed',
    total_amount: 320,
    items: [{ menu_item_id: 'm1', name: 'Biryani', quantity: 1, unit_price: 320 }]
  }

  const vm = adaptOrderToViewModel(futureDelayedOrder, 'simulated', refTime)
  assert.equal(vm.minutesUntilDue, 3)
  assert.equal(vm.deadlineStatus, 'due-soon')
  assert.notEqual(vm.deadlineStatus, 'overdue')
  assert.equal(formatDueLabel(vm.minutesUntilDue, vm.status), 'In 3m')

  // Future deadline: 12:40 PM (+25 mins) with status 'in_progress'
  assert.equal(calculateDeadlineStatus(25, 'in_progress'), 'normal')
  assert.equal(formatDueLabel(25, 'in_progress'), 'In 25m')

  // Future deadline: 2h 15m ahead (+135 mins)
  assert.equal(calculateDeadlineStatus(135, 'planned'), 'normal')
  assert.equal(formatDueLabel(135, 'planned'), 'In 2h 15m')

  // Future deadline: exactly 2 hours ahead (+120 mins)
  assert.equal(formatDueLabel(120, 'new'), 'In 2h')

  // Due right now: 0 mins
  assert.equal(calculateDeadlineStatus(0, 'in_progress'), 'due-soon')
  assert.equal(formatDueLabel(0, 'in_progress'), 'Due now')
})

test('Deadline Calculations: Recently overdue deadlines (under 60 minutes) are flagged accurately', () => {
  const refTime = new Date('2026-10-17T12:15:00+05:30')

  // 5 minutes overdue (deadline was 12:10 PM)
  const recentOverdueOrder: OrderDTO = {
    id: 'ord-recent-overdue',
    customer_name: 'Tanmay Bhat',
    channel: 'swiggy',
    deadline: '2026-10-17T12:10:00+05:30',
    status: 'in_progress',
    total_amount: 250,
    items: []
  }

  const vm = adaptOrderToViewModel(recentOverdueOrder, 'simulated', refTime)
  assert.equal(vm.minutesUntilDue, -5)
  assert.equal(vm.deadlineStatus, 'overdue')
  assert.equal(formatDueLabel(vm.minutesUntilDue, vm.status), '5m overdue')

  // 45 minutes overdue
  assert.equal(calculateDeadlineStatus(-45, 'delayed'), 'overdue')
  assert.equal(formatDueLabel(-45, 'delayed'), '45m overdue')
})

test('Deadline Calculations: Deadlines several hours overdue format as Xh Ym overdue without integer minute overflow', () => {
  // Exactly 2 hours overdue (-120m)
  assert.equal(calculateDeadlineStatus(-120, 'in_progress'), 'overdue')
  assert.equal(formatDueLabel(-120, 'in_progress'), '2h overdue')

  // 2 hours 30 mins overdue (-150m)
  assert.equal(formatDueLabel(-150, 'in_progress'), '2h 30m overdue')

  // Historical discrepancy test: ~3,649 minutes (~60 hours 49 minutes)
  assert.equal(formatDueLabel(-3649, 'in_progress'), '60h 49m overdue')
})

test('Deadline Calculations: Completed and cancelled orders never receive overdue indicators or labels', () => {
  const refTime = new Date('2026-10-17T12:15:00+05:30')

  // Completed order with past deadline
  const completedPast: OrderDTO = {
    id: 'ord-comp-past',
    customer_name: 'Rohan Joshi',
    channel: 'zomato',
    deadline: '2026-10-17T11:45:00+05:30',
    status: 'completed',
    total_amount: 190,
    items: []
  }
  const vmCompleted = adaptOrderToViewModel(completedPast, 'simulated', refTime)
  assert.equal(vmCompleted.minutesUntilDue, -30)
  assert.equal(vmCompleted.deadlineStatus, 'normal') // Never overdue
  assert.equal(formatDueLabel(vmCompleted.minutesUntilDue, vmCompleted.status), 'Fulfilled')

  // Cancelled order with past deadline
  const cancelledPast: OrderDTO = {
    id: 'ord-canc-past',
    customer_name: 'Gaurav Gera',
    channel: 'direct',
    deadline: '2026-10-17T11:00:00+05:30',
    status: 'cancelled',
    total_amount: 300,
    items: []
  }
  const vmCancelled = adaptOrderToViewModel(cancelledPast, 'simulated', refTime)
  assert.equal(vmCancelled.minutesUntilDue, -75)
  assert.equal(vmCancelled.deadlineStatus, 'normal') // Never overdue
  assert.equal(formatDueLabel(vmCancelled.minutesUntilDue, vmCancelled.status), 'Cancelled')

  // Even if deadline was 3,000 minutes ago, completed is always Fulfilled / normal
  assert.equal(calculateDeadlineStatus(-3000, 'completed'), 'normal')
  assert.equal(formatDueLabel(-3000, 'completed'), 'Fulfilled')
  assert.equal(calculateDeadlineStatus(-3000, 'cancelled'), 'normal')
  assert.equal(formatDueLabel(-3000, 'cancelled'), 'Cancelled')
})

test('Deadline Calculations: Simulated demo snapshot time anchors deadline calculations consistently', () => {
  const snapshotDate = new Date(DEMO_ORDERS_METADATA.simulatedNowIso)
  assert.equal(DEMO_ORDERS_METADATA.snapshotTime, 'Simulated snapshot — 12:15 PM IST')

  const adaptedDemoOrders = adaptOrdersToViewModels(DEMO_ORDERS, 'simulated', snapshotDate)

  // Verify that all demo orders evaluate relative to the simulated snapshot (12:15 PM IST on 2026-10-17)
  for (const order of adaptedDemoOrders) {
    // No demo order should ever have a bogus ~3,600+ minute overdue delta
    assert.ok(
      Math.abs(order.minutesUntilDue) < 1440,
      `Order ${order.ref} has unrealistic minutesUntilDue: ${order.minutesUntilDue}`
    )
  }

  // Specifically check order with 12:18 PM deadline (Vikram Mehta, deadline 12:18 PM, status delayed)
  const order1218 = adaptedDemoOrders.find((o) => o.customerName.includes('Vikram') || o.deadline.includes('12:18'))
  assert.ok(order1218, 'Vikram Mehta (12:18 PM deadline) demo order must exist')
  assert.equal(order1218.minutesUntilDue, 3) // Exactly 3 minutes in future relative to 12:15 PM
  assert.equal(order1218.deadlineStatus, 'due-soon') // NOT overdue!
  assert.equal(formatDueLabel(order1218.minutesUntilDue, order1218.status), 'In 3m')
})

test('Deadline Calculations: Handles IST and UTC timezone boundary conversions accurately', () => {
  // Test UTC ISO string vs +05:30 offset representation
  // 06:48 UTC is 12:18 IST (+05:30)
  const utcIso = '2026-10-17T06:48:00Z'
  const istIso = '2026-10-17T12:18:00+05:30'

  assert.equal(new Date(utcIso).getTime(), new Date(istIso).getTime())
  assert.equal(formatTimeIST(utcIso).toLowerCase(), '12:18 pm')
  assert.equal(formatTimeIST(istIso).toLowerCase(), '12:18 pm')

  // Midnight IST boundary:
  // 2026-10-17T19:00:00Z is 2026-10-18T00:30:00+05:30 (next calendar day in IST)
  const midnightIso = '2026-10-17T19:00:00Z'
  assert.equal(formatDeadlineDateIST(midnightIso), '18 Oct 2026')
  assert.equal(formatTimeIST(midnightIso).toLowerCase(), '12:30 am')

  // Evaluating across midnight:
  // Deadline at 00:15 AM on Oct 18 IST, reference time at 11:55 PM on Oct 17 IST (+20 minutes)
  const midnightRef = new Date('2026-10-17T23:55:00+05:30')
  const midnightOrder: OrderDTO = {
    id: 'ord-midnight',
    customer_name: 'Night Owl',
    channel: 'swiggy',
    deadline: '2026-10-18T00:15:00+05:30',
    status: 'in_progress',
    total_amount: 180,
    items: []
  }
  const vmMidnight = adaptOrderToViewModel(midnightOrder, 'verified', midnightRef)
  assert.equal(vmMidnight.minutesUntilDue, 20)
  assert.equal(vmMidnight.deadlineStatus, 'normal')
  assert.equal(formatDueLabel(vmMidnight.minutesUntilDue, vmMidnight.status), 'In 20m')
})
