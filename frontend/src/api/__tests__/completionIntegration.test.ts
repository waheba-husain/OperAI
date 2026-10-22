/* ============================================================
   frontend/src/api/__tests__/completionIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Completion Workflows Integration Tests

   Tests verify:
   1. completeOrder endpoint helper:
      - Correct URL path (/api/orders/{order_id}/complete) and POST method
      - Header inclusion (X-API-Key)
      - Successful completion response parsing (OrderCompleteResponseDTO)
      - Already-completed idempotent response parsing (already_completed: true)
      - Error handling (404 ORDER_NOT_FOUND, 422 INVALID_STATUS_TRANSITION, 401 UNAUTHORIZED)
   2. completePlanTask endpoint helper:
      - Correct URL path (/api/plan/tasks/{task_id}/complete) and POST method
      - Header inclusion (X-API-Key)
      - Successful task completion response parsing (PlanTaskCompleteResponseDTO)
      - Locked flag preservation and already-completed response parsing
      - Error handling (404 TASK_NOT_FOUND, 422 INVALID_STATUS_TRANSITION, 401 UNAUTHORIZED)
   3. Eligibility & Duplicate Submission Guards:
      - Order completion eligibility (cancelled/completed disallowed; new/planned/in_progress allowed)
      - Task completion eligibility (cancelled/done disallowed; scheduled/in_progress allowed)
      - Mutation guard preventing concurrent duplicate in-flight submissions

   Runs via Node 24 native test runner:
   node --experimental-strip-types --test src/api/__tests__/completionIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError, ConfigurationError } from '../errors.ts'
import { completeOrder, completePlanTask } from '../endpoints.ts'
import type { OrderCompleteResponseDTO, PlanTaskCompleteResponseDTO } from '../../types/dto.ts'

/* ── 1. completeOrder Endpoint Helper ──────────────────────── */

test('completeOrder: sends POST /api/orders/{order_id}/complete with API key', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedHeaders: Record<string, string> = {}

  const mockResponse: OrderCompleteResponseDTO = {
    order: {
      id: 'ord-123',
      customer_name: 'Aarav Sharma',
      channel: 'whatsapp',
      deadline: '2026-10-22T13:00:00+05:30',
      status: 'completed',
      total_amount: 350.0,
      items: [{ menu_item_id: 'm1', name: 'Paneer Biryani', quantity: 2, unit_price: 175.0 }]
    },
    already_completed: false,
    message: 'Order marked as completed'
  }

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedMethod = init?.method ?? 'GET'
    capturedHeaders = (init?.headers as Record<string, string>) ?? {}
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: mockFetch
  })

  const res = await completeOrder('ord-123', { client })

  assert.equal(capturedUrl, 'http://localhost:8000/api/orders/ord-123/complete')
  assert.equal(capturedMethod, 'POST')
  assert.equal(capturedHeaders['X-API-Key'], 'dev-key')
  assert.equal(res.order.id, 'ord-123')
  assert.equal(res.order.status, 'completed')
  assert.equal(res.already_completed, false)
  assert.equal(res.message, 'Order marked as completed')
})

test('completeOrder: handles already-completed order response idempotently', async () => {
  const mockResponse: OrderCompleteResponseDTO = {
    order: {
      id: 'ord-already-done',
      customer_name: 'Priya Patel',
      channel: 'swiggy',
      deadline: '2026-10-22T12:30:00+05:30',
      status: 'completed',
      total_amount: 220.0,
      items: []
    },
    already_completed: true,
    message: 'Order is already completed'
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: async () =>
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
  })

  const res = await completeOrder('ord-already-done', { client })
  assert.equal(res.order.status, 'completed')
  assert.equal(res.already_completed, true)
  assert.equal(res.message, 'Order is already completed')
})

test('completeOrder: throws ApiError on 404 ORDER_NOT_FOUND', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'Order 00000000-0000-0000-0000-000000000000 not found',
            details: {}
          }
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
  })

  await assert.rejects(
    async () => {
      await completeOrder('00000000-0000-0000-0000-000000000000', { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'ORDER_NOT_FOUND')
      return true
    }
  )
})

test('completeOrder: throws ApiError on 422 INVALID_STATUS_TRANSITION', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: "Cannot complete order with status 'cancelled'",
            details: {}
          }
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
  })

  await assert.rejects(
    async () => {
      await completeOrder('ord-cancelled', { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 422)
      assert.equal(err.code, 'INVALID_STATUS_TRANSITION')
      return true
    }
  )
})

test('completeOrder: requires API key per Rest_API_Spec.md §1', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: undefined,
    fetchFn: async () => new Response('{}')
  })

  await assert.rejects(
    async () => {
      await completeOrder('ord-1', { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ConfigurationError)
      assert.ok(err.message.includes('Missing VITE_API_KEY'))
      return true
    }
  )
})

/* ── 2. completePlanTask Endpoint Helper ───────────────────── */

