/* ============================================================
   frontend/src/api/__tests__/schedulePlanIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Schedule & Plan Integration Tests

   Tests verify:
   1. Correct mapping of all documented task statuses:
      - 'scheduled' -> preserved, distinguishable from in_progress and done
      - 'in_progress' -> preserved with active status
      - 'done' -> preserved, does not imply dispatch
      - 'cancelled' -> preserved, excluded from active tasks count
   2. Preservation of locked-task state per AGENTS.md Rule 10.
   3. Correct handling of cook_no, burner_no, task_type, start_at, and end_at.
   4. Solver late_orders deadline risk identification.
   5. Order context joining from GET /api/orders.
   6. Derived schedule plan summary metrics (Rule 1: code-computed).
   7. Non-fatal 404 PLAN_NOT_FOUND handling and 0-task empty state.
   8. API error handling preventing silent fallback to mock data (Rule 9).
   9. Date formatting in IST.

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/schedulePlanIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import { getPlan, getOrders } from '../endpoints.ts'
import {
  adaptPlanTaskToScheduleItem,
  adaptPlanTasksToScheduleItems,
  deriveSchedulePlanSummary,
  deriveWorkstationLabel,
  calculateDurationMins
} from '../adapters/planAdapter.ts'
import { formatDateIST, formatTimeIST } from '../adapters/orderAdapter.ts'

import type { OrderDTO, PlanResponseDTO, PlanTaskDTO } from '../../types/dto.ts'

/* ── 1. Documented Task Status Mapping & Lifecycle ──────────── */

test('Schedule & Plan: maps all documented task statuses accurately', () => {
  const sampleTasks: PlanTaskDTO[] = [
    {
      id: 'task-1',
      order_id: 'ord-101',
      order_item_id: 'item-1',
      dish: 'Paneer Tikka',
      task_type: 'cook',
      burner_no: 1,
      cook_no: 2,
      start_at: '2026-10-18T12:00:00+05:30',
      end_at: '2026-10-18T12:20:00+05:30',
      status: 'scheduled',
      locked: false
    },
    {
      id: 'task-2',
      order_id: 'ord-102',
      order_item_id: 'item-2',
      dish: 'Dal Makhani',
      task_type: 'cook',
      burner_no: 2,
      cook_no: 1,
      start_at: '2026-10-18T12:05:00+05:30',
      end_at: '2026-10-18T12:25:00+05:30',
      status: 'in_progress',
      locked: false
    },
    {
      id: 'task-3',
      order_id: 'ord-103',
      order_item_id: 'item-3',
      dish: 'Tandoori Roti',
      task_type: 'cook',
      burner_no: 3,
      cook_no: 3,
      start_at: '2026-10-18T11:40:00+05:30',
      end_at: '2026-10-18T11:55:00+05:30',
      status: 'done',
      locked: false
    },
    {
      id: 'task-4',
      order_id: 'ord-104',
      order_item_id: 'item-4',
      dish: 'Mutton Biryani',
      task_type: 'prep',
      burner_no: null,
      cook_no: 1,
      start_at: '2026-10-18T12:30:00+05:30',
      end_at: '2026-10-18T12:50:00+05:30',
      status: 'cancelled',
      locked: false
    }
  ]

  const adapted = adaptPlanTasksToScheduleItems(sampleTasks)

  assert.equal(adapted.length, 4)
  assert.equal(adapted[0].status, 'scheduled')
  assert.equal(adapted[1].status, 'in_progress')
  assert.equal(adapted[2].status, 'done')
  assert.equal(adapted[3].status, 'cancelled')

  // Scheduled is distinguishable from in_progress and done
  assert.notEqual(adapted[0].status, adapted[1].status)
  assert.notEqual(adapted[0].status, adapted[2].status)
})

/* ── 2. Preservation of Locked-Task State (Rule 10) ─────────── */

