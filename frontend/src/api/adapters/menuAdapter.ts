/* ============================================================
   frontend/src/api/adapters/menuAdapter.ts
   OperAI / Cloud Kitchen Rescue — Menu & Pricing Presentation Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.3 (GET /api/menu)
   - docs/Rest_API_Spec.md §3.4 (POST /api/pricing/analyze)
   - docs/features.md § Feature 1 & 9
   - AGENTS.md (Rule 1: Numbers from code, never LLM; Rule 9: Honest data labels)
   ============================================================ */

import type {
  CostBreakdownDTO,
  DataSourceDTO,
  MarginStatusDTO,
  MenuItemDTO,
  PricingAnalysisAssumptionsDTO,
  PricingAnalysisResponseDTO
} from '../../types/dto.ts'
import type {
  CostBreakdownViewModel,
  MenuItemViewModel,
  MenuSummaryMetrics,
  PricingAnalysisViewModel
} from '../../types/menuPricing.ts'
import { formatCurrency } from './orderAdapter.ts'

export const MARGIN_STATUS_DISPLAY_MAP: Record<MarginStatusDTO | 'unknown', string> = {
  loss: 'Loss Making',
  below_target: 'Below Target (<25%)',
  healthy: 'Healthy Margin',
  unknown: 'Analysis Unavailable'
}

/**
 * Maps a MarginStatusDTO to a human-readable display label.
 */
export function formatMarginStatusLabel(status: MarginStatusDTO | 'unknown'): string {
  return MARGIN_STATUS_DISPLAY_MAP[status] ?? status
}

/**
 * Transforms a CostBreakdownDTO into a presentation CostBreakdownViewModel.
 */
export function adaptCostBreakdown(cost?: CostBreakdownDTO | null): CostBreakdownViewModel {
  const ingredients = Number(cost?.ingredients ?? 0)
  const packaging = Number(cost?.packaging ?? 0)
  const commission = Number(cost?.commission ?? 0)
  const overhead = Number(cost?.overhead ?? 0)
  const total = Number(cost?.total ?? (ingredients + packaging + commission + overhead))

  return {
    ingredients,
    formattedIngredients: formatCurrency(ingredients),
    packaging,
    formattedPackaging: formatCurrency(packaging),
    commission,
    formattedCommission: formatCurrency(commission),
    overhead,
    formattedOverhead: formatCurrency(overhead),
    total,
    formattedTotal: formatCurrency(total)
  }
}

/**
 * Transforms a raw MenuItemDTO into a presentation MenuItemViewModel.
 *
 * DATA INTEGRITY (AGENTS.md Rule 1 & Rule 9):
 * If a live catalog dish does not include a precomputed cost breakdown
 * or profit margin, we do NOT invent fake ₹0.00 costs or falsify healthy margins.
 * Instead, hasFinancialAnalysis is marked false, and costs are displayed as '—'.
 */
export function adaptMenuItemToViewModel(
  item: MenuItemDTO,
  dataSourceOverride?: DataSourceDTO
): MenuItemViewModel {
  const price = Number(item.price ?? 0)
  const dataSource = dataSourceOverride ?? item.data_source ?? 'verified'
  const hasFinancial = Boolean(
    item.cost_breakdown &&
    item.profit_per_order !== undefined &&
    item.profit_per_order !== null &&
    item.margin_pct !== undefined &&
    item.margin_pct !== null
  )

  const costBreakdown = item.cost_breakdown ? adaptCostBreakdown(item.cost_breakdown) : null
  const profitPerOrder = hasFinancial ? Number(item.profit_per_order) : null
  const marginPct = hasFinancial ? Number(item.margin_pct) : null
  const marginStatus = hasFinancial
    ? (item.margin_status ?? ((profitPerOrder ?? 0) < 0 ? 'loss' : 'healthy'))
    : 'unknown'

  return {
    id: item.id,
    name: item.name,
    price,
    formattedPrice: formatCurrency(price),
    hasFinancialAnalysis: hasFinancial,
    costBreakdown,
    profitPerOrder,
    formattedProfitPerOrder: profitPerOrder !== null ? formatCurrency(profitPerOrder) : '—',
    marginPct,
    formattedMarginPct: marginPct !== null ? `${marginPct.toFixed(1)}%` : '—',
    marginStatus,
    marginStatusLabel: formatMarginStatusLabel(marginStatus),
    isActive: Boolean(item.is_active ?? true),
    dataSource
  }
}