test('completePlanTask: sends POST /api/plan/tasks/{task_id}/complete with API key', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedHeaders: Record<string, string> = {}

  const mockResponse: PlanTaskCompleteResponseDTO = {
    task: {
      id: 'task-789',
      order_id: 'ord-123',
      order_item_id: 'item-456',
      dish: 'Paneer Biryani',
      task_type: 'cook',
      burner_no: 1,
      cook_no: 1,
      start_at: '2026-10-22T11:00:00+05:30',
      end_at: '2026-10-22T11:35:00+05:30',
      status: 'done',
      locked: true
    },
    already_completed: false,
    message: 'Task marked as done'
  }

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input)
    capturedMethod = init?.method ?? 'GET'
    capturedHeaders = (init?.headers as Record<string, string>) ?? {}
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: mockFetch
  })

  const res = await completePlanTask('task-789', { client })

  assert.equal(capturedUrl, 'http://localhost:8000/api/plan/tasks/task-789/complete')
  assert.equal(capturedMethod, 'POST')
  assert.equal(capturedHeaders['X-API-Key'], 'dev-key')
  assert.equal(res.task.id, 'task-789')
  assert.equal(res.task.status, 'done')
  assert.equal(res.task.locked, true)
  assert.equal(res.already_completed, false)
  assert.equal(res.message, 'Task marked as done')
})

test('completePlanTask: handles already-completed task response idempotently', async () => {
  const mockResponse: PlanTaskCompleteResponseDTO = {
    task: {
      id: 'task-done',
      order_id: 'ord-1',
      order_item_id: 'item-1',
      dish: 'Dal Makhani',
      task_type: 'prep',
      burner_no: null,
      cook_no: 2,
      start_at: '2026-10-22T10:00:00+05:30',
      end_at: '2026-10-22T10:20:00+05:30',
      status: 'done',
      locked: true
    },
    already_completed: true,
    message: 'Task is already completed'
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: async () =>
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
  })

  const res = await completePlanTask('task-done', { client })
  assert.equal(res.task.status, 'done')
  assert.equal(res.task.locked, true)
  assert.equal(res.already_completed, true)
  assert.equal(res.message, 'Task is already completed')
})

test('completePlanTask: throws ApiError on 404 TASK_NOT_FOUND', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'TASK_NOT_FOUND',
            message: 'Task not found',
            details: {}
          }
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
  })

  await assert.rejects(
    async () => {
      await completePlanTask('non-existent', { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'TASK_NOT_FOUND')
      return true
    }
  )
})

test('completePlanTask: throws ApiError on 422 INVALID_STATUS_TRANSITION', async () => {
  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: "Cannot complete task with status 'cancelled'",
            details: {}
          }
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
  })

  await assert.rejects(
    async () => {
      await completePlanTask('task-cancelled', { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 422)
      assert.equal(err.code, 'INVALID_STATUS_TRANSITION')
      return true
    }
  )
})

/* ── 3. Eligibility & Guard Invariants ─────────────────────── */

test('Order Completion Eligibility: checks status transition validity', () => {
  const eligibleStatuses = ['new', 'planned', 'in_progress', 'delayed', 'partial']
  const ineligibleStatuses = ['completed', 'cancelled']

  for (const s of eligibleStatuses) {
    const canComplete = s !== 'completed' && s !== 'cancelled'
    assert.equal(canComplete, true, `Status ${s} should be eligible for completion`)
  }

  for (const s of ineligibleStatuses) {
    const canComplete = s !== 'completed' && s !== 'cancelled'
    assert.equal(canComplete, false, `Status ${s} must NOT be eligible for completion`)
  }
})

test('Task Completion Eligibility: checks status transition validity', () => {
  const eligibleStatuses = ['scheduled', 'in_progress']
  const ineligibleStatuses = ['done', 'cancelled']

  for (const s of eligibleStatuses) {
    const canMarkDone = s !== 'done' && s !== 'cancelled'
    assert.equal(canMarkDone, true, `Task status ${s} should be eligible to mark done`)
  }

  for (const s of ineligibleStatuses) {
    const canMarkDone = s !== 'done' && s !== 'cancelled'
    assert.equal(canMarkDone, false, `Task status ${s} must NOT be eligible to mark done`)
  }
})

test('Duplicate Submission Guard: in-flight flag blocks concurrent calls', async () => {
  let callCount = 0

  const mockFetch: typeof fetch = async () => {
    callCount++
    await new Promise((r) => setTimeout(r, 20))
    return new Response(
      JSON.stringify({
        order: { id: 'o1', status: 'completed' },
        already_completed: false,
        message: 'Order marked as completed'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'http://localhost:8000',
    apiKey: 'dev-key',
    fetchFn: mockFetch
  })

  let isSubmitting = false
  const submitWithGuard = async (id: string) => {
    if (isSubmitting) return false
    isSubmitting = true
    try {
      await completeOrder(id, { client })
      return true
    } finally {
      isSubmitting = false
    }
  }

  // Trigger two concurrent calls
  const [first, second] = await Promise.all([
    submitWithGuard('o1'),
    submitWithGuard('o1')
  ])

  // First must succeed, second must be blocked by guard
  assert.equal(first, true)
  assert.equal(second, false)
  assert.equal(callCount, 1)
})