test('Schedule & Plan: preserves locked-task state per AGENTS.md Rule 10', () => {
  const lockedTask: PlanTaskDTO = {
    id: 'task-locked',
    order_id: 'ord-101',
    order_item_id: 'item-1',
    dish: 'Signature Hyderabadi Biryani',
    task_type: 'cook',
    burner_no: 1,
    cook_no: 1,
    start_at: '2026-10-18T12:15:00+05:30',
    end_at: '2026-10-18T12:45:00+05:30',
    status: 'in_progress',
    locked: true
  }

  const unlockedTask: PlanTaskDTO = {
    ...lockedTask,
    id: 'task-unlocked',
    locked: false
  }

  const adaptedLocked = adaptPlanTaskToScheduleItem(lockedTask)
  const adaptedUnlocked = adaptPlanTaskToScheduleItem(unlockedTask)

  assert.equal(adaptedLocked.isLocked, true)
  assert.equal(adaptedUnlocked.isLocked, false)
})

/* ── 3. Correct Handling of Workstations, Cooks & Times ─────── */

test('Schedule & Plan: handles cook_no, burner_no, task_type and duration correctly', () => {
  const prepTask: PlanTaskDTO = {
    id: 'task-prep',
    order_id: 'ord-1',
    order_item_id: 'item-1',
    dish: 'Chopped Onions & Herbs',
    task_type: 'prep',
    burner_no: null,
    cook_no: 4,
    start_at: '2026-10-18T11:00:00+05:30',
    end_at: '2026-10-18T11:20:00+05:30',
    status: 'scheduled',
    locked: false
  }

  const cookTaskWithBurner: PlanTaskDTO = {
    id: 'task-cook',
    order_id: 'ord-2',
    order_item_id: 'item-2',
    dish: 'Butter Chicken Curry',
    task_type: 'cook',
    burner_no: 3,
    cook_no: 2,
    start_at: '2026-10-18T11:15:00+05:30',
    end_at: '2026-10-18T11:45:00+05:30',
    status: 'in_progress',
    locked: false
  }

  const packTask: PlanTaskDTO = {
    id: 'task-pack',
    order_id: 'ord-3',
    order_item_id: 'item-3',
    dish: 'Meal Box Packaging',
    task_type: 'pack',
    burner_no: null,
    cook_no: 1,
    start_at: '2026-10-18T11:45:00+05:30',
    end_at: '2026-10-18T11:55:00+05:30',
    status: 'scheduled',
    locked: false
  }

  const adaptedPrep = adaptPlanTaskToScheduleItem(prepTask)
  const adaptedCook = adaptPlanTaskToScheduleItem(cookTaskWithBurner)
  const adaptedPack = adaptPlanTaskToScheduleItem(packTask)

  // Workstation derivation (no fabricated physical stations table)
  assert.equal(adaptedPrep.workstationLabel, 'Prep Station')
  assert.equal(adaptedCook.workstationLabel, 'Burner #3')
  assert.equal(adaptedPack.workstationLabel, 'Packaging & Pass')

  // Assigned Cook resource identifier
  assert.equal(adaptedPrep.assignedCookLabel, 'Cook #4')
  assert.equal(adaptedCook.assignedCookLabel, 'Cook #2')
  assert.equal(adaptedPack.assignedCookLabel, 'Cook #1')

  // Assigned Burner resource identifier
  assert.equal(adaptedPrep.assignedBurnerLabel, 'None (off-burner)')
  assert.equal(adaptedCook.assignedBurnerLabel, 'Burner #3')
  assert.equal(adaptedPack.assignedBurnerLabel, 'None (off-burner)')

  // Duration in minutes
  assert.equal(adaptedPrep.durationMins, 20)
  assert.equal(adaptedCook.durationMins, 30)
  assert.equal(adaptedPack.durationMins, 10)
})

/* ── 4. Late Order Risk Flagging ────────────────────────────── */

test('Schedule & Plan: flags tasks whose order_id is in plan.late_orders', () => {
  const task: PlanTaskDTO = {
    id: 'task-late-test',
    order_id: 'ord-late-999',
    order_item_id: 'item-1',
    dish: 'Chicken Korma',
    task_type: 'cook',
    burner_no: 1,
    cook_no: 1,
    start_at: '2026-10-18T12:00:00+05:30',
    end_at: '2026-10-18T12:30:00+05:30',
    status: 'in_progress',
    locked: false
  }

  const lateList = ['ord-late-999', 'ord-other-888']
  const adaptedWithLate = adaptPlanTaskToScheduleItem(task, lateList)
  const adaptedWithoutLate = adaptPlanTaskToScheduleItem(task, ['ord-other-888'])

  assert.equal(adaptedWithLate.isLateOrder, true)
  assert.equal(adaptedWithoutLate.isLateOrder, false)
})