/**
 * Transforms a list of MenuItemDTOs into presentation MenuItemViewModels.
 */
export function adaptMenuItemsToViewModels(
  items: readonly MenuItemDTO[],
  dataSourceOverride?: DataSourceDTO
): MenuItemViewModel[] {
  return items.map((item) => adaptMenuItemToViewModel(item, dataSourceOverride))
}

/**
 * Transforms a PricingAnalysisResponseDTO into a presentation PricingAnalysisViewModel.
 */
export function adaptPricingAnalysisToViewModel(
  analysis: PricingAnalysisResponseDTO
): PricingAnalysisViewModel {
  const analyzedPrice = Number(analysis.analyzed_price ?? 0)
  const currentPrice = Number(analysis.current_price ?? 0)
  const profitPerOrder = Number(analysis.profit_per_order ?? 0)
  const marginPct = Number(analysis.margin_pct ?? 0)
  const suggestedPrice = Number(analysis.suggested_price ?? 0)
  const suggestedProfit = Number(analysis.suggested_profit_per_order ?? 0)
  const suggestedMargin = Number(analysis.suggested_margin_pct ?? 0)

  return {
    menuItemId: analysis.menu_item_id,
    name: analysis.name,
    analyzedPrice,
    formattedAnalyzedPrice: formatCurrency(analyzedPrice),
    currentPrice,
    formattedCurrentPrice: formatCurrency(currentPrice),
    costBreakdown: adaptCostBreakdown(analysis.cost_breakdown),
    profitPerOrder,
    formattedProfitPerOrder: formatCurrency(profitPerOrder),
    marginPct,
    formattedMarginPct: `${marginPct.toFixed(1)}%`,
    marginStatus: analysis.margin_status,
    marginStatusLabel: formatMarginStatusLabel(analysis.margin_status),
    suggestedPrice,
    formattedSuggestedPrice: formatCurrency(suggestedPrice),
    suggestedProfitPerOrder: suggestedProfit,
    suggestedProfitFormatted: formatCurrency(suggestedProfit),
    suggestedMarginPct: suggestedMargin,
    suggestedMarginFormatted: `${suggestedMargin.toFixed(1)}%`,
    assumptions: {
      commissionPct: Number(analysis.assumptions?.commission_pct ?? 20),
      overheadPct: Number(analysis.assumptions?.overhead_pct ?? 12),
      targetMarginPct: Number(analysis.assumptions?.target_margin_pct ?? 25),
      dataSource: analysis.assumptions?.data_source ?? 'simulated'
    },
    action: analysis.action ?? null
  }
}

/**
 * Derives kitchen economics summary metrics from a set of menu items.
 * Deterministic code computation per AGENTS.md Rule 1.
 * Only averages margin % across dishes that actually have financial analysis.
 */
export function deriveMenuSummary(items: readonly MenuItemViewModel[]): MenuSummaryMetrics {
  const totalDishes = items.length
  let activeDishes = 0
  let healthyCount = 0
  let belowTargetCount = 0
  let lossCount = 0
  let sumMarginPct = 0
  let analyzedDishes = 0

  for (const item of items) {
    if (item.isActive) {
      activeDishes += 1
    }
    if (item.marginStatus === 'healthy') {
      healthyCount += 1
    } else if (item.marginStatus === 'below_target') {
      belowTargetCount += 1
    } else if (item.marginStatus === 'loss') {
      lossCount += 1
    }
    if (item.hasFinancialAnalysis && item.marginPct !== null) {
      sumMarginPct += item.marginPct
      analyzedDishes += 1
    }
  }

  const averageMarginPct =
    analyzedDishes > 0 ? Number((sumMarginPct / analyzedDishes).toFixed(1)) : 0.0

  return {
    totalDishes,
    activeDishes,
    healthyCount,
    belowTargetCount,
    lossCount,
    averageMarginPct,
    formattedAverageMarginPct:
      analyzedDishes > 0 ? `${averageMarginPct.toFixed(1)}%` : totalDishes > 0 ? '—' : '0.0%'
  }
}

