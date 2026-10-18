/* ============================================================
   frontend/src/components/shortageRecovery/RecoverySimulationResults.tsx
   OperAI / Cloud Kitchen Rescue — Recovery Simulation Comparison Results

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.10 (POST /api/recovery/propose)
   - docs/Rest_API_Spec.md §3.12 (POST /api/actions/{id}/approve)
   - docs/Rest_API_Spec.md §3.13 (POST /api/actions/{id}/reject)
   - AGENTS.md (Rule 1: Numbers from code; Rule 2: LLM can never approve; Rule 4: Explicit option number)
   ============================================================ */

import type { RecoveryProposalResultViewModel } from '../../types/shortageRecovery.ts'
import { formatActionErrorMessage } from '../../api/adapters/actionAdapter.ts'
import { RecoveryBaselineCard } from './RecoveryBaselineCard.tsx'
import { RecoveryOptionCard } from './RecoveryOptionCard.tsx'
import './RecoverySimulationResults.css'

export interface RecoverySimulationResultsProps {
  readonly proposal: RecoveryProposalResultViewModel | null
  readonly isProposing: boolean
  readonly onClearProposal: () => void
  readonly onApprove?: (actionId: string, optionNumber: number) => void
  readonly onReject?: (actionId: string) => void
  readonly isApprovingActionId?: string | null
  readonly isRejectingActionId?: string | null
  readonly actionMutationError?: { readonly actionId: string; readonly error: Error } | null
  readonly isDemoMode?: boolean
}

export function RecoverySimulationResults({
  proposal,
  isProposing,
  onClearProposal,
  onApprove,
  onReject,
  isApprovingActionId = null,
  isRejectingActionId = null,
  actionMutationError = null,
  isDemoMode = false
}: RecoverySimulationResultsProps) {
  if (isProposing) {
    return (
      <section
        className="simulation-results-section"
        aria-busy="true"
        aria-label="Simulation in progress"
      >
        <div className="simulation-loading-card">
          <div className="simulation-loading-spinner" aria-hidden="true" />
          <h3 className="simulation-loading-title">Evaluating Recovery Formulations</h3>
          <p className="simulation-loading-desc">
            Solving trade-offs across order deadlines, ingredient substitutions, emergency restock, and kitchen margins...
          </p>
        </div>
      </section>
    )
  }

  if (!proposal) {
    return (
      <section className="simulation-results-section" aria-label="Simulation prompt">
        <div className="simulation-idle-card">
          <div className="simulation-idle-icon" aria-hidden="true">💡</div>
          <h3 className="simulation-idle-title">No Active Recovery Simulation</h3>
          <p className="simulation-idle-desc">
            Select an ingredient shortage from the panel above and click <strong>Simulate Recovery Options</strong> to generate deterministic recovery strategies.
          </p>
        </div>
      </section>
    )
  }

  const { shortageSummary, baseline, options, escalation, recommendedOptionNumber } = proposal
  const isAnyMutationPending = Boolean(isApprovingActionId || isRejectingActionId)

  return (
    <section
      className="simulation-results-section"
      aria-labelledby="simulation-results-heading"
    >
      <div className="simulation-results-header">
        <div>
          <span className="simulation-results-kicker">SOLVER EVALUATION</span>
          <h2 id="simulation-results-heading" className="simulation-results-title">
            Recovery Options {shortageSummary ? `for ${shortageSummary.name}` : ''}
          </h2>
          {shortageSummary && (
            <p className="simulation-results-subtitle">
              Deficit: <strong>{shortageSummary.shortByFormatted}</strong>
            </p>
          )}
        </div>

        <button
          type="button"
          className="simulation-clear-btn"
          onClick={onClearProposal}
          aria-label="Clear active simulation"
          disabled={isAnyMutationPending}
        >
          Clear Simulation
        </button>
      </div>

      {/* Escalation Notice if engine returned escalation message */}
      {escalation && (
        <div className="simulation-escalation-alert" role="alert">
          <span className="simulation-escalation-icon" aria-hidden="true">🚨</span>
          <div>
            <strong className="simulation-escalation-title">Recovery Escalation</strong>
            <p className="simulation-escalation-msg">{escalation}</p>
          </div>
        </div>
      )}

      {/* Comparison Container: Baseline Side-by-Side or Sequential */}
      <div className="simulation-comparison-container">
        {/* Do-Nothing Baseline Card */}
        {baseline && (
          <div className="simulation-baseline-wrapper">
            <RecoveryBaselineCard baseline={baseline} />
          </div>
        )}

        {/* Options List */}
        <div className="simulation-options-wrapper">
          <div className="simulation-options-header">
            <h3 className="simulation-options-title">
              Formulated Candidate Options ({options.length})
            </h3>
            {recommendedOptionNumber !== undefined && recommendedOptionNumber !== null && (
              <span className="simulation-recommendation-note">
                Engine recommends <strong>Option #{recommendedOptionNumber}</strong>
              </span>
            )}
          </div>

          {options.length === 0 ? (
            <div className="simulation-no-options-card" role="status">
              <span className="simulation-no-options-icon" aria-hidden="true">ℹ️</span>
              <h4 className="simulation-no-options-title">No Feasible Options Generated</h4>
              <p className="simulation-no-options-desc">
                The constraint solver found no substitution, expedited purchase, or menu swap that safely resolves this shortage within current kitchen constraints.
              </p>
            </div>
          ) : (
            <div className="simulation-options-grid" role="list">
              {options.map((opt) => (
                <RecoveryOptionCard
                  key={opt.actionId}
                  option={opt}
                  onApprove={onApprove}
                  onReject={onReject}
                  isApproving={isApprovingActionId === opt.actionId}
                  isRejecting={isRejectingActionId === opt.actionId}
                  isAnyMutationPending={isAnyMutationPending}
                  mutationError={
                    actionMutationError?.actionId === opt.actionId
                      ? formatActionErrorMessage(actionMutationError.error)
                      : null
                  }
                  isDemoMode={isDemoMode}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