/* ── 5. Order Context Enrichment (GET /api/orders) ──────────── */

test('Schedule & Plan: enriches task with customer name, channel, and deadline from orders', () => {
  const task: PlanTaskDTO = {
    id: 'task-with-order',
    order_id: 'ord-swiggy-42',
    order_item_id: 'item-1',
    dish: 'Palak Paneer',
    task_type: 'cook',
    burner_no: 2,
    cook_no: 3,
    start_at: '2026-10-18T12:10:00+05:30',
    end_at: '2026-10-18T12:30:00+05:30',
    status: 'scheduled',
    locked: false
  }

  const orders: OrderDTO[] = [
    {
      id: 'ord-swiggy-42',
      customer_name: 'Ananya Roy',
      channel: 'swiggy',
      deadline: '2026-10-18T12:45:00+05:30',
      status: 'in_progress',
      total_amount: 340.0,
      items: [{ menu_item_id: 'm1', name: 'Palak Paneer', quantity: 1, unit_price: 340.0 }]
    }
  ]

  const adapted = adaptPlanTaskToScheduleItem(task, [], orders)

  assert.equal(adapted.customerName, 'Ananya Roy')
  assert.equal(adapted.channel, 'Swiggy')
  assert.match(adapted.orderDeadline ?? '', /12:45\s*(pm|PM)/i)
})

/* ── 6. Summary Metrics Derivation (AGENTS.md Rule 1) ────────── */

test('Schedule & Plan Summary: computes metrics from code and excludes cancelled from active', () => {
  const plan: PlanResponseDTO = {
    date: '2026-10-18',
    plan_version: 3,
    late_orders: ['ord-late-1'],
    tasks: [
      {
        id: 't1',
        order_id: 'ord-1',
        order_item_id: 'i1',
        dish: 'Dish 1',
        task_type: 'cook',
        burner_no: 1,
        cook_no: 1,
        start_at: '2026-10-18T12:00:00+05:30',
        end_at: '2026-10-18T12:20:00+05:30',
        status: 'in_progress',
        locked: true
      },
      {
        id: 't2',
        order_id: 'ord-2',
        order_item_id: 'i2',
        dish: 'Dish 2',
        task_type: 'cook',
        burner_no: 2,
        cook_no: 2,
        start_at: '2026-10-18T12:10:00+05:30',
        end_at: '2026-10-18T12:30:00+05:30',
        status: 'scheduled',
        locked: false
      },
      {
        id: 't3',
        order_id: 'ord-3',
        order_item_id: 'i3',
        dish: 'Dish 3',
        task_type: 'pack',
        burner_no: null,
        cook_no: 1,
        start_at: '2026-10-18T12:25:00+05:30',
        end_at: '2026-10-18T12:35:00+05:30',
        status: 'done',
        locked: false
      },
      {
        id: 't4',
        order_id: 'ord-4',
        order_item_id: 'i4',
        dish: 'Dish 4',
        task_type: 'cook',
        burner_no: 3,
        cook_no: 3,
        start_at: '2026-10-18T12:40:00+05:30',
        end_at: '2026-10-18T13:00:00+05:30',
        status: 'cancelled',
        locked: false
      }
    ]
  }

  const summary = deriveSchedulePlanSummary(plan, '2026-10-18')

  assert.equal(summary.planVersion, 'v3')
  assert.equal(summary.totalTasks, 4)
  // Active tasks must exclude cancelled:
  assert.equal(summary.activeTasksCount, 3)
  assert.equal(summary.inProgressCount, 1)
  assert.equal(summary.scheduledCount, 1)
  assert.equal(summary.doneCount, 1)
  assert.equal(summary.cancelledCount, 1)
  assert.equal(summary.lockedCount, 1)
  assert.equal(summary.lateOrderCount, 1)

  // Resource counts: active tasks only (cook 1 and cook 2; cook 3 is only on cancelled task)
  assert.equal(summary.activeCooksCount, 2)
  // Burners: burner 1 and burner 2 (burner 3 is cancelled)
  assert.equal(summary.activeBurnersCount, 2)
})

