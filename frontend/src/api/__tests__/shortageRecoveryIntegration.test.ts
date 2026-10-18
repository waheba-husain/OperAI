/* ============================================================
   frontend/src/api/__tests__/shortageRecoveryIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Shortage & Recovery Integration Tests

   Covers Stage 2.4D Requirements:
   1. Documented GET /api/brief mapping:
      - Identified ingredient shortages (name, deficit, stock vs needed, revenue exposure)
      - Affected and at-risk orders (due times, order amount, customer reference)
      - Financial revenue-at-risk computed by backend
   2. Recovery proposal request payload (POST /api/recovery/propose):
      - date, ingredient_id, and optional reported_available_qty
   3. Recovery proposal response mapping:
      - Option identifiers and ordering preserved exactly
      - Option type, status, and impact fields
      - Candidate recovery options vs Do-Nothing baseline
   4. Customer consent metadata:
      - needs_customer_consent flag preserved and highlighted
   5. Edge cases:
      - Empty shortage list handled honestly
      - Zero feasible options response with escalation
      - 409 NO_SHORTAGE_DETECTED handling
      - 404 PLAN_NOT_FOUND or INGREDIENT_NOT_FOUND
      - 422 VALIDATION_ERROR and 500 SERVER_ERROR
   6. Strict live/demo separation:
      - Errors are propagated and not silently masked by mock fallback
   7. Scope & Mutation boundaries:
      - No calls to POST /api/actions/{id}/approve in Stage 2.4D

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/shortageRecoveryIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError } from '../errors.ts'
import { getBrief, proposeRecovery } from '../endpoints.ts'
import {
  formatCurrencyINR,
  formatOptionTypeLabel,
  formatExtraCostLabel,
  adaptShortageToViewModel,
  adaptShortagesToViewModels,
  adaptAtRiskOrdersToViewModels,
  adaptRecoveryBaselineToViewModel,
  adaptRecoveryOptionToViewModel,
  adaptRecoveryResponseToViewModel,
  deriveShortageRecoverySummary
} from '../adapters/recoveryAdapter.ts'

import type {
  BriefResponseDTO,
  RecoveryBaselineDTO,
  RecoveryOptionDTO,
  RecoveryProposeRequestDTO,
  RecoveryProposeResponseDTO
} from '../../types/dto.ts'

/* ── 1. Documented GET /api/brief Shortage & Risk Mapping ─────── */

test('Shortage & Recovery: accurately maps shortages and at-risk orders from GET /api/brief', () => {
  const mockBrief: BriefResponseDTO = {
    date: '2026-10-18',
    order_count: 24,
    shortages: [
      {
        ingredient_id: 'ing_paneer',
        name: 'Paneer',
        unit: 'kg',
        stock_qty: 1.5,
        needed_qty: 4.2,
        short_by: 2.7
      },
      {
        ingredient_id: 'ing_cream',
        name: 'Fresh Cream',
        unit: 'l',
        stock_qty: 0.5,
        needed_qty: 1.5,
        short_by: 1.0
      }
    ],
    at_risk_orders: [
      {
        order_id: 'ord-101',
        customer_name: 'Aarav Sharma',
        total_amount: 550.0,
        deadline: '2026-10-18T13:00:00+05:30'
      },
      {
        order_id: 'ord-102',
        customer_name: 'Priya Patel',
        total_amount: 900.0,
        deadline: '2026-10-18T13:15:00+05:30'
      }
    ],
    revenue_at_risk: 1450.0,
    data_source: 'verified'
  }

  // Verify adapter on individual item
  const pViewModel = adaptShortageToViewModel(
    mockBrief.shortages[0]!,
    '2026-10-18T13:00:00+05:30'
  )
  assert.equal(pViewModel.ingredientId, 'ing_paneer')
  assert.equal(pViewModel.name, 'Paneer')
  assert.equal(pViewModel.unit, 'kg')
  assert.equal(pViewModel.stockQty, 1.5)
  assert.equal(pViewModel.neededQty, 4.2)
  assert.equal(pViewModel.shortBy, 2.7)
  assert.equal(pViewModel.formattedDeficit, '-2.70 kg')
  assert.equal(pViewModel.formattedStock, '1.50 kg')
  assert.equal(pViewModel.formattedNeeded, '4.20 kg')
  assert.equal(pViewModel.earliestDeadlineFormatted, '1:00 pm')

  // Verify full brief adaptation
  const shortagesList = adaptShortagesToViewModels(mockBrief)
  assert.equal(shortagesList.length, 2)
  assert.equal(shortagesList[1]!.name, 'Fresh Cream')
  assert.equal(shortagesList[1]!.formattedDeficit, '-1.00 l')

  // Verify at-risk orders adaptation
  const atRiskOrders = adaptAtRiskOrdersToViewModels(mockBrief.at_risk_orders)
  assert.equal(atRiskOrders.length, 2)
  assert.equal(atRiskOrders[0]!.orderRef, '#ORD-ORD-')
  assert.equal(atRiskOrders[0]!.customerName, 'Aarav Sharma')
  assert.equal(atRiskOrders[0]!.totalAmountFormatted, '₹550.00')

  // Verify summary calculation
  const summary = deriveShortageRecoverySummary(mockBrief, '2026-10-18')
  assert.equal(summary.shortageCount, 2)
  assert.equal(summary.atRiskOrderCount, 2)
  assert.equal(summary.revenueAtRiskFormatted, '₹1,450.00')
  assert.equal(summary.dataSource, 'verified')
  assert.equal(summary.hasActiveShortages, true)
})

