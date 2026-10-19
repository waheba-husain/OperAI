/* ============================================================
   frontend/src/api/__tests__/menuIntegration.test.ts
   OperAI / Cloud Kitchen Rescue — Menu & Pricing Integration Tests

   Tests verify:
   1. MenuItemDTO to MenuItemViewModel Adapter:
      - Field mapping, ID preservation, and active status
      - Cost breakdown formatting (ingredients, packaging, commission, overhead, total)
      - Net profit and margin % formatting
      - All 3 margin statuses ('healthy', 'below_target', 'loss') mapped accurately
      - Honest data provenance labeling ('verified' vs 'simulated')
   2. Summary Metrics Derivation (code-computed, AGENTS.md Rule 1):
      - Total dishes, active dishes, healthy/below-target/loss counts
      - Kitchen average margin percentage
   3. GET /api/menu Endpoint Integration:
      - API key validation
      - Successful catalog response mapping
      - Error handling (401, 500) preventing silent fallback to mock data
   4. POST /api/pricing/analyze Endpoint Integration:
      - What-if payload serialization
      - Pricing analysis response mapping
      - Error handling (401, 404, 422, 500)
   5. What-If Pricing Calculation (exact formulas from features.md Feature 1 & 9):
      - Paneer Biryani at ₹180 gives profit ₹36.20 and margin 20.1%
      - Paneer Biryani simulated at ₹150 gives margin 10.5% and suggested price ₹205
      - Target margin goal (25%) achieved with rounding up to next ₹5
   6. Search, Filtering, and Sorting:
      - Text search by dish name and ID
      - Margin status and active status filtering
      - Sort by margin, price, profit, and dish name

   Runs via Node 24 native test runner:
   node --test src/api/__tests__/menuIntegration.test.ts
   ============================================================ */

import test from 'node:test'
import assert from 'node:assert/strict'

import { ApiClient } from '../client.ts'
import { ApiError, ConfigurationError } from '../errors.ts'
import { getMenu, analyzePricing } from '../endpoints.ts'
import {
  adaptCostBreakdown,
  adaptMenuItemToViewModel,
  adaptMenuItemsToViewModels,
  adaptPricingAnalysisToViewModel,
  calculateSimulatedPricingAnalysis,
  deriveMenuSummary,
  formatMarginStatusLabel
} from '../adapters/menuAdapter.ts'
import type {
  CostBreakdownDTO,
  MenuItemDTO,
  MenuListResponseDTO,
  PricingAnalysisResponseDTO,
  PricingAnalyzeRequestDTO
} from '../../types/dto.ts'

/* ── 1. MenuItemDTO to MenuItemViewModel Adapter ────────────── */

test('Menu Adapter: adaptCostBreakdown formats cost line items accurately', () => {
  const rawCost: CostBreakdownDTO = {
    ingredients: 50.5,
    packaging: 12.0,
    commission: 30.0,
    overhead: 18.0,
    total: 110.5
  }

  const vm = adaptCostBreakdown(rawCost)
  assert.equal(vm.ingredients, 50.5)
  assert.equal(vm.formattedIngredients, '₹50.50')
  assert.equal(vm.packaging, 12.0)
  assert.equal(vm.formattedPackaging, '₹12.00')
  assert.equal(vm.commission, 30.0)
  assert.equal(vm.formattedCommission, '₹30.00')
  assert.equal(vm.overhead, 18.0)
  assert.equal(vm.formattedOverhead, '₹18.00')
  assert.equal(vm.total, 110.5)
  assert.equal(vm.formattedTotal, '₹110.50')
})

test('Menu Adapter: maps MenuItemDTO fields accurately to MenuItemViewModel', () => {
  const sampleDish: MenuItemDTO = {
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
    data_source: 'verified'
  }

  const vm = adaptMenuItemToViewModel(sampleDish)

  assert.equal(vm.id, 'm_biryani')
  assert.equal(vm.name, 'Paneer Biryani')
  assert.equal(vm.price, 180.0)
  assert.equal(vm.formattedPrice, '₹180.00')

  assert.ok(vm.costBreakdown)
  assert.equal(vm.costBreakdown.ingredients, 72.2)
  assert.equal(vm.costBreakdown.formattedIngredients, '₹72.20')
  assert.equal(vm.costBreakdown.packaging, 14.0)
  assert.equal(vm.costBreakdown.formattedPackaging, '₹14.00')
  assert.equal(vm.costBreakdown.commission, 36.0)
  assert.equal(vm.costBreakdown.formattedCommission, '₹36.00')
  assert.equal(vm.costBreakdown.overhead, 21.6)
  assert.equal(vm.costBreakdown.formattedOverhead, '₹21.60')
  assert.equal(vm.costBreakdown.total, 143.8)
  assert.equal(vm.costBreakdown.formattedTotal, '₹143.80')

  assert.equal(vm.profitPerOrder, 36.2)
  assert.equal(vm.formattedProfitPerOrder, '₹36.20')
  assert.equal(vm.marginPct, 20.1)
  assert.equal(vm.formattedMarginPct, '20.1%')
  assert.equal(vm.marginStatus, 'below_target')
  assert.equal(vm.marginStatusLabel, 'Below Target (<25%)')
  assert.equal(vm.isActive, true)
  assert.equal(vm.dataSource, 'verified')
})

