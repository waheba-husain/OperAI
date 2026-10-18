/* ============================================================
   frontend/src/types/shortageRecovery.ts
   OperAI / Cloud Kitchen Rescue — Shortage & Recovery View Models

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.9 (GET /api/brief)
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM never approves; Rule 7: Substitutions)
   ============================================================ */

import type { ActionImpactDTO, ActionStatusDTO, ActionTypeDTO, RecoveryOptionTypeDTO } from './dto.ts'

/** Presentation view model for an identified inventory deficit */
export interface ShortageItemViewModel {
  readonly ingredientId: string
  readonly name: string
  readonly unit: string
  readonly stockQty: number
  readonly neededQty: number
  readonly shortBy: number
  readonly formattedStock: string
  readonly formattedNeeded: string
  readonly formattedDeficit: string
  readonly revenueAtRisk?: number
  readonly formattedRevenueAtRisk?: string
  readonly atRiskOrderCount?: number
  readonly earliestDeadlineFormatted?: string
}

/** Presentation view model for an affected order at deadline risk */
export interface AtRiskOrderViewModel {
  readonly orderId: string
  readonly orderRef: string
  readonly customerName: string
  readonly deadline: string
  readonly deadlineFormatted: string
  readonly totalAmount: number
  readonly totalAmountFormatted: string
}

/** Presentation view model for the "Do Nothing" baseline */
export interface RecoveryBaselineViewModel {
  readonly label: string
  readonly lateOrders: number
  readonly revenueAtRisk: number
  readonly revenueAtRiskFormatted: string
  readonly extraCost: number
  readonly extraCostFormatted: string
}

/** Presentation view model for a candidate recovery proposal */
export interface RecoveryOptionViewModel {
  readonly actionId: string
  readonly optionNumber: number
  readonly optionType: RecoveryOptionTypeDTO
  readonly optionTypeLabel: string
  readonly title: string
  readonly status: ActionStatusDTO
  readonly needsCustomerConsent: boolean
  readonly isRecommended: boolean
  readonly ordersProtected: number
  readonly lateOrders: number
  readonly revenueAtRiskAfter?: number
  readonly revenueAtRiskAfterFormatted?: string
  readonly extraCost: number
  readonly extraCostFormatted: string
  readonly extraCostLabel: string
  readonly marginBeforePct?: number
  readonly marginAfterPct?: number
  readonly marginDeltaPct?: number
  readonly customerRisk?: 'low' | 'medium' | 'high'
  readonly score: number
  readonly scorePct: number
  readonly expiresAt: string
  readonly expiresAtFormatted: string
}

/** Grouped response payload for simulated recovery options */
export interface RecoveryProposalResultViewModel {
  readonly groupId?: string
  readonly shortageSummary?: {
    readonly ingredientId: string
    readonly name: string
    readonly shortByFormatted: string
    readonly unit: string
  }
  readonly baseline?: RecoveryBaselineViewModel
  readonly scoringWeights?: {
    readonly lateness: number
    readonly margin: number
    readonly customerRisk: number
  }
  readonly recommendedOptionNumber?: number
  readonly options: readonly RecoveryOptionViewModel[]
  readonly escalation?: string
}

/** High-level operational summary metrics for the shortage page */
export interface ShortageRecoverySummary {
  readonly date: string
  readonly formattedDate: string
  readonly dataSource: string
  readonly shortageCount: number
  readonly atRiskOrderCount: number
  readonly revenueAtRiskFormatted: string
  readonly hasActiveShortages: boolean
}

/** Presentation view model for a customer notification draft returned upon approval (Rest_API_Spec.md §3.12) */
export interface CustomerMessageViewModel {
  readonly orderId: string
  readonly customerName: string
  readonly needsConsent: boolean
  readonly message: string
  readonly whatsappUrl: string
}

/** Presentation view model for the result of a successful action approval (Rest_API_Spec.md §3.12) */
export interface ApprovalResultViewModel {
  readonly actionId: string
  readonly status: 'executed'
  readonly executedAt: string
  readonly executedAtFormatted: string
  readonly planVersionBefore: number
  readonly planVersionAfter: number
  readonly auditId: string
  readonly changes: {
    readonly ordersAffected: readonly string[]
    readonly tasksRescheduled: number
    readonly summary: string
  }
  readonly customerMessages: readonly CustomerMessageViewModel[]
  readonly expiredActionIds: readonly string[]
}

/** Presentation view model for the result of an action rejection (Rest_API_Spec.md §3.13) */
export interface RejectionResultViewModel {
  readonly actionId: string
  readonly status: 'rejected'
  readonly decidedAt: string
  readonly decidedAtFormatted: string
  readonly auditId: string
}

/** Presentation view model for pending actions retrieved via GET /api/actions (Rest_API_Spec.md §3.11) */
export interface PendingActionViewModel {
  readonly id: string
  readonly groupId: string
  readonly optionNumber: number
  readonly actionType: ActionTypeDTO
  readonly title: string
  readonly status: ActionStatusDTO
  readonly impact?: ActionImpactDTO | null
  readonly impactSummary: string
  readonly basePlanVersion?: number
  readonly createdAt?: string
  readonly createdAtFormatted?: string
  readonly expiresAt: string
  readonly expiresAtFormatted: string
  readonly isExpired: boolean
}
