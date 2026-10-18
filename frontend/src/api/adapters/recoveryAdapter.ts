/* ============================================================
   frontend/src/api/adapters/recoveryAdapter.ts
   OperAI / Cloud Kitchen Rescue — Shortage & Recovery Adapters

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.9 (GET /api/brief)
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM never approves; Rule 9: Honest data labels)
   ============================================================ */

import type {
  AtRiskOrderDTO,
  BriefResponseDTO,
  RecoveryBaselineDTO,
  RecoveryOptionDTO,
  RecoveryOptionTypeDTO,
  RecoveryProposeResponseDTO,
  ShortageDTO
} from '../../types/dto.ts'
import type {
  AtRiskOrderViewModel,
  RecoveryBaselineViewModel,
  RecoveryOptionViewModel,
  RecoveryProposalResultViewModel,
  ShortageItemViewModel,
  ShortageRecoverySummary
} from '../../types/shortageRecovery.ts'
import { formatDateIST, formatTimeIST } from './orderAdapter.ts'

/**
 * Format a numeric amount into Indian Rupee (INR) currency string.
 * Example: 1180 -> "₹1,180.00", -147.2 -> "-₹147.20"
 */
export function formatCurrencyINR(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '₹0.00'
  }
  const isNegative = amount < 0
  const absolute = Math.abs(amount)
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(absolute)
  return isNegative ? `-₹${formatted}` : `₹${formatted}`
}

/**
 * Maps RecoveryOptionTypeDTO to human-friendly title badge.
 */
export function formatOptionTypeLabel(type: RecoveryOptionTypeDTO): string {
  switch (type) {
    case 'substitute':
      return 'Recipe Substitution'
    case 'emergency_purchase':
      return 'Emergency Purchase'
    case 'dish_swap':
      return 'Dish Swap'
    case 'delay_notify':
      return 'Delay & Notify'
    case 'partial':
      return 'Partial Fulfillment'
  }
}

/**
 * Formats signed extra cost description.
 */
export function formatExtraCostLabel(extraCost: number): string {
  if (extraCost < 0) {
    return `Saves ${formatCurrencyINR(Math.abs(extraCost))}`
  }
  if (extraCost > 0) {
    return `+${formatCurrencyINR(extraCost)} cost`
  }
  return '₹0.00 extra cost'
}

/**
 * Transforms a ShortageDTO from GET /api/brief into a ShortageItemViewModel.
 */
export function adaptShortageToViewModel(
  shortage: ShortageDTO,
  earliestDeadline?: string
): ShortageItemViewModel {
  return {
    ingredientId: shortage.ingredient_id,
    name: shortage.name,
    unit: shortage.unit,
    stockQty: shortage.stock_qty,
    neededQty: shortage.needed_qty,
    shortBy: shortage.short_by,
    formattedStock: `${shortage.stock_qty.toFixed(2)} ${shortage.unit}`,
    formattedNeeded: `${shortage.needed_qty.toFixed(2)} ${shortage.unit}`,
    formattedDeficit: `-${shortage.short_by.toFixed(2)} ${shortage.unit}`,
    earliestDeadlineFormatted: earliestDeadline ? formatTimeIST(earliestDeadline) : undefined
  }
}

/**
 * Transforms all shortages in a BriefResponseDTO.
 */
export function adaptShortagesToViewModels(brief: BriefResponseDTO): ShortageItemViewModel[] {
  const earliestDeadline = brief.at_risk_orders.length > 0
    ? brief.at_risk_orders
        .map((o) => o.deadline)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
    : undefined

  return brief.shortages.map((shortage) =>
    adaptShortageToViewModel(shortage, earliestDeadline)
  )
}

/**
 * Transforms at-risk orders into presentation view models.
 */
export function adaptAtRiskOrdersToViewModels(
  orders: readonly AtRiskOrderDTO[]
): AtRiskOrderViewModel[] {
  return orders.map((o) => ({
    orderId: o.order_id,
    orderRef: `#ORD-${o.order_id.slice(0, 4).toUpperCase()}`,
    customerName: o.customer_name,
    deadline: o.deadline,
    deadlineFormatted: formatTimeIST(o.deadline),
    totalAmount: o.total_amount,
    totalAmountFormatted: formatCurrencyINR(o.total_amount)
  }))
}

/**
 * Transforms the "Do Nothing" baseline into a presentation view model.
 */