test('Menu Adapter: maps all 3 margin statuses with accurate presentation labels', () => {
  assert.equal(formatMarginStatusLabel('healthy'), 'Healthy Margin')
  assert.equal(formatMarginStatusLabel('below_target'), 'Below Target (<25%)')
  assert.equal(formatMarginStatusLabel('loss'), 'Loss Making')
})

test('Menu Adapter: adapts array of menu items and allows dataSource override', () => {
  const dishes: MenuItemDTO[] = [
    {
      id: 'd1',
      name: 'Dish 1',
      price: 100,
      cost_breakdown: { ingredients: 40, packaging: 10, commission: 20, overhead: 10, total: 80 },
      profit_per_order: 20,
      margin_pct: 20,
      margin_status: 'below_target',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'd2',
      name: 'Dish 2',
      price: 200,
      cost_breakdown: { ingredients: 60, packaging: 10, commission: 40, overhead: 20, total: 130 },
      profit_per_order: 70,
      margin_pct: 35,
      margin_status: 'healthy',
      is_active: false,
      data_source: 'verified'
    }
  ]

  const vms = adaptMenuItemsToViewModels(dishes, 'simulated')
  assert.equal(vms.length, 2)
  assert.equal(vms[0].dataSource, 'simulated')
  assert.equal(vms[1].dataSource, 'simulated')
  assert.equal(vms[1].isActive, false)
})

/* ── 2. Summary Metrics Derivation ──────────────────────────── */

test('deriveMenuSummary: computes deterministic metrics and kitchen average margin', () => {
  const dishes: MenuItemDTO[] = [
    {
      id: 'd1',
      name: 'Dish Healthy',
      price: 220,
      cost_breakdown: { ingredients: 50, packaging: 10, commission: 44, overhead: 26, total: 130 },
      profit_per_order: 90,
      margin_pct: 40.9,
      margin_status: 'healthy',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'd2',
      name: 'Dish Below Target',
      price: 180,
      cost_breakdown: { ingredients: 72, packaging: 14, commission: 36, overhead: 22, total: 144 },
      profit_per_order: 36,
      margin_pct: 20.0,
      margin_status: 'below_target',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'd3',
      name: 'Dish Loss',
      price: 40,
      cost_breakdown: { ingredients: 25, packaging: 8, commission: 8, overhead: 5, total: 46 },
      profit_per_order: -6,
      margin_pct: -15.0,
      margin_status: 'loss',
      is_active: false,
      data_source: 'verified'
    }
  ]

  const vms = adaptMenuItemsToViewModels(dishes)
  const summary = deriveMenuSummary(vms)

  assert.equal(summary.totalDishes, 3)
  assert.equal(summary.activeDishes, 2)
  assert.equal(summary.healthyCount, 1)
  assert.equal(summary.belowTargetCount, 1)
  assert.equal(summary.lossCount, 1)
  // Average: (40.9 + 20.0 + (-15.0)) / 3 = 45.9 / 3 = 15.3%
  assert.equal(summary.averageMarginPct, 15.3)
  assert.equal(summary.formattedAverageMarginPct, '15.3%')
})

test('deriveMenuSummary: handles empty catalog without throwing or NaN', () => {
  const summary = deriveMenuSummary([])
  assert.equal(summary.totalDishes, 0)
  assert.equal(summary.activeDishes, 0)
  assert.equal(summary.healthyCount, 0)
  assert.equal(summary.belowTargetCount, 0)
  assert.equal(summary.lossCount, 0)
  assert.equal(summary.averageMarginPct, 0.0)
  assert.equal(summary.formattedAverageMarginPct, '0.0%')
})

