/* ============================================================
   frontend/src/components/menuPricing/MenuSummaryCards.tsx
   OperAI / Cloud Kitchen Rescue — Menu & Pricing Summary Metrics
   ============================================================ */

import type { MenuSummaryMetrics } from '../../types/menuPricing.ts'
import './MenuSummaryCards.css'

export interface MenuSummaryCardsProps {
  readonly summary: MenuSummaryMetrics
}

export function MenuSummaryCards({ summary }: MenuSummaryCardsProps) {
  return (
    <div className="menu-summary-grid" role="region" aria-label="Menu economics summary metrics">
      {/* 1. Total Dishes */}
      <div className="menu-metric-card">
        <div className="menu-metric-card__header">
          <span className="menu-metric-card__title">Total Dishes</span>
          <span className="menu-metric-card__icon" aria-hidden="true">
            📋
          </span>
        </div>
        <div className="menu-metric-card__value">{summary.totalDishes}</div>
        <div className="menu-metric-card__subtext">
          {summary.activeDishes} active in kitchen menu
        </div>
      </div>

      {/* 2. Healthy Margin Dishes */}
      <div className="menu-metric-card menu-metric-card--healthy">
        <div className="menu-metric-card__header">
          <span className="menu-metric-card__title">Healthy Margin (≥25%)</span>
          <span className="menu-metric-card__icon" aria-hidden="true">
            ✅
          </span>
        </div>
        <div className="menu-metric-card__value">{summary.healthyCount}</div>
        <div className="menu-metric-card__subtext">Meets target profit margin</div>
      </div>

      {/* 3. Below Target Margin */}
      <div className="menu-metric-card menu-metric-card--warning">
        <div className="menu-metric-card__header">
          <span className="menu-metric-card__title">Below Target Margin</span>
          <span className="menu-metric-card__icon" aria-hidden="true">
            ⚠️
          </span>
        </div>
        <div className="menu-metric-card__value">{summary.belowTargetCount}</div>
        <div className="menu-metric-card__subtext">Under 25% target margin</div>
      </div>

      {/* 4. Loss Making Dishes */}
      <div className="menu-metric-card menu-metric-card--danger">
        <div className="menu-metric-card__header">
          <span className="menu-metric-card__title">Loss Making Dishes</span>
          <span className="menu-metric-card__icon" aria-hidden="true">
            🚨
          </span>
        </div>
        <div className="menu-metric-card__value">{summary.lossCount}</div>
        <div className="menu-metric-card__subtext">Negative net profit per order</div>
      </div>

      {/* 5. Kitchen Average Margin */}
      <div className="menu-metric-card menu-metric-card--accent">
        <div className="menu-metric-card__header">
          <span className="menu-metric-card__title">Avg Kitchen Margin</span>
          <span className="menu-metric-card__icon" aria-hidden="true">
            📊
          </span>
        </div>
        <div className="menu-metric-card__value">{summary.formattedAverageMarginPct}</div>
        <div className="menu-metric-card__subtext">Target benchmark: 25.0%</div>
      </div>
    </div>
  )
}
