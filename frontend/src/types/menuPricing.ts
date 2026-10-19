/* ============================================================
   frontend/src/types/menuPricing.ts
   OperAI / Cloud Kitchen Rescue — Menu & Pricing Presentation Types

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.3 (GET /api/menu)
   - docs/Rest_API_Spec.md §3.4 (POST /api/pricing/analyze)
   - docs/Database_Schema.md §3.3 (menu_items)
   - AGENTS.md (Rule 1: Numbers from code; Rule 9: Honest data provenance)
   ============================================================ */

import type { DataSourceDTO, MarginStatusDTO, ProposedActionDTO } from './dto.ts'

export interface CostBreakdownViewModel {
  readonly ingredients: number
  readonly formattedIngredients: string
  readonly packaging: number
  readonly formattedPackaging: string
  readonly commission: number
  readonly formattedCommission: string
  readonly overhead: number
  readonly formattedOverhead: string
  readonly total: number
  readonly formattedTotal: string
}

export interface MenuItemViewModel {
  readonly id: string
  readonly name: string
  readonly price: number
  readonly formattedPrice: string
  readonly hasFinancialAnalysis: boolean
  readonly costBreakdown: CostBreakdownViewModel | null
  readonly profitPerOrder: number | null
  readonly formattedProfitPerOrder: string
  readonly marginPct: number | null
  readonly formattedMarginPct: string
  readonly marginStatus: MarginStatusDTO | 'unknown'
  readonly marginStatusLabel: string
  readonly isActive: boolean
  readonly dataSource: DataSourceDTO
}

export interface MenuSummaryMetrics {
  readonly totalDishes: number
  readonly activeDishes: number
  readonly healthyCount: number
  readonly belowTargetCount: number
  readonly lossCount: number
  readonly averageMarginPct: number
  readonly formattedAverageMarginPct: string
}

export interface PricingAnalysisAssumptionsViewModel {
  readonly commissionPct: number
  readonly overheadPct: number
  readonly targetMarginPct: number
  readonly dataSource: DataSourceDTO
}

export interface PricingAnalysisViewModel {
  readonly menuItemId: string
  readonly name: string
  readonly analyzedPrice: number
  readonly formattedAnalyzedPrice: string
  readonly currentPrice: number
  readonly formattedCurrentPrice: string
  readonly costBreakdown: CostBreakdownViewModel
  readonly profitPerOrder: number
  readonly formattedProfitPerOrder: string
  readonly marginPct: number
  readonly formattedMarginPct: string
  readonly marginStatus: MarginStatusDTO
  readonly marginStatusLabel: string
  readonly suggestedPrice: number
  readonly formattedSuggestedPrice: string
  readonly suggestedProfitPerOrder: number
  readonly suggestedProfitFormatted: string
  readonly suggestedMarginPct: number
  readonly suggestedMarginFormatted: string
  readonly assumptions: PricingAnalysisAssumptionsViewModel
  readonly action: ProposedActionDTO | null
}

export type MenuMarginFilter = 'all' | 'healthy' | 'below_target' | 'loss'
export type MenuActiveFilter = 'all' | 'active' | 'inactive'
export type MenuSortField = 'name' | 'price' | 'profit' | 'margin'
export type MenuSortDirection = 'asc' | 'desc'