/**
 * Deterministically simulates pricing analysis in demo mode according to
 * the exact backend specification (features.md Feature 1 & 9; Rest_API_Spec.md §3.4).
 *
 * Rules:
 * - commission = price * commission_pct / 100
 * - overhead = price * overhead_pct / 100
 * - total = ingredients + packaging + commission + overhead
 * - profit = price - total
 * - margin_pct = profit / price * 100
 * - suggested_price = (ingredients + packaging) / (1 - commission% - overhead% - target_margin%)
 *   rounded up to the next 5 rupees
 */
export function calculateSimulatedPricingAnalysis(
  item: MenuItemDTO,
  customPrice?: number,
  assumptions?: Partial<PricingAnalysisAssumptionsDTO>
): PricingAnalysisResponseDTO {
  const commissionPct = assumptions?.commission_pct ?? 20.0
  const overheadPct = assumptions?.overhead_pct ?? 12.0
  const targetMarginPct = assumptions?.target_margin_pct ?? 25.0
  const dataSource = assumptions?.data_source ?? 'simulated'

  const analyzedPrice = Number((customPrice ?? item.price).toFixed(2))
  const ingredients = Number((item.cost_breakdown?.ingredients ?? 0).toFixed(2))
  const packaging = Number((item.cost_breakdown?.packaging ?? 0).toFixed(2))

  const commission = Number(((analyzedPrice * commissionPct) / 100).toFixed(2))
  const overhead = Number(((analyzedPrice * overheadPct) / 100).toFixed(2))
  const total = Number((ingredients + packaging + commission + overhead).toFixed(2))
  const profit = Number((analyzedPrice - total).toFixed(2))
  const marginPct = analyzedPrice > 0 ? Number(((profit / analyzedPrice) * 100).toFixed(1)) : 0.0

  const marginStatus: MarginStatusDTO =
    profit < 0 ? 'loss' : marginPct < targetMarginPct ? 'below_target' : 'healthy'

  // Suggested price formula from features.md Feature 9
  const denominator = 1 - (commissionPct + overheadPct + targetMarginPct) / 100
  let suggestedPrice = analyzedPrice
  if (denominator > 0) {
    const rawSuggested = (ingredients + packaging) / denominator
    suggestedPrice = Math.ceil(rawSuggested / 5) * 5
  }

  const suggestedCommission = Number(((suggestedPrice * commissionPct) / 100).toFixed(2))
  const suggestedOverhead = Number(((suggestedPrice * overheadPct) / 100).toFixed(2))
  const suggestedTotal = Number(
    (ingredients + packaging + suggestedCommission + suggestedOverhead).toFixed(2)
  )
  const suggestedProfit = Number((suggestedPrice - suggestedTotal).toFixed(2))
  const suggestedMargin =
    suggestedPrice > 0 ? Number(((suggestedProfit / suggestedPrice) * 100).toFixed(1)) : 0.0

  return {
    menu_item_id: item.id,
    name: item.name,
    analyzed_price: analyzedPrice,
    current_price: Number(item.price.toFixed(2)),
    cost_breakdown: {
      ingredients,
      packaging,
      commission,
      overhead,
      total
    },
    profit_per_order: profit,
    margin_pct: marginPct,
    margin_status: marginStatus,
    suggested_price: suggestedPrice,
    suggested_profit_per_order: suggestedProfit,
    suggested_margin_pct: suggestedMargin,
    assumptions: {
      commission_pct: commissionPct,
      overhead_pct: overheadPct,
      target_margin_pct: targetMarginPct,
      data_source: dataSource
    },
    action: null
  }
}
