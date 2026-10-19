/* ============================================================
   frontend/src/components/menuPricing/PricingAnalysisModal.tsx
   OperAI / Cloud Kitchen Rescue — Pricing What-If Analysis Modal
   ============================================================ */

import { useState, useEffect, useRef } from 'react'
import type { MenuItemViewModel, PricingAnalysisViewModel } from '../../types/menuPricing.ts'
import './PricingAnalysisModal.css'

export interface PricingAnalysisModalProps {
  readonly dish: MenuItemViewModel | null
  readonly analysisResult: PricingAnalysisViewModel | null
  readonly isLoading: boolean
  readonly error: Error | null
  readonly onClose: () => void
  readonly onAnalyze: (dishId: string, customPrice?: number) => Promise<void>
}

function getMarginBadgeClass(status: string): string {
  switch (status) {
    case 'healthy':
      return 'menu-badge--success'
    case 'below_target':
      return 'menu-badge--warning'
    case 'loss':
      return 'menu-badge--danger'
    default:
      return 'menu-badge--neutral'
  }
}

export function PricingAnalysisModal({
  dish,
  analysisResult,
  isLoading,
  error,
  onClose,
  onAnalyze
}: PricingAnalysisModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [testPriceInput, setTestPriceInput] = useState<string>(() => (dish ? String(dish.price) : ''))
  const [inputError, setInputError] = useState<string | null>(null)


  // ESC key dismissal listener
  useEffect(() => {
    if (!dish) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dish, onClose])

  if (!dish) return null

  const handleRunAnalysis = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = testPriceInput.trim()
    if (!trimmed) {
      setInputError('Please enter a test selling price.')
      return
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || isNaN(parsed)) {
      setInputError('Please enter a valid numeric price.')
      return
    }

    if (parsed <= 0) {
      setInputError('Price must be greater than ₹0.00.')
      return
    }

    if (parsed < 1) {
      setInputError('Price must be at least ₹1.00.')
      return
    }

    if (parsed > 50000) {
      setInputError('Price cannot exceed ₹50,000.00.')
      return
    }

    setInputError(null)
    void onAnalyze(dish.id, parsed)
  }

  const handleQuickAdjust = (delta: number) => {
    const trimmed = testPriceInput.trim()
    const current = (Number.isFinite(Number(trimmed)) && Number(trimmed) > 0) ? Number(trimmed) : dish.price
    const next = Math.min(50000, Math.max(1, Math.round(current + delta)))
    setTestPriceInput(String(next))
    setInputError(null)
    void onAnalyze(dish.id, next)
  }

  return (
    <div className="pricing-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="pricing-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-modal-title"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
      >
        {/* ── Header ────────────────────────────────────────── */}
        <header className="pricing-modal-header">
          <div className="pricing-modal-header__info">
            <div className="pricing-modal-tag-row">
              <span className="pricing-modal-id-tag">{dish.id}</span>
              <span className={`menu-status-pill ${getMarginBadgeClass(dish.marginStatus)}`}>
                Current: {dish.marginStatusLabel}
              </span>
              <span
                className={`pricing-modal-source-tag ${
                  dish.dataSource === 'verified' ? 'pricing-modal-source-tag--live' : ''
                }`}
              >
                {dish.dataSource === 'verified' ? 'Live API Data' : 'Simulated Data'}
              </span>
            </div>
            <h2 id="pricing-modal-title" className="pricing-modal-title">
              Pricing What-If: {dish.name}
            </h2>
          </div>

          <button
            type="button"
            className="pricing-modal-close-btn"
            onClick={onClose}
            aria-label="Close pricing analysis modal"
          >
            ✕
          </button>
        </header>

        {/* ── Body ──────────────────────────────────────────── */}
        <div className="pricing-modal-body">
          {/* Baseline Reference vs What-If Simulator */}
          <section className="pricing-sim-section" aria-label="What-if price simulation form">
            <h3 className="pricing-section-title">What-If Selling Price Simulation</h3>
            <p className="pricing-sim-desc">
              Test alternate dish prices against fixed ingredient costs, packaging, 20% platform commission, and 12% kitchen overhead to evaluate net profit and margin viability.
            </p>

            <form className="pricing-sim-form" onSubmit={handleRunAnalysis}>
              <div className="pricing-input-wrap">
                <label htmlFor="test-price-input" className="pricing-input-label">
                  Test Selling Price (INR ₹):
                </label>
                <div className="pricing-input-row">
                  <span className="pricing-currency-prefix">₹</span>
                  <input
                    id="test-price-input"
                    type="number"
                    step="5"
                    min="1"
                    className="pricing-num-input"
                    value={testPriceInput}
                    onChange={(e) => {
                      setTestPriceInput(e.target.value)
                      setInputError(null)
                    }}
                    placeholder="e.g. 200"
                    aria-describedby={inputError ? 'price-input-error' : undefined}
                  />
                  <button
                    type="submit"
                    className="pricing-sim-submit-btn"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Simulating...' : 'Simulate Price'}
                  </button>
                </div>
                {inputError && (
                  <span id="price-input-error" className="pricing-input-error" role="alert">
                    {inputError}
                  </span>
                )}
              </div>

              {/* Quick Adjust Buttons */}
              <div className="pricing-quick-buttons">
                <span className="pricing-quick-label">Quick adjustments:</span>
                <button
                  type="button"
                  className="pricing-chip-btn"
                  onClick={() => handleQuickAdjust(10)}
                  disabled={isLoading}
                >
                  +₹10
                </button>
                <button
                  type="button"
                  className="pricing-chip-btn"
                  onClick={() => handleQuickAdjust(25)}
                  disabled={isLoading}
                >
                  +₹25
                </button>
                <button
                  type="button"
                  className="pricing-chip-btn"
                  onClick={() => handleQuickAdjust(50)}
                  disabled={isLoading}
                >
                  +₹50
                </button>
                <button
                  type="button"
                  className="pricing-chip-btn pricing-chip-btn--reset"
                  onClick={() => {
                    setTestPriceInput(String(dish.price))
                    setInputError(null)
                    void onAnalyze(dish.id, dish.price)
                  }}
                  disabled={isLoading}
                >
                  Reset (₹{dish.price})
                </button>
              </div>
            </form>
          </section>

          {/* Error Message if Simulation Failed */}
          {error && (
            <div className="pricing-error-alert" role="alert">
              <strong className="pricing-error-alert__title">
                {dish.dataSource === 'verified'
                  ? 'Live Pricing Simulation Unavailable:'
                  : 'Analysis request failed:'}
              </strong>
              <p className="pricing-error-alert__desc">
                {dish.dataSource === 'verified'
                  ? `Live simulation for "${dish.name}" failed: ${error.message}. Server-side margin analysis (POST /api/pricing/analyze) is scheduled for backend Feature 9. Simulated benchmark data is never substituted into live mode (AGENTS.md Rule 9).`
                  : error.message}
              </p>
            </div>
          )}

          {/* Live Analysis Pending State (when in live mode and endpoint not yet deployed) */}
          {!analysisResult && !isLoading && dish.dataSource === 'verified' && (
            <section className="pricing-live-unavailable-section" aria-label="Live analysis status">
              <div className="pricing-unavailable-box">
                <span className="pricing-unavailable-icon" aria-hidden="true">📊</span>
                <h4 className="pricing-unavailable-title">Server-Side Margin Simulation Pending</h4>
                <p className="pricing-unavailable-text">
                  Catalog selling price is <strong>{dish.formattedPrice}</strong>. Live ingredient cost breakdown,
                  platform commission, and target margin simulations require backend Feature 9 (<code>POST /api/pricing/analyze</code>).
                </p>
                <div className="pricing-unavailable-guideline">
                  🔒 Per AGENTS.md Rule 1 and Rule 9, financial figures are never fabricated or substituted from demo data.
                </div>
              </div>
            </section>
          )}

          {/* Analysis Comparison Grid */}
          {analysisResult && (
            <section className="pricing-results-section" aria-label="Simulation results comparison">
              <h3 className="pricing-section-title">Economics Comparison</h3>

              <div className="pricing-cards-grid">
                {/* 1. Analyzed Scenario */}
                <div className="pricing-scenario-card pricing-scenario-card--analyzed">
                  <div className="pricing-scenario-card__tag">Simulated Price</div>
                  <div className="pricing-scenario-card__price">
                    {analysisResult.formattedAnalyzedPrice}
                  </div>
                  <div className="pricing-scenario-metrics">
                    <div className="pricing-metric-row">
                      <span>Total Unit Cost:</span>
                      <strong>{analysisResult.costBreakdown.formattedTotal}</strong>
                    </div>
                    <div className="pricing-metric-row">
                      <span>Net Profit / Order:</span>
                      <strong
                        className={
                          analysisResult.profitPerOrder < 0
                            ? 'text-danger'
                            : 'text-success'
                        }
                      >
                        {analysisResult.formattedProfitPerOrder}
                      </strong>
                    </div>
                    <div className="pricing-metric-row">
                      <span>Profit Margin:</span>
                      <strong
                        className={
                          analysisResult.marginPct < 25
                            ? 'text-warning'
                            : 'text-success'
                        }
                      >
                        {analysisResult.formattedMarginPct}
                      </strong>
                    </div>
                    <div className="pricing-metric-row">
                      <span>Margin Health:</span>
                      <span
                        className={`menu-status-pill ${getMarginBadgeClass(
                          analysisResult.marginStatus
                        )}`}
                      >
                        {analysisResult.marginStatusLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Suggested Price Recommendation */}
                <div className="pricing-scenario-card pricing-scenario-card--suggested">
                  <div className="pricing-scenario-card__tag pricing-scenario-card__tag--suggested">
                    Target Margin Recommendation (25%)
                  </div>
                  <div className="pricing-scenario-card__price text-primary">
                    {analysisResult.formattedSuggestedPrice}
                  </div>
                  <div className="pricing-scenario-metrics">
                    <div className="pricing-metric-row">
                      <span>Recommended Profit:</span>
                      <strong className="text-success">
                        {analysisResult.suggestedProfitFormatted}
                      </strong>
                    </div>
                    <div className="pricing-metric-row">
                      <span>Expected Margin:</span>
                      <strong className="text-success">
                        {analysisResult.suggestedMarginFormatted}
                      </strong>
                    </div>
                    <div className="pricing-metric-row">
                      <span>Target Margin Goal:</span>
                      <strong>25.0%</strong>
                    </div>
                    <div className="pricing-metric-row">
                      <span>Pricing Strategy:</span>
                      <span className="text-muted">Rounded to nearest ₹5</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cost Breakdown Table */}
              <div className="pricing-breakdown-box">
                <h4 className="pricing-breakdown-heading">Unit Cost Structure Breakdown</h4>
                <div className="pricing-breakdown-grid">
                  <div className="pricing-breakdown-col">
                    <span className="pricing-breakdown-label">Raw Ingredients</span>
                    <span className="pricing-breakdown-val">
                      {analysisResult.costBreakdown.formattedIngredients}
                    </span>
                  </div>
                  <div className="pricing-breakdown-col">
                    <span className="pricing-breakdown-label">Food Packaging</span>
                    <span className="pricing-breakdown-val">
                      {analysisResult.costBreakdown.formattedPackaging}
                    </span>
                  </div>
                  <div className="pricing-breakdown-col">
                    <span className="pricing-breakdown-label">
                      Commission ({analysisResult.assumptions.commissionPct}%)
                    </span>
                    <span className="pricing-breakdown-val">
                      {analysisResult.costBreakdown.formattedCommission}
                    </span>
                  </div>
                  <div className="pricing-breakdown-col">
                    <span className="pricing-breakdown-label">
                      Overhead ({analysisResult.assumptions.overheadPct}%)
                    </span>
                    <span className="pricing-breakdown-val">
                      {analysisResult.costBreakdown.formattedOverhead}
                    </span>
                  </div>
                  <div className="pricing-breakdown-col pricing-breakdown-col--total">
                    <span className="pricing-breakdown-label">Total Allocated Cost</span>
                    <span className="pricing-breakdown-val font-bold">
                      {analysisResult.costBreakdown.formattedTotal}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Safety & Governance Notice */}
          <aside className="pricing-governance-notice" aria-label="Governance notice">
            <span className="pricing-notice-icon" aria-hidden="true">
              🔒
            </span>
            <div className="pricing-notice-text">
              <strong>Simulation & Planning Sandbox:</strong>
              <p>
                Pricing calculations are computed in code according to AGENTS.md Rule 1.
                Changing live prices requires creating and approving a formal price proposal via the OperAI approval workflow.
              </p>
            </div>
          </aside>
        </div>

        {/* ── Footer ────────────────────────────────────────── */}
        <footer className="pricing-modal-footer">
          <span className="pricing-modal-footer-hint">
            Press <kbd>Esc</kbd> or click outside to dismiss.
          </span>
          <button
            type="button"
            className="pricing-modal-close-action-btn"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
