/* ============================================================
   frontend/src/pages/orders/ordersData.ts
   OperAI / Cloud Kitchen Rescue — Demo Orders Dataset

   DATA INTEGRITY (AGENTS.md Rule 9):
   data_source = 'simulated' — these records are realistic cloud
   kitchen benchmarks for UI demonstration only.
   ============================================================ */

import type { OrderDTO } from '../../types/dto.ts'

export const DEMO_ORDERS_METADATA = {
  dataSource: 'simulated' as const,
  kitchenName: 'Cloud Kitchen Central #04',
  serviceDate: '2026-10-17',
  shift: 'Lunch Service · Saturday, 17 Oct 2026',
  snapshotTime: 'Simulated snapshot — 12:15 PM IST',
  simulatedNowIso: '2026-10-17T12:15:00+05:30'
} as const

export const DEMO_ORDERS: readonly OrderDTO[] = [
  {
    id: 'ord-4a5b6c7d',
    customer_name: 'Tanmay Bhat',
    channel: 'swiggy',
    deadline: '2026-10-17T12:10:00+05:30',
    status: 'in_progress',
    total_amount: 350.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Paneer Biryani', quantity: 1, unit_price: 180.0 },
      { menu_item_id: 'm_dal', name: 'Dal Makhani', quantity: 1, unit_price: 170.0 }
    ]
  },
  {
    id: 'ord-8f2a1b9c',
    customer_name: 'Ananya Sharma',
    channel: 'swiggy',
    deadline: '2026-10-17T12:20:00+05:30',
    status: 'in_progress',
    total_amount: 420.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Paneer Biryani', quantity: 2, unit_price: 180.0 },
      { menu_item_id: 'm_raita', name: 'Boondi Raita', quantity: 1, unit_price: 60.0 }
    ]
  },
  {
    id: 'ord-3c4d5e6f',
    customer_name: 'Vikram Mehta',
    channel: 'zomato',
    deadline: '2026-10-17T12:18:00+05:30',
    status: 'delayed',
    total_amount: 490.0,
    items: [
      { menu_item_id: 'm_pbm', name: 'Paneer Butter Masala', quantity: 1, unit_price: 210.0 },
      { menu_item_id: 'm_naan', name: 'Garlic Naan', quantity: 4, unit_price: 70.0 }
    ]
  },
  {
    id: 'ord-7a8b9c0d',
    customer_name: 'Rahul Dravid',
    channel: 'whatsapp',
    deadline: '2026-10-17T12:30:00+05:30',
    status: 'planned',
    total_amount: 360.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Paneer Biryani', quantity: 2, unit_price: 180.0 }
    ]
  },
  {
    id: 'ord-1e2f3a4b',
    customer_name: 'Priya Sundaram',
    channel: 'instagram',
    deadline: '2026-10-17T12:35:00+05:30',
    status: 'new',
    total_amount: 540.0,
    items: [
      { menu_item_id: 'm_dal', name: 'Dal Makhani', quantity: 2, unit_price: 160.0 },
      { menu_item_id: 'm_rice', name: 'Jeera Rice', quantity: 2, unit_price: 110.0 }
    ]
  },
  {
    id: 'ord-5c6d7e8f',
    customer_name: 'Aditya Verma',
    channel: 'direct',
    deadline: '2026-10-17T12:10:00+05:30',
    status: 'completed',
    total_amount: 280.0,
    items: [
      { menu_item_id: 'm_naan', name: 'Butter Naan', quantity: 4, unit_price: 50.0 },
      { menu_item_id: 'm_dal', name: 'Dal Tadka', quantity: 1, unit_price: 80.0 }
    ]
  },
  {
    id: 'ord-9a0b1c2d',
    customer_name: 'Sneha Patel',
    channel: 'whatsapp',
    deadline: '2026-10-17T12:45:00+05:30',
    status: 'partial',
    total_amount: 620.0,
    items: [
      { menu_item_id: 'm_pbm', name: 'Paneer Butter Masala', quantity: 2, unit_price: 210.0 },
      { menu_item_id: 'm_rice', name: 'Jeera Rice', quantity: 2, unit_price: 100.0 }
    ]
  },
  {
    id: 'ord-3e4f5a6b',
    customer_name: 'Karan Johar',
    channel: 'swiggy',
    deadline: '2026-10-17T13:00:00+05:30',
    status: 'planned',
    total_amount: 390.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Veg Dum Biryani', quantity: 1, unit_price: 170.0 },
      { menu_item_id: 'm_pbm', name: 'Paneer Butter Masala', quantity: 1, unit_price: 220.0 }
    ]
  },
  {
    id: 'ord-7c8d9e0f',
    customer_name: 'Rohan Gupta',
    channel: 'zomato',
    deadline: '2026-10-17T12:05:00+05:30',
    status: 'completed',
    total_amount: 320.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Paneer Biryani', quantity: 1, unit_price: 180.0 },
      { menu_item_id: 'm_jamun', name: 'Gulab Jamun (2 pcs)', quantity: 2, unit_price: 70.0 }
    ]
  },
  {
    id: 'ord-2a3b4c5d',
    customer_name: 'Deepika Padukone',
    channel: 'whatsapp',
    deadline: '2026-10-17T13:15:00+05:30',
    status: 'new',
    total_amount: 450.0,
    items: [
      { menu_item_id: 'm_dal', name: 'Dal Makhani', quantity: 1, unit_price: 160.0 },
      { menu_item_id: 'm_pbm', name: 'Paneer Butter Masala', quantity: 1, unit_price: 210.0 },
      { menu_item_id: 'm_naan', name: 'Garlic Naan', quantity: 1, unit_price: 80.0 }
    ]
  },
  {
    id: 'ord-6e7f8a9b',
    customer_name: 'Amitabh Bachchan',
    channel: 'direct',
    deadline: '2026-10-17T11:45:00+05:30',
    status: 'cancelled',
    total_amount: 720.0,
    items: [
      { menu_item_id: 'm_biryani', name: 'Paneer Biryani', quantity: 4, unit_price: 180.0 }
    ]
  }
]