export function adaptRecoveryBaselineToViewModel(
  baseline: RecoveryBaselineDTO
): RecoveryBaselineViewModel {
  return {
    label: baseline.label,
    lateOrders: baseline.late_orders,
    revenueAtRisk: baseline.revenue_at_risk,
    revenueAtRiskFormatted: formatCurrencyINR(baseline.revenue_at_risk),
    extraCost: baseline.extra_cost,
    extraCostFormatted: formatCurrencyINR(baseline.extra_cost)
  }
}

/**
 * Transforms a single recovery option candidate into a presentation view model.
 */
export function adaptRecoveryOptionToViewModel(
  option: RecoveryOptionDTO,
  recommendedOptionNumber?: number
): RecoveryOptionViewModel {
  const impact = option.impact
  const marginDelta =
    impact.margin_after_pct !== undefined && impact.margin_before_pct !== undefined
      ? Number((impact.margin_after_pct - impact.margin_before_pct).toFixed(1))
      : undefined

  const revenueAtRiskAfter = impact.revenue_at_risk_after
  const revenueAtRiskAfterFormatted =
    revenueAtRiskAfter !== undefined ? formatCurrencyINR(revenueAtRiskAfter) : undefined

  return {
    actionId: option.action_id,
    optionNumber: option.option_number,
    optionType: option.option_type,
    optionTypeLabel: formatOptionTypeLabel(option.option_type),
    title: option.title,
    status: option.status,
    needsCustomerConsent: option.needs_customer_consent,
    isRecommended:
      recommendedOptionNumber !== undefined &&
      recommendedOptionNumber !== null &&
      option.option_number === recommendedOptionNumber,
    ordersProtected: impact.orders_protected,
    lateOrders: impact.late_orders,
    revenueAtRiskAfter,
    revenueAtRiskAfterFormatted,
    extraCost: impact.extra_cost,
    extraCostFormatted: formatCurrencyINR(impact.extra_cost),
    extraCostLabel: formatExtraCostLabel(impact.extra_cost),
    marginBeforePct: impact.margin_before_pct,
    marginAfterPct: impact.margin_after_pct,
    marginDeltaPct: marginDelta,
    customerRisk: impact.customer_risk,
    score: impact.score,
    scorePct: Math.round(impact.score * 100),
    expiresAt: option.expires_at,
    expiresAtFormatted: formatTimeIST(option.expires_at)
  }
}

/**
 * Transforms the response of POST /api/recovery/propose into a full proposal result view model.
 */
export function adaptRecoveryResponseToViewModel(
  response: RecoveryProposeResponseDTO
): RecoveryProposalResultViewModel {
  const shortageSummary = response.shortage
    ? {
        ingredientId: response.shortage.ingredient_id,
        name: response.shortage.name,
        shortByFormatted: `${response.shortage.short_by.toFixed(2)} ${response.shortage.unit}`,
        unit: response.shortage.unit
      }
    : undefined

  const baseline = response.baseline ? adaptRecoveryBaselineToViewModel(response.baseline) : undefined

  const options = (response.options ?? []).map((opt) =>
    adaptRecoveryOptionToViewModel(opt, response.recommended_option_number)
  )

  return {
    groupId: response.group_id,
    shortageSummary,
    baseline,
    scoringWeights: response.scoring?.weights
      ? {
          lateness: response.scoring.weights.lateness,
          margin: response.scoring.weights.margin,
          customerRisk: response.scoring.weights.customer_risk
        }
      : undefined,
    recommendedOptionNumber: response.recommended_option_number,
    options,
    escalation: response.escalation
  }
}

/**
 * Derives operational summary metrics for the Shortage & Recovery ribbon.
 */
export function deriveShortageRecoverySummary(
  brief: BriefResponseDTO | null,
  targetDate: string
): ShortageRecoverySummary {
  const shortageCount = brief?.shortages?.length ?? 0
  const atRiskOrderCount = brief?.at_risk_orders?.length ?? 0
  const revenueAtRisk = brief?.revenue_at_risk ?? 0

  return {
    date: targetDate,
    formattedDate: formatDateIST(targetDate),
    dataSource: brief?.data_source ?? 'simulated',
    shortageCount,
    atRiskOrderCount,
    revenueAtRiskFormatted: formatCurrencyINR(revenueAtRisk),
    hasActiveShortages: shortageCount > 0
  }
}