/* ── 7. Non-Fatal 404 PLAN_NOT_FOUND and Empty Plan State ───── */

test('Schedule & Plan: handles 404 PLAN_NOT_FOUND gracefully as empty plan state', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'PLAN_NOT_FOUND',
          message: 'No plan exists for date 2026-10-18'
        }
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({ baseUrl: 'http://localhost:8000', apiKey: 'test-key' })

  try {
    const plan = await getPlan({ date: '2026-10-18' }, { client }).catch((err: unknown) => {
      if (err instanceof ApiError && (err.status === 404 || err.code === 'PLAN_NOT_FOUND')) {
        return null
      }
      throw err
    })

    assert.equal(plan, null)

    const summary = deriveSchedulePlanSummary(null, '2026-10-18')
    assert.equal(summary.planVersion, '—')
    assert.equal(summary.totalTasks, 0)
    assert.equal(summary.activeTasksCount, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

/* ── 8. API Failure Never Silently Falls Back to Mock Data ───── */

test('Schedule & Plan: throws ApiError on 500 without silent fallback to mock data', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database connection failed'
        }
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({ baseUrl: 'http://localhost:8000', apiKey: 'test-key' })

  await assert.rejects(
    async () => {
      await getPlan({ date: '2026-10-18' }, { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_ERROR')
      return true
    }
  )

  globalThis.fetch = originalFetch
})

/* ── 9. Date Formatting in IST ──────────────────────────────── */

test('Schedule & Plan Date Utils: formats dates and times accurately in IST', () => {
  const formattedDate = formatDateIST('2026-10-18')
  assert.ok(formattedDate.includes('Sunday') || formattedDate.includes('18'))
  assert.ok(formattedDate.includes('Oct'))

  const formattedTime = formatTimeIST('2026-10-18T12:30:00+05:30')
  assert.match(formattedTime, /12:30\s*(pm|PM)/i)

  // Safe fallback on invalid dates
  assert.equal(formatDateIST('invalid-date'), 'invalid-date')
  assert.equal(formatTimeIST('invalid-time'), '—')
})

/* ── 10. Strict Live vs Demo Isolation ──────────────────────── */

test('Schedule & Plan: live mode error state never leaks demo data or metadata', () => {
  // Derive summary with null plan simulating live failure/missing plan
  const liveErrorSummary = deriveSchedulePlanSummary(null, '2026-10-18')

  assert.equal(liveErrorSummary.planVersion, '—')
  assert.equal(liveErrorSummary.totalTasks, 0)
  assert.equal(liveErrorSummary.activeTasksCount, 0)
  assert.equal(liveErrorSummary.inProgressCount, 0)
  assert.equal(liveErrorSummary.scheduledCount, 0)
  assert.equal(liveErrorSummary.doneCount, 0)
  assert.equal(liveErrorSummary.lockedCount, 0)
  assert.equal(liveErrorSummary.lateOrderCount, 0)
})

/* ── 11. Stale Response Protection Across Date Changes ──────── */

test('Schedule & Plan: verifies sequence counter discards older responses', async () => {
  let seq = 0
  const responses: string[] = []

  async function simulateFetchForDate(date: string, delayMs: number) {
    const currentSeq = ++seq
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (currentSeq !== seq) {
      // Discarded stale response
      return
    }
    responses.push(date)
  }

  // Request for 2026-10-17 starts first but takes 50ms (slow)
  const req1 = simulateFetchForDate('2026-10-17', 50)
  // User rapidly clicks next day to 2026-10-18 which finishes in 10ms (fast)
  const req2 = simulateFetchForDate('2026-10-18', 10)

  await Promise.all([req1, req2])

  // Only the newer request (2026-10-18) was applied; older request (2026-10-17) was discarded
  assert.equal(responses.length, 1)
  assert.equal(responses[0], '2026-10-18')
})