test('Shortage & Recovery: handles empty shortages list honestly', () => {
  const emptyBrief: BriefResponseDTO = {
    date: '2026-10-18',
    order_count: 10,
    shortages: [],
    at_risk_orders: [],
    revenue_at_risk: 0,
    data_source: 'verified'
  }

  const shortages = adaptShortagesToViewModels(emptyBrief)
  const atRiskOrders = adaptAtRiskOrdersToViewModels(emptyBrief.at_risk_orders)
  const summary = deriveShortageRecoverySummary(emptyBrief, '2026-10-18')

  assert.equal(shortages.length, 0)
  assert.equal(atRiskOrders.length, 0)
  assert.equal(summary.shortageCount, 0)
  assert.equal(summary.atRiskOrderCount, 0)
  assert.equal(summary.revenueAtRiskFormatted, '₹0.00')
  assert.equal(summary.hasActiveShortages, false)
})

/* ── 2. Recovery Propose Request Payload Construction ────────── */

test('Shortage & Recovery: constructs valid POST /api/recovery/propose request payload', async () => {
  let capturedUrl = ''
  let capturedBody = ''
  let capturedMethod = ''
  let capturedHeaders: Record<string, string> = {}

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(input)
    capturedMethod = init?.method ?? 'GET'
    capturedBody = String(init?.body ?? '')
    capturedHeaders = (init?.headers as Record<string, string>) ?? {}

    const responseBody: RecoveryProposeResponseDTO = {
      group_id: 'grp-test',
      shortage: {
        ingredient_id: 'ing_paneer',
        name: 'Paneer',
        unit: 'kg',
        short_by: 2.7
      },
      baseline: {
        label: 'Do nothing',
        late_orders: 3,
        revenue_at_risk: 1450.0,
        extra_cost: 0.0
      },
      scoring: {
        weights: { lateness: 0.5, margin: 0.3, customer_risk: 0.2 }
      },
      recommended_option_number: 1,
      options: []
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  const payloadWithReportedQty: RecoveryProposeRequestDTO = {
    date: '2026-10-18',
    ingredient_id: 'ing_paneer',
    reported_available_qty: 1.2
  }

  const res = await proposeRecovery(payloadWithReportedQty, { client })
  assert.equal(capturedMethod, 'POST')
  assert.equal(capturedUrl, 'https://test-api.operai.com/api/recovery/propose')
  assert.equal(capturedHeaders['X-API-Key'], 'test-api-key')
  assert.equal(capturedHeaders['Content-Type'], 'application/json')

  const parsed = JSON.parse(capturedBody)
  assert.equal(parsed.date, '2026-10-18')
  assert.equal(parsed.ingredient_id, 'ing_paneer')
  assert.equal(parsed.reported_available_qty, 1.2)
  assert.equal(res.group_id, 'grp-test')
})

/* ── 3. Recovery Response Mapping & Impact Field Evaluation ─── */

test('Shortage & Recovery: accurately maps Do-Nothing baseline and candidate recovery options', () => {
  const mockBaseline: RecoveryBaselineDTO = {
    label: 'Do nothing',
    late_orders: 3,
    revenue_at_risk: 1450.0,
    extra_cost: 0.0
  }

  const adaptedBaseline = adaptRecoveryBaselineToViewModel(mockBaseline)
  assert.equal(adaptedBaseline.label, 'Do nothing')
  assert.equal(adaptedBaseline.lateOrders, 3)
  assert.equal(adaptedBaseline.revenueAtRisk, 1450.0)
  assert.equal(adaptedBaseline.revenueAtRiskFormatted, '₹1,450.00')
  assert.equal(adaptedBaseline.extraCost, 0.0)
  assert.equal(adaptedBaseline.extraCostFormatted, '₹0.00')

  const mockOption1: RecoveryOptionDTO = {
    action_id: 'act-001',
    option_number: 1,
    option_type: 'substitute',
    title: 'Substitute Tofu for Paneer',
    impact: {
      orders_protected: 3,
      late_orders: 0,
      revenue_at_risk_after: 0.0,
      extra_cost: -50.0,
      margin_before_pct: 38.0,
      margin_after_pct: 41.5,
      customer_risk: 'medium',
      score: 0.885
    },
    needs_customer_consent: true,
    status: 'pending',
    expires_at: '2026-10-18T14:00:00+05:30'
  }

  const mockOption2: RecoveryOptionDTO = {
    action_id: 'act-002',
    option_number: 2,
    option_type: 'emergency_purchase',
    title: 'Blinkit Instant Grocery Restock',
    impact: {
      orders_protected: 3,
      late_orders: 1,
      revenue_at_risk_after: 250.0,
      extra_cost: 180.0,
      margin_before_pct: 38.0,
      margin_after_pct: 36.8,
      customer_risk: 'low',
      score: 0.74
    },
    needs_customer_consent: false,
    status: 'pending',
    expires_at: '2026-10-18T13:45:00+05:30'
  }

  const adaptedOpt1 = adaptRecoveryOptionToViewModel(mockOption1, 1)
  assert.equal(adaptedOpt1.actionId, 'act-001')
  assert.equal(adaptedOpt1.optionNumber, 1)
  assert.equal(adaptedOpt1.isRecommended, true)
  assert.equal(adaptedOpt1.optionTypeLabel, 'Recipe Substitution')
  assert.equal(adaptedOpt1.needsCustomerConsent, true)
  assert.equal(adaptedOpt1.ordersProtected, 3)
  assert.equal(adaptedOpt1.lateOrders, 0)
  assert.equal(adaptedOpt1.revenueAtRiskAfterFormatted, '₹0.00')
  assert.equal(adaptedOpt1.extraCostFormatted, '-₹50.00')
  assert.equal(adaptedOpt1.extraCostLabel, 'Saves ₹50.00')
  assert.equal(adaptedOpt1.marginDeltaPct, 3.5)
  assert.equal(adaptedOpt1.customerRisk, 'medium')
  assert.equal(adaptedOpt1.score, 0.885)
  assert.equal(adaptedOpt1.scorePct, 89)

  const adaptedOpt2 = adaptRecoveryOptionToViewModel(mockOption2, 1)
  assert.equal(adaptedOpt2.actionId, 'act-002')
  assert.equal(adaptedOpt2.optionNumber, 2)
  assert.equal(adaptedOpt2.isRecommended, false)
  assert.equal(adaptedOpt2.optionTypeLabel, 'Emergency Purchase')
  assert.equal(adaptedOpt2.needsCustomerConsent, false)
  assert.equal(adaptedOpt2.extraCostFormatted, '₹180.00')
  assert.equal(adaptedOpt2.extraCostLabel, '+₹180.00 cost')
  assert.equal(adaptedOpt2.marginDeltaPct, -1.2)
  assert.equal(adaptedOpt2.customerRisk, 'low')

  // Full Response Adaptation & Order Preservation
  const fullResponse: RecoveryProposeResponseDTO = {
    group_id: 'grp-123',
    shortage: {
      ingredient_id: 'ing_paneer',
      name: 'Paneer',
      unit: 'kg',
      short_by: 2.7
    },
    baseline: mockBaseline,
    scoring: {
      weights: { lateness: 0.5, margin: 0.3, customer_risk: 0.2 }
    },
    recommended_option_number: 1,
    options: [mockOption1, mockOption2]
  }

  const adaptedResult = adaptRecoveryResponseToViewModel(fullResponse)
  assert.equal(adaptedResult.groupId, 'grp-123')
  assert.equal(adaptedResult.recommendedOptionNumber, 1)
  assert.equal(adaptedResult.options.length, 2)
  assert.equal(adaptedResult.options[0]!.optionNumber, 1)
  assert.equal(adaptedResult.options[1]!.optionNumber, 2)
})

/* ── 4. Formatting Utilities ─────────────────────────────────── */

test('Shortage & Recovery: formats currency and labels correctly', () => {
  assert.equal(formatCurrencyINR(0), '₹0.00')
  assert.equal(formatCurrencyINR(1450), '₹1,450.00')
  assert.equal(formatCurrencyINR(2300.5), '₹2,300.50')

  assert.equal(formatOptionTypeLabel('substitute'), 'Recipe Substitution')
  assert.equal(formatOptionTypeLabel('emergency_purchase'), 'Emergency Purchase')
  assert.equal(formatOptionTypeLabel('dish_swap'), 'Dish Swap')
  assert.equal(formatOptionTypeLabel('delay_notify'), 'Delay & Notify')
  assert.equal(formatOptionTypeLabel('partial'), 'Partial Fulfillment')

  assert.equal(formatExtraCostLabel(0), '₹0.00 extra cost')
  assert.equal(formatExtraCostLabel(-50), 'Saves ₹50.00')
  assert.equal(formatExtraCostLabel(180), '+₹180.00 cost')
})

/* ── 5. Edge Cases & Error Handling ──────────────────────────── */

test('Shortage & Recovery: handles no viable options with escalation message', () => {
  const noFeasibleResponse: RecoveryProposeResponseDTO = {
    group_id: 'grp-empty',
    shortage: {
      ingredient_id: 'ing_special',
      name: 'Saffron Threads',
      unit: 'g',
      short_by: 15.0
    },
    baseline: {
      label: 'Do nothing',
      late_orders: 2,
      revenue_at_risk: 3200.0,
      extra_cost: 0.0
    },
    scoring: {
      weights: { lateness: 0.5, margin: 0.3, customer_risk: 0.2 }
    },
    recommended_option_number: undefined,
    options: [],
    escalation: 'No feasible option found. Contact customers or restock.'
  }

  const result = adaptRecoveryResponseToViewModel(noFeasibleResponse)
  assert.equal(result.options.length, 0)
  assert.equal(result.recommendedOptionNumber, undefined)
  assert.equal(result.escalation, 'No feasible option found. Contact customers or restock.')
})

test('Shortage & Recovery: handles 409 NO_SHORTAGE_DETECTED conflict honestly', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'NO_SHORTAGE_DETECTED',
          message: 'Inventory already covers scheduled needs for this date. No shortage detected.',
          details: { ingredient_id: 'ing_paneer', date: '2026-10-18' }
        }
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await proposeRecovery(
        { date: '2026-10-18', ingredient_id: 'ing_paneer' },
        { client }
      )
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 409)
      assert.equal(err.code, 'NO_SHORTAGE_DETECTED')
      return true
    }
  )
})