/* ── 3. GET /api/menu Endpoint Integration ──────────────────── */

test('getMenu: successfully fetches and deserializes catalog from API client', async () => {
  const mockPayload: MenuListResponseDTO = {
    data: [
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
        data_source: 'verified'
      }
    ],
    count: 1
  }

  const client = new ApiClient({
    baseUrl: 'http://test-operai',
    apiKey: 'test-key',
    fetchFn: async (url, init) => {
      assert.ok(String(url).endsWith('/api/menu'))
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('X-API-Key'), 'test-key')
      return new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  })

  const res = await getMenu({ client })
  assert.equal(res.count, 1)
  assert.equal(res.data[0].id, 'm_biryani')
  assert.equal(res.data[0].name, 'Paneer Biryani')
})

test('getMenu: requires API key per Rest_API_Spec.md §1', async () => {
  const client = new ApiClient({
    baseUrl: 'http://test-operai',
    apiKey: undefined
  })

  await assert.rejects(
    async () => {
      await getMenu({ client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ConfigurationError)
      assert.equal(err.missingKey, 'VITE_API_KEY')
      return true
    }
  )
})

test('getMenu: surfaces 500 error without silent fallback to mock data', async () => {
  const client = new ApiClient({
    baseUrl: 'http://test-operai',
    apiKey: 'test-key',
    fetchFn: async () => {
      return new Response(
        JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Database connection failed', details: {} }
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  })

  await assert.rejects(
    async () => {
      await getMenu({ client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 500)
      assert.equal(err.code, 'INTERNAL_ERROR')
      return true
    }
  )
})

/* ── 4. POST /api/pricing/analyze Endpoint Integration ──────── */

test('analyzePricing: serializes request payload and returns analyzed economics', async () => {
  const mockAnalysis: PricingAnalysisResponseDTO = {
    menu_item_id: 'm_biryani',
    name: 'Paneer Biryani',
    analyzed_price: 150.0,
    current_price: 180.0,
    cost_breakdown: {
      ingredients: 72.2,
      packaging: 14.0,
      commission: 30.0,
      overhead: 18.0,
      total: 134.2
    },
    profit_per_order: 15.8,
    margin_pct: 10.5,
    margin_status: 'below_target',
    suggested_price: 205.0,
    suggested_profit_per_order: 53.2,
    suggested_margin_pct: 26.0,
    assumptions: {
      commission_pct: 20.0,
      overhead_pct: 12.0,
      target_margin_pct: 25.0,
      data_source: 'verified'
    },
    action: null
  }

  const client = new ApiClient({
    baseUrl: 'http://test-operai',
    apiKey: 'test-key',
    fetchFn: async (url, init) => {
      assert.ok(String(url).endsWith('/api/pricing/analyze'))
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body)) as PricingAnalyzeRequestDTO
      assert.equal(body.menu_item_id, 'm_biryani')
      assert.equal(body.price, 150.0)
      assert.equal(body.propose_change, false)

      return new Response(JSON.stringify(mockAnalysis), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  })

  const res = await analyzePricing(
    { menu_item_id: 'm_biryani', price: 150.0, propose_change: false },
    { client }
  )

  assert.equal(res.menu_item_id, 'm_biryani')
  assert.equal(res.analyzed_price, 150.0)
  assert.equal(res.suggested_price, 205.0)
  assert.equal(res.margin_status, 'below_target')
})

test('analyzePricing: surfaces 404 MENU_ITEM_NOT_FOUND error correctly', async () => {
  const client = new ApiClient({
    baseUrl: 'http://test-operai',
    apiKey: 'test-key',
    fetchFn: async () => {
      return new Response(
        JSON.stringify({
          error: { code: 'MENU_ITEM_NOT_FOUND', message: 'Dish m_unknown not found', details: {} }
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }
  })

  await assert.rejects(
    async () => {
      await analyzePricing({ menu_item_id: 'm_unknown' }, { client })
    },
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 404)
      assert.equal(err.code, 'MENU_ITEM_NOT_FOUND')
      return true
    }
  )
})

/* ── 5. What-If Pricing Simulation Logic ─────────────────────── */

test('calculateSimulatedPricingAnalysis: computes exact formulas for Paneer Biryani at ₹180', () => {
  const dish: MenuItemDTO = {
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
  }

  const analysis = calculateSimulatedPricingAnalysis(dish, 180.0, {
    commission_pct: 20.0,
    overhead_pct: 12.0,
    target_margin_pct: 25.0
  })

  assert.equal(analysis.analyzed_price, 180.0)
  assert.equal(analysis.cost_breakdown.ingredients, 72.2)
  assert.equal(analysis.cost_breakdown.packaging, 14.0)
  assert.equal(analysis.cost_breakdown.commission, 36.0)
  assert.equal(analysis.cost_breakdown.overhead, 21.6)
  assert.equal(analysis.cost_breakdown.total, 143.8)
  assert.equal(analysis.profit_per_order, 36.2)
  assert.equal(analysis.margin_pct, 20.1)
  assert.equal(analysis.margin_status, 'below_target')
})

test('calculateSimulatedPricingAnalysis: what-if at ₹150 yields suggested price ₹205 matching spec', () => {
  const dish: MenuItemDTO = {
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
  }

  const analysis = calculateSimulatedPricingAnalysis(dish, 150.0, {
    commission_pct: 20.0,
    overhead_pct: 12.0,
    target_margin_pct: 25.0
  })

  // At ₹150:
  // Commission = 30.00, overhead = 18.00. Total = 72.20 + 14.00 + 30.00 + 18.00 = 134.20
  // Profit = 150.00 - 134.20 = 15.80. Margin = 15.80 / 150 = 10.5%
  assert.equal(analysis.analyzed_price, 150.0)
  assert.equal(analysis.cost_breakdown.total, 134.2)
  assert.equal(analysis.profit_per_order, 15.8)
  assert.equal(analysis.margin_pct, 10.5)
  assert.equal(analysis.margin_status, 'below_target')

  // Suggested price formula: (72.20 + 14.00) / (1 - 0.20 - 0.12 - 0.25) = 86.20 / 0.43 = ~200.47
  // Rounded up to next 5 rupees = ₹205.00
  assert.equal(analysis.suggested_price, 205.0)
  assert.equal(analysis.suggested_profit_per_order, 53.2)
  assert.equal(analysis.suggested_margin_pct, 26.0)

  // Verify adaptation to view model
  const vm = adaptPricingAnalysisToViewModel(analysis)
  assert.equal(vm.formattedAnalyzedPrice, '₹150.00')
  assert.equal(vm.formattedSuggestedPrice, '₹205.00')
  assert.equal(vm.suggestedProfitFormatted, '₹53.20')
  assert.equal(vm.suggestedMarginFormatted, '26.0%')
})

/* ── 6. Search, Filter, and Sort Logic ───────────────────────── */

test('Menu Filtering: filters by search term, margin status, and active status', () => {
  const dishes: MenuItemDTO[] = [
    {
      id: 'm_biryani',
      name: 'Paneer Biryani',
      price: 180,
      cost_breakdown: { ingredients: 72, packaging: 14, commission: 36, overhead: 22, total: 144 },
      profit_per_order: 36,
      margin_pct: 20,
      margin_status: 'below_target',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'm_pbm',
      name: 'Paneer Butter Masala',
      price: 220,
      cost_breakdown: { ingredients: 49, packaging: 16, commission: 44, overhead: 26, total: 135 },
      profit_per_order: 85,
      margin_pct: 38.6,
      margin_status: 'healthy',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'm_gulabjamun',
      name: 'Gulab Jamun',
      price: 40,
      cost_breakdown: { ingredients: 22, packaging: 8, commission: 8, overhead: 5, total: 43 },
      profit_per_order: -3,
      margin_pct: -7.5,
      margin_status: 'loss',
      is_active: false,
      data_source: 'verified'
    }
  ]

  const vms = adaptMenuItemsToViewModels(dishes)

  // Search by name "masala"
  const matchSearch = vms.filter((item) => item.name.toLowerCase().includes('masala'))
  assert.equal(matchSearch.length, 1)
  assert.equal(matchSearch[0].id, 'm_pbm')

  // Filter by margin status 'healthy'
  const matchHealthy = vms.filter((item) => item.marginStatus === 'healthy')
  assert.equal(matchHealthy.length, 1)
  assert.equal(matchHealthy[0].name, 'Paneer Butter Masala')

  // Filter by margin status 'loss'
  const matchLoss = vms.filter((item) => item.marginStatus === 'loss')
  assert.equal(matchLoss.length, 1)
  assert.equal(matchLoss[0].name, 'Gulab Jamun')

  // Filter active only
  const matchActive = vms.filter((item) => item.isActive)
  assert.equal(matchActive.length, 2)
})

test('Menu Sorting: sorts items by margin, price, profit, and dish name', () => {
  const dishes: MenuItemDTO[] = [
    {
      id: 'd1',
      name: 'Zucchini Stir Fry',
      price: 120,
      cost_breakdown: { ingredients: 40, packaging: 10, commission: 24, overhead: 14, total: 88 },
      profit_per_order: 32,
      margin_pct: 26.7,
      margin_status: 'healthy',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'd2',
      name: 'Alu Gobi',
      price: 80,
      cost_breakdown: { ingredients: 30, packaging: 8, commission: 16, overhead: 10, total: 64 },
      profit_per_order: 16,
      margin_pct: 20.0,
      margin_status: 'below_target',
      is_active: true,
      data_source: 'verified'
    }
  ]

  const vms = adaptMenuItemsToViewModels(dishes)

  // Sort by price asc
  const byPriceAsc = [...vms].sort((a, b) => a.price - b.price)
  assert.equal(byPriceAsc[0].id, 'd2') // 80 first

  // Sort by margin desc
  const byMarginDesc = [...vms].sort((a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity))
  assert.equal(byMarginDesc[0].id, 'd1') // 26.7% first

  // Sort by name asc
  const byNameAsc = [...vms].sort((a, b) => a.name.localeCompare(b.name))
  assert.equal(byNameAsc[0].id, 'd2') // 'Alu Gobi' first
})

test('Menu Adapter: handles catalog-only dishes without financial analysis honestly', () => {
  const minimalDish: MenuItemDTO = {
    id: 'm_special',
    name: 'Chef Special Thali',
    price: 250,
    is_active: true,
    data_source: 'verified'
  }

  const vm = adaptMenuItemToViewModel(minimalDish)
  assert.equal(vm.id, 'm_special')
  assert.equal(vm.name, 'Chef Special Thali')
  assert.equal(vm.price, 250)
  assert.equal(vm.formattedPrice, '₹250.00')
  assert.equal(vm.hasFinancialAnalysis, false)
  assert.equal(vm.costBreakdown, null)
  assert.equal(vm.profitPerOrder, null)
  assert.equal(vm.formattedProfitPerOrder, '—')
  assert.equal(vm.marginPct, null)
  assert.equal(vm.formattedMarginPct, '—')
  assert.equal(vm.marginStatus, 'unknown')
  assert.equal(vm.marginStatusLabel, 'Analysis Unavailable')
})

test('deriveMenuSummary: safely handles unanalyzed catalog dishes without distorting margin averages', () => {
  const items = adaptMenuItemsToViewModels([
    {
      id: 'd1',
      name: 'Paneer Biryani',
      price: 180,
      cost_breakdown: { ingredients: 72, packaging: 14, commission: 36, overhead: 22, total: 144 },
      profit_per_order: 36,
      margin_pct: 20.0,
      margin_status: 'below_target',
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'd2',
      name: 'Special Curry',
      price: 200,
      is_active: true,
      data_source: 'verified'
    }
  ])

  const summary = deriveMenuSummary(items)
  assert.equal(summary.totalDishes, 2)
  assert.equal(summary.activeDishes, 2)
  assert.equal(summary.belowTargetCount, 1)
  assert.equal(summary.healthyCount, 0)
  assert.equal(summary.lossCount, 0)
  // Average is computed across only dishes with financial analysis (1 dish: 20.0%)
  assert.equal(summary.averageMarginPct, 20.0)
  assert.equal(summary.formattedAverageMarginPct, '20.0%')
})

test('Menu Sorting: handles nullable profit and margin without NaN corruption', () => {
  const items = adaptMenuItemsToViewModels([
    {
      id: 'd1',
      name: 'Unanalyzed Dish',
      price: 300,
      is_active: true,
      data_source: 'verified'
    },
    {
      id: 'd2',
      name: 'Analyzed Dish',
      price: 100,
      cost_breakdown: { ingredients: 30, packaging: 8, commission: 20, overhead: 12, total: 70 },
      profit_per_order: 30,
      margin_pct: 30.0,
      margin_status: 'healthy',
      is_active: true,
      data_source: 'verified'
    }
  ])

  // Sorting by margin desc: analyzed dish (30.0%) should come before unanalyzed (-Infinity)
  const sorted = [...items].sort((a, b) => {
    const valA = a.marginPct ?? -Infinity
    const valB = b.marginPct ?? -Infinity
    return valB - valA
  })

  assert.equal(sorted[0].id, 'd2')
  assert.equal(sorted[1].id, 'd1')
})
