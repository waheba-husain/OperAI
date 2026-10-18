/* ============================================================
   frontend/src/pages/schedulePlan/schedulePlanData.ts
   Illustrative demo data for the OperAI Schedule & Plan page.

   DATA INTEGRITY (per AGENTS.md rule 9):
   data_source = 'simulated' — these values are realistic kitchen
   benchmarks for UI demonstration only when offline or in demo mode.
   ============================================================ */

import type { OrderDTO, PlanResponseDTO } from '../../types/dto.ts'
import type { SchedulePlanSummary, ScheduleTaskItem } from '../../types/schedulePlan.ts'
import {
  adaptPlanTasksToScheduleItems,
  deriveSchedulePlanSummary
} from '../../api/adapters/planAdapter.ts'

export const DEMO_SCHEDULE_METADATA = {
  dataSource: 'simulated',
  kitchenName: 'Cloud Kitchen Central #04',
  planVersion: 'v4',
  targetDate: '2026-10-18',
  note: 'Simulated constraint-solved kitchen schedule for offline demonstration.'
} as const

export const DEMO_SCHEDULE_ORDERS: readonly OrderDTO[] = [
  {
    id: 'ord-101',
    customer_name: 'Aditi Sharma',
    channel: 'swiggy',
    status: 'in_progress',
    deadline: '2026-10-18T13:00:00+05:30',
    total_amount: 540.0,
    items: [
      { menu_item_id: 'item-101-1', name: 'Paneer Butter Masala', quantity: 1, unit_price: 320.0 },
      { menu_item_id: 'item-101-2', name: 'Butter Naan', quantity: 2, unit_price: 110.0 }
    ]
  },
  {
    id: 'ord-102',
    customer_name: 'Rahul Varma',
    channel: 'zomato',
    status: 'delayed',
    deadline: '2026-10-18T12:45:00+05:30',
    total_amount: 720.0,
    items: [
      { menu_item_id: 'item-102-1', name: 'Hyderabadi Chicken Biryani', quantity: 2, unit_price: 360.0 }
    ]
  },
  {
    id: 'ord-103',
    customer_name: 'Priya Patel',
    channel: 'whatsapp',
    status: 'planned',
    deadline: '2026-10-18T13:20:00+05:30',
    total_amount: 390.0,
    items: [
      { menu_item_id: 'item-103-1', name: 'Dal Makhani', quantity: 1, unit_price: 280.0 },
      { menu_item_id: 'item-103-2', name: 'Jeera Rice', quantity: 1, unit_price: 110.0 }
    ]
  },
  {
    id: 'ord-104',
    customer_name: 'Suresh Kumar',
    channel: 'direct',
    status: 'completed',
    deadline: '2026-10-18T12:30:00+05:30',
    total_amount: 250.0,
    items: [
      { menu_item_id: 'item-104-1', name: 'Tandoori Roti Box', quantity: 1, unit_price: 250.0 }
    ]
  },
  {
    id: 'ord-105',
    customer_name: 'Meera Sen',
    channel: 'instagram',
    status: 'cancelled',
    deadline: '2026-10-18T13:45:00+05:30',
    total_amount: 480.0,
    items: [
      { menu_item_id: 'item-105-1', name: 'Mutton Korma', quantity: 1, unit_price: 480.0 }
    ]
  }
]

export const DEMO_SCHEDULE_PLAN: PlanResponseDTO = {
  date: '2026-10-18',
  plan_version: 4,
  late_orders: ['ord-102'],
  tasks: [
    {
      id: 'task-001',
      order_id: 'ord-102',
      order_item_id: 'item-102-1',
      dish: 'Hyderabadi Chicken Biryani',
      task_type: 'cook',
      burner_no: 1,
      cook_no: 1,
      start_at: '2026-10-18T12:15:00+05:30',
      end_at: '2026-10-18T12:35:00+05:30',
      status: 'in_progress',
      locked: true // Hard rule 10: locked tasks never move during replan
    },
    {
      id: 'task-002',
      order_id: 'ord-101',
      order_item_id: 'item-101-1',
      dish: 'Paneer Butter Masala',
      task_type: 'cook',
      burner_no: 2,
      cook_no: 2,
      start_at: '2026-10-18T12:20:00+05:30',
      end_at: '2026-10-18T12:38:00+05:30',
      status: 'in_progress',
      locked: false
    },
    {
      id: 'task-003',
      order_id: 'ord-101',
      order_item_id: 'item-101-2',
      dish: 'Butter Naan',
      task_type: 'prep',
      burner_no: null,
      cook_no: 3,
      start_at: '2026-10-18T12:30:00+05:30',
      end_at: '2026-10-18T12:45:00+05:30',
      status: 'scheduled',
      locked: false
    },
    {
      id: 'task-004',
      order_id: 'ord-102',
      order_item_id: 'item-102-1',
      dish: 'Hyderabadi Chicken Biryani',
      task_type: 'pack',
      burner_no: null,
      cook_no: 1,
      start_at: '2026-10-18T12:36:00+05:30',
      end_at: '2026-10-18T12:44:00+05:30',
      status: 'scheduled',
      locked: false
    },
    {
      id: 'task-005',
      order_id: 'ord-103',
      order_item_id: 'item-103-1',
      dish: 'Dal Makhani',
      task_type: 'cook',
      burner_no: 1,
      cook_no: 2,
      start_at: '2026-10-18T12:40:00+05:30',
      end_at: '2026-10-18T13:00:00+05:30',
      status: 'scheduled',
      locked: true
    },
    {
      id: 'task-006',
      order_id: 'ord-103',
      order_item_id: 'item-103-2',
      dish: 'Jeera Rice',
      task_type: 'cook',
      burner_no: 3,
      cook_no: 3,
      start_at: '2026-10-18T12:45:00+05:30',
      end_at: '2026-10-18T13:05:00+05:30',
      status: 'scheduled',
      locked: false
    },
    {
      id: 'task-007',
      order_id: 'ord-104',
      order_item_id: 'item-104-1',
      dish: 'Tandoori Roti Box',
      task_type: 'cook',
      burner_no: 2,
      cook_no: 1,
      start_at: '2026-10-18T12:00:00+05:30',
      end_at: '2026-10-18T12:20:00+05:30',
      status: 'done',
      locked: false
    },
    {
      id: 'task-008',
      order_id: 'ord-104',
      order_item_id: 'item-104-1',
      dish: 'Tandoori Roti Box',
      task_type: 'pack',
      burner_no: null,
      cook_no: 1,
      start_at: '2026-10-18T12:20:00+05:30',
      end_at: '2026-10-18T12:28:00+05:30',
      status: 'done',
      locked: false
    },
    {
      id: 'task-009',
      order_id: 'ord-105',
      order_item_id: 'item-105-1',
      dish: 'Mutton Korma',
      task_type: 'cook',
      burner_no: 1,
      cook_no: 2,
      start_at: '2026-10-18T12:50:00+05:30',
      end_at: '2026-10-18T13:20:00+05:30',
      status: 'cancelled',
      locked: false
    }
  ]
}

export const DEMO_SCHEDULE_ITEMS: readonly ScheduleTaskItem[] =
  adaptPlanTasksToScheduleItems(
    DEMO_SCHEDULE_PLAN.tasks,
    DEMO_SCHEDULE_PLAN.late_orders,
    DEMO_SCHEDULE_ORDERS
  )

export const DEMO_SCHEDULE_SUMMARY: SchedulePlanSummary =
  deriveSchedulePlanSummary(DEMO_SCHEDULE_PLAN, '2026-10-18')
