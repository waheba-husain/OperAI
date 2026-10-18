/* ============================================================
   frontend/src/components/shortageRecovery/RecoveryBaselineCard.tsx
   OperAI / Cloud Kitchen Rescue — "Do-Nothing" Baseline Scenario Card

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose response `baseline`)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM can never approve)
   ============================================================ */

import type { RecoveryBaselineViewModel } from '../../types/shortageRecovery.ts'
import './RecoveryBaselineCard.css'

export interface RecoveryBaselineCardProps {
  readonly baseline: RecoveryBaselineViewModel
}

export function RecoveryBaselineCard({ baseline }: RecoveryBaselineCardProps) {
  return (
    <article className="recovery-baseline-card" aria-labelledby="baseline-heading">
      <div className="recovery-baseline-card__header">
        <div className="recovery-baseline-card__badge-row">
          <span className="recovery-baseline-card__type-badge">BASELINE SCENARIO</span>
          <span className="recovery-baseline-card__tag">{baseline.label}</span>
        </div>
        <h3 id="baseline-heading" className="recovery-baseline-card__title">
          Operational Inaction (Do Nothing)
        </h3>
        <p className="recovery-baseline-card__note">
          Default outcome if no recovery intervention is selected.
        </p>
      </div>

      <div className="recovery-baseline-card__metrics-grid">
        <div className="baseline-metric-item baseline-metric-item--negative">
          <span className="baseline-metric-label">Projected Late Orders</span>
          <span className="baseline-metric-val">{baseline.lateOrders} orders</span>
        </div>

        <div className="baseline-metric-item baseline-metric-item--negative">
          <span className="baseline-metric-label">Revenue at Risk</span>
          <span className="baseline-metric-val">{baseline.revenueAtRiskFormatted}</span>
        </div>

        <div className="baseline-metric-item">
          <span className="baseline-metric-label">Additional Cost</span>
          <span className="baseline-metric-val">{baseline.extraCostFormatted}</span>
        </div>
      </div>

      <div className="recovery-baseline-card__footer">
        <span className="baseline-footer-warning-icon" aria-hidden="true">⚠️</span>
        <span className="baseline-footer-text">
          If no recovery action is taken, {baseline.lateOrders} orders will run late with {baseline.revenueAtRiskFormatted} at financial risk.
        </span>
      </div>
    </article>
  )
}
