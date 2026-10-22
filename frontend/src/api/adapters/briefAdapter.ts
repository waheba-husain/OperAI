/* ============================================================
   frontend/src/api/adapters/briefAdapter.ts
   OperAI / Cloud Kitchen Rescue — Risk Brief DTO to View-Model Adapter

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.9 (BriefResponseDTO, ShortageDTO)
   - frontend/src/types/overview.ts (IngredientAlert, AiKitchenBriefing)

   RULES:
   1. The backend provides point-in-time stock and needed quantities.
   2. Neither /api/brief nor ingredients table has a 'category' field.
      Safe presentation default is applied and documented.
   3. Backend does not predict hourly stockout timestamps ('impactTime').
      Earliest deadline of affected orders is used when available.
   ============================================================ */

import type { BriefResponseDTO, ShortageDTO } from '../../types/dto'
import type { AiBriefingObservation, AiKitchenBriefing, IngredientAlert, UrgencyLevel } from '../../types/overview'
import { formatTimeIST } from './orderAdapter.ts'

/**
 * Transforms a ShortageDTO into an IngredientAlert view model for the Overview panel.
 *
 * @param shortage Shortage record from GET /api/brief
 * @param earliestDeadline Earliest deadline among orders affected by this shortage
 * @param affectedOrderCount Number of orders affected by shortages
 */
export function adaptShortageToIngredientAlert(
  shortage: ShortageDTO,
  earliestDeadline?: string,
  affectedOrderCount: number = 0
): IngredientAlert {
  const urgency: UrgencyLevel = shortage.short_by > 0 ? 'critical' : 'warning'
  const impactTime = earliestDeadline ? formatTimeIST(earliestDeadline) : 'Immediate'

  return {
    id: shortage.ingredient_id,
    name: shortage.name,
    // Documented limitation: backend ingredients table does not have a category column.
    category: 'Kitchen Inventory',
    currentStock: `${shortage.stock_qty} ${shortage.unit}`,
    requiredStock: `${shortage.needed_qty} ${shortage.unit}`,
    deficit: `-${shortage.short_by} ${shortage.unit}`,
    impactTime,
    urgency,
    affectedDishesCount: affectedOrderCount
  }
}

/**
 * Adapts all shortages in a BriefResponseDTO to an array of IngredientAlerts.
 */
export function adaptBriefToIngredientAlerts(brief: BriefResponseDTO): IngredientAlert[] {
  // Find earliest deadline among at_risk_orders if any exist
  const earliestDeadline = brief.at_risk_orders.length > 0
    ? brief.at_risk_orders
        .map((o) => o.deadline)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
    : undefined

  return brief.shortages.map((shortage) =>
    adaptShortageToIngredientAlert(shortage, earliestDeadline, brief.at_risk_orders.length)
  )
}

/**
 * Synthesizes an AiKitchenBriefing view model from a BriefResponseDTO and pending action count.
 */
export function adaptBriefToAiBriefing(
  brief: BriefResponseDTO,
  pendingActionCount: number = 0
): AiKitchenBriefing {
  const hasShortage = brief.shortages.length > 0
  const observations: AiBriefingObservation[] = []

  if (hasShortage) {
    const shortageNames = brief.shortages.map((s) => s.name).join(', ')
    observations.push({
      id: 'obs-shortage',
      tag: 'Shortage Horizon',
      text: `${brief.shortages.length} shortage(s) detected (${shortageNames}). ₹${brief.revenue_at_risk.toFixed(2)} exposed across ${brief.at_risk_orders.length} order(s).`,
      urgency: 'alert'
    })
  } else {
    observations.push({
      id: 'obs-clean',
      tag: 'Inventory Horizon',
      text: `Stock levels fully satisfy all ${brief.order_count} scheduled orders for ${brief.date}. Zero revenue at risk.`,
      urgency: 'positive'
    })
  }

  if (pendingActionCount > 0) {
    observations.push({
      id: 'obs-actions',
      tag: 'Pending Decisions',
      text: `${pendingActionCount} proposed action(s) awaiting owner review and option confirmation.`,
      urgency: 'notice'
    })
  }

  return {
    title: 'Daily Operational Briefing',
    timestamp: new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }),
    statusBadge: hasShortage ? 'Attention Required' : 'All Clear',
    observations,
    recommendedAction: {
      description: hasShortage
        ? 'Review generated recovery options and confirm an approval option.'
        : 'Operations pacing on schedule. Monitor live queue for new intake.',
      targetLabel: hasShortage ? 'Review Recovery' : 'Live Operations',
      targetPageId: hasShortage ? 'shortage-recovery' : 'live-operations'
    }
  }
}
