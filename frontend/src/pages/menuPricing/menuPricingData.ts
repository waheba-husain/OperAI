/* ============================================================
   frontend/src/pages/menuPricing/menuPricingData.ts
   OperAI / Cloud Kitchen Rescue — Demo Menu & Pricing Dataset

   DATA INTEGRITY (AGENTS.md Rule 9):
   data_source = 'simulated' — these records are realistic cloud
   kitchen benchmarks based on seed data and specs.
   ============================================================ */

import type { MenuItemDTO, PricingAnalysisAssumptionsDTO } from '../../types/dto.ts'

export const DEMO_MENU_METADATA = {
  dataSource: 'simulated' as const,
  kitchenName: 'Cloud Kitchen Central #04',
  assumptions: {
    commission_pct: 20.0,
    overhead_pct: 12.0,
    target_margin_pct: 25.0,
    data_source: 'simulated' as const
  } satisfies PricingAnalysisAssumptionsDTO,
  snapshotTime: 'Simulated catalog — Target Margin 25.0%'
} as const

export const DEMO_MENU_ITEMS: readonly MenuItemDTO[] = [
  {
    id: 'm_biryani',
    name: 'Paneer Biryani',
    price: 180.0,
    cost_breakdown: {
      ingredients: 72.2,
      packaging: 14.0,
      commission: 36.0,
      overhead: 21.6,
      total: 143.8
    },
    profit_per_order: 36.2,
    margin_pct: 20.1,
    margin_status: 'below_target',
    is_active: true,
    data_source: 'simulated'
  },
  {
    id: 'm_pbm',
    name: 'Paneer Butter Masala',
    price: 220.0,
    cost_breakdown: {
      ingredients: 48.8,
      packaging: 16.0,
      commission: 44.0,
      overhead: 26.4,
      total: 135.2
    },
    profit_per_order: 84.8,
    margin_pct: 38.5,
    margin_status: 'healthy',
    is_active: true,
    data_source: 'simulated'
  },
  {
    id: 'm_pulao',
    name: 'Veg Pulao',
    price: 150.0,
    cost_breakdown: {
      ingredients: 20.8,
      packaging: 12.0,
      commission: 30.0,
      overhead: 18.0,
      total: 80.8
    },
    profit_per_order: 69.2,
    margin_pct: 46.1,
    margin_status: 'healthy',
    is_active: true,
    data_source: 'simulated'
  },
  {
    id: 'm_vegbiryani',
    name: 'Veg Biryani',
    price: 160.0,
    cost_breakdown: {
      ingredients: 22.4,
      packaging: 14.0,
      commission: 32.0,
      overhead: 19.2,
      total: 87.6
    },
    profit_per_order: 72.4,
    margin_pct: 45.3,
    margin_status: 'healthy',
    is_active: true,
    data_source: 'simulated'
  },
  {
    id: 'm_jeerarice',
    name: 'Jeera Rice',
    price: 90.0,
    cost_breakdown: {
      ingredients: 16.5,
      packaging: 8.0,
      commission: 18.0,
      overhead: 10.8,
      total: 53.3
    },
    profit_per_order: 36.7,
    margin_pct: 40.8,
    margin_status: 'healthy',
    is_active: true,
    data_source: 'simulated'
  },
  {
    id: 'm_gulabjamun',
    name: 'Gulab Jamun (2 pcs)',
    price: 40.0,
    cost_breakdown: {
      ingredients: 22.0,
      packaging: 8.0,
      commission: 8.0,
      overhead: 4.8,
      total: 42.8
    },
    profit_per_order: -2.8,
    margin_pct: -7.0,
    margin_status: 'loss',
    is_active: true,
    data_source: 'simulated'
  }
]