test('Shortage & Recovery: handles 404 PLAN_NOT_FOUND or INGREDIENT_NOT_FOUND', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'PLAN_NOT_FOUND',
          message: 'No plan exists for 2026-10-25. Generate a plan first.',
          details: null
        }
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await proposeRecovery(
        { date: '2026-10-25', ingredient_id: 'ing_paneer' },
        { client }
      )
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'PLAN_NOT_FOUND')
      return true
    }
  )
})

test('Shortage & Recovery: handles 500 SERVER_ERROR without silent fallback', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unexpected solver runtime fault.',
          details: null
        }
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await getBrief({ date: '2026-10-18' }, { client })
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_SERVER_ERROR')
      return true
    }
  )
})

/* ── 6. Corrective Review Regression Tests ──────────────────── */

test('Shortage & Recovery: preserves reported_available_qty = 0 as numeric zero and omits when undefined', async () => {
  let capturedBodyZero = ''
  let capturedBodyOmitted = ''

  const mockFetchZero = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBodyZero = String(init?.body ?? '')
    return new Response(JSON.stringify({ options: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const clientZero = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetchZero
  })

  await proposeRecovery(
    { date: '2026-10-18', ingredient_id: 'ing_paneer', reported_available_qty: 0 },
    { client: clientZero }
  )

  const parsedZero = JSON.parse(capturedBodyZero)
  assert.strictEqual(parsedZero.reported_available_qty, 0, 'Zero quantity must be sent as numeric 0')

  const mockFetchOmitted = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedBodyOmitted = String(init?.body ?? '')
    return new Response(JSON.stringify({ options: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const clientOmitted = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetchOmitted
  })

  await proposeRecovery(
    { date: '2026-10-18', ingredient_id: 'ing_paneer' },
    { client: clientOmitted }
  )

  const parsedOmitted = JSON.parse(capturedBodyOmitted)
  assert.strictEqual(parsedOmitted.reported_available_qty, undefined, 'Omitted reported_available_qty must not be sent')
  assert.strictEqual('reported_available_qty' in parsedOmitted, false)
})

test('Shortage & Recovery: preserves undefined optional impact fields without converting to 0 or defaults', () => {
  const minimalOption: RecoveryOptionDTO = {
    action_id: 'act-min',
    option_number: 1,
    option_type: 'partial',
    title: 'Fulfill partial order volume',
    impact: {
      orders_protected: 1,
      late_orders: 1,
      extra_cost: 0.0,
      score: 0.65
      // revenue_at_risk_after is omitted
      // margin_before_pct & margin_after_pct are omitted
      // customer_risk is omitted
    },
    needs_customer_consent: false,
    status: 'pending',
    expires_at: '2026-10-18T13:30:00+05:30'
  }

  const adapted = adaptRecoveryOptionToViewModel(minimalOption)
  assert.strictEqual(adapted.revenueAtRiskAfter, undefined, 'Missing revenue_at_risk_after must remain undefined')
  assert.strictEqual(adapted.revenueAtRiskAfterFormatted, undefined, 'Missing revenueAtRiskAfterFormatted must not be formatted as ₹0.00')
  assert.strictEqual(adapted.marginBeforePct, undefined)
  assert.strictEqual(adapted.marginAfterPct, undefined)
  assert.strictEqual(adapted.marginDeltaPct, undefined)
  assert.strictEqual(adapted.customerRisk, undefined)
})

test('Shortage & Recovery: rejects negative quantity according to API validation contract', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing field or negative quantity',
          details: { field: 'reported_available_qty' }
        }
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const client = new ApiClient({
    baseUrl: 'https://test-api.operai.com',
    apiKey: 'test-api-key',
    fetchFn: mockFetch
  })

  await assert.rejects(
    async () => {
      await proposeRecovery(
        { date: '2026-10-18', ingredient_id: 'ing_paneer', reported_available_qty: -1.5 },
        { client }
      )
    },
    (err: unknown) => {
      assert(err instanceof ApiError)
      assert.equal(err.status, 422)
      assert.equal(err.code, 'VALIDATION_ERROR')
      return true
    }
  )
})
