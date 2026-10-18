/* ============================================================
   frontend/src/pages/shortageRecovery/shortageRecoveryData.ts
   Illustrative demo data for the OperAI Shortage & Recovery page.

   DATA INTEGRITY (per AGENTS.md rule 9):
   data_source = 'simulated' — these values are realistic kitchen
   benchmarks for UI demonstration only when offline or in demo mode.
   ============================================================ */

import type { BriefResponseDTO, RecoveryProposeResponseDTO } from '../../types/dto.ts'
import {
  adaptAtRiskOrdersToViewModels,
  adaptRecoveryResponseToViewModel,
  adaptShortagesToViewModels,
  deriveShortageRecoverySummary
} from '../../api/adapters/recoveryAdapter.ts'

export const DEMO_RECOVERY_METADATA = {
  dataSource: 'simulated',
  kitchenName: 'Cloud Kitchen Central #04',
  targetDate: '2026-10-18',
  note: 'Simulated shortage horizon and constraint recovery for offline demonstration.'
} as const

export const DEMO_BRIEF_RESPONSE: BriefResponseDTO = {
  date: '2026-10-18',
  order_count: 26,
  shortages: [
    {
      ingredient_id: 'ing_paneer',
      name: 'Paneer',
      unit: 'kg',
      stock_qty: 1.0,
      needed_qty: 1.92,
      short_by: 0.92
    }
  ],
  at_risk_orders: [
    {
      order_id: 'ord-101',
      customer_name: 'Aditi Sharma',
      deadline: '2026-10-18T13:00:00+05:30',
      total_amount: 540.0
    },
    {
      order_id: 'ord-102',
      customer_name: 'Rahul Varma',
      deadline: '2026-10-18T12:45:00+05:30',
      total_amount: 720.0
    },
    {
      order_id: 'ord-103',
      customer_name: 'Priya Patel',
      deadline: '2026-10-18T13:20:00+05:30',
      total_amount: 390.0
    },
    {
      order_id: 'ord-105',
      customer_name: 'Meera Sen',
      deadline: '2026-10-18T13:45:00+05:30',
      total_amount: 480.0
    }
  ],
  revenue_at_risk: 1260.0,
  data_source: 'simulated'
}

export const DEMO_RECOVERY_PROPOSAL: RecoveryProposeResponseDTO = {
  group_id: 'grp-demo-paneer-01',
  shortage: {
    ingredient_id: 'ing_paneer',
    name: 'Paneer',
    short_by: 0.92,
    unit: 'kg'
  },
  baseline: {
    label: 'Do nothing',
    late_orders: 4,
    revenue_at_risk: 1260.0,
    extra_cost: 0.0
  },
  scoring: {
    weights: {
      lateness: 0.5,
      margin: 0.3,
      customer_risk: 0.2
    }
  },
  recommended_option_number: 1,
  options: [
    {
      action_id: 'act-demo-opt-1',
      option_number: 1,
      option_type: 'substitute',
      title: 'Use Organic Firm Tofu instead of Paneer across 4 affected orders',
      status: 'pending',
      needs_customer_consent: true,
      impact: {
        late_orders: 0,
        orders_protected: 4,
        revenue_at_risk_after: 0.0,
        extra_cost: -147.2,
        margin_before_pct: 21.0,
        margin_after_pct: 23.5,
        customer_risk: 'medium',
        score: 0.82
      },
      expires_at: '2026-10-18T13:15:00+05:30'
    },
    {
      action_id: 'act-demo-opt-2',
      option_number: 2,
      option_type: 'emergency_purchase',
      title: 'Emergency purchase 1.0 kg Paneer locally; 1 order delayed by 25 mins',
      status: 'pending',
      needs_customer_consent: true,
      impact: {
        late_orders: 1,
        orders_protected: 3,
        revenue_at_risk_after: 390.0,
        extra_cost: 40.0,
        margin_before_pct: 21.0,
        margin_after_pct: 20.6,
        customer_risk: 'low',
        score: 0.71
      },
      expires_at: '2026-10-18T13:15:00+05:30'
    },
    {
      action_id: 'act-demo-opt-3',
      option_number: 3,
      option_type: 'dish_swap',
      title: 'Offer Veg Pulao Combo swap for 2 Swiggy orders',
      status: 'pending',
      needs_customer_consent: true,
      impact: {
        late_orders: 2,
        orders_protected: 2,
        revenue_at_risk_after: 600.0,
        extra_cost: -22.0,
        margin_before_pct: 21.0,
        margin_after_pct: 21.4,
        customer_risk: 'high',
        score: 0.55
      },
      expires_at: '2026-10-18T13:15:00+05:30'
    }
  ]
}

export const DEMO_VIEW_SHORTAGES = adaptShortagesToViewModels(DEMO_BRIEF_RESPONSE)
export const DEMO_VIEW_AT_RISK_ORDERS = adaptAtRiskOrdersToViewModels(DEMO_BRIEF_RESPONSE.at_risk_orders)
export const DEMO_VIEW_PROPOSAL = adaptRecoveryResponseToViewModel(DEMO_RECOVERY_PROPOSAL)
export const DEMO_VIEW_SUMMARY = deriveShortageRecoverySummary(DEMO_BRIEF_RESPONSE, '2026-10-18')
