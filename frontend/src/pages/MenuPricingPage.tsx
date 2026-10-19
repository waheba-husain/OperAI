/* ============================================================
   frontend/src/pages/MenuPricingPage.tsx
   OperAI / Cloud Kitchen Rescue — Menu Catalog & Pricing Analysis Page

   SOURCE OF TRUTH:
   - docs/Rest_API_Spec.md §3.3 (GET /api/menu)
   - docs/Rest_API_Spec.md §3.4 (POST /api/pricing/analyze)
   - docs/Database_Schema.md §3.3 (menu_items)
   - docs/PRD.md §5 (Dish unit economics, packaging, overhead, commission)
   - AGENTS.md (Rule 1: Numbers from code, never LLM; Rule 9: Honest data labels)
   ============================================================ */

import { useState } from 'react'
import type { PageId } from '../types/navigation.ts'
import type { MenuItemViewModel } from '../types/menuPricing.ts'
import { useMenuPricingData, type UseMenuPricingDataOptions } from '../hooks/useMenuPricingData.ts'
import { MenuSummaryCards } from '../components/menuPricing/MenuSummaryCards.tsx'
import { MenuFilterToolbar } from '../components/menuPricing/MenuFilterToolbar.tsx'
import { MenuTable } from '../components/menuPricing/MenuTable.tsx'
import { PricingAnalysisModal } from '../components/menuPricing/PricingAnalysisModal.tsx'
import { NavIcon } from '../components/icons/NavIcon.tsx'
import './MenuPricingPage.css'

/* ── SVG Paths used for headers & alerts ── */
const ICON_TAG = 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01'
const ICON_TARGET = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-18a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 14a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'
const ICON_INFO = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-11v5m0-8h.01'
const ICON_ALERT = 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01'

export interface MenuPricingPageProps {
  /** Provided by AppLayout for cross-page navigation */
  readonly onNavigate?: (pageId: PageId) => void
  /** Optional data options for testing or custom client injection */
  readonly dataOptions?: UseMenuPricingDataOptions
}

export function MenuPricingPage({ dataOptions }: MenuPricingPageProps) {
  const {
    mode,
    isLoading,
    error,
    isMissingConfig,
    isLive,
    kitchenName,
    snapshotTime,
    rawMenuItems,
    filteredMenuItems,
    summary,
    searchQuery,
    marginFilter,
    activeFilter,
    sortField,
    sortDirection,
    selectedDishId,
    analysisResult,
    analysisLoading,
    analysisError,
    setSearchQuery,
    setMarginFilter,
    setActiveFilter,
    setSortField,
    setSortDirection,
    setSelectedDishId,
    analyzeDishPrice,
    clearAnalysis,
    refetch,
    setMode
  } = useMenuPricingData(dataOptions)

  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false)
  const [analyzingDish, setAnalyzingDish] = useState<MenuItemViewModel | null>(null)

  const isFiltered =
    searchQuery.trim().length > 0 || marginFilter !== 'all' || activeFilter !== 'all'

  const handleResetFilters = () => {
    setSearchQuery('')
    setMarginFilter('all')
    setActiveFilter('all')
  }

  const handleOpenAnalysis = (dishId: string) => {
    const dish = rawMenuItems.find((d) => d.id === dishId) ?? null
    setAnalyzingDish(dish)
    setIsAnalysisModalOpen(true)
    void analyzeDishPrice(dishId, dish?.price)
  }

  const handleCloseAnalysis = () => {
    setIsAnalysisModalOpen(false)
    setAnalyzingDish(null)
    clearAnalysis()
  }

  return (
    <article className="menu-page" aria-labelledby="menu-title">
      {/* ── 1. Page Header ────────────────────────────────────────── */}
      <header className="menu-header">
        <div className="menu-header__left">
          <div className="menu-header__kicker-row">
            <span className="menu-header__kicker">{kitchenName}</span>
            <span className="menu-header__badge">Catalog & Margins</span>
          </div>

          <div className="menu-header__title-row">
            <NavIcon path={ICON_TAG} size={24} className="menu-header__title-icon" />
            <h1 id="menu-title" className="menu-header__title">
              Menu & Pricing
            </h1>
          </div>

          <p className="menu-header__subtitle">
            Per-dish ingredient costs, packaging, platform commission, overhead breakdown, and profit margin analysis.
          </p>
        </div>

        <div className="menu-header__right">
          <div className="menu-header__target-pill" title="Target margin set in kitchen configuration">
            <NavIcon path={ICON_TARGET} size={14} className="menu-header__target-icon" />
            <span>Target Margin: 25.0%</span>
          </div>

          {/* Live vs Demo Status Pill */}
          {isLive ? (
            <div className="menu-header__live-pill" title="Connected to live backend API (GET /api/menu)">
              <span className="menu-header__live-dot" aria-hidden="true" />
              <span className="menu-header__live-label">Live Catalog</span>
              <span className="menu-header__live-hint">Verified</span>
            </div>
          ) : (
            <div className="menu-header__demo-pill" title="Demo mode — simulated menu catalog">
              <span className="menu-header__demo-dot" aria-hidden="true" />
              <span className="menu-header__demo-label">Simulated</span>
              <span className="menu-header__demo-hint">Demo Mode</span>
            </div>
          )}

          {/* Mode Switcher Action */}
          <button
            type="button"
            className="menu-mode-btn"
            onClick={() => {
              if (mode === 'live') {
                setMode('demo')
              } else {
                setMode('live')
                void refetch()
              }
            }}
          >
            {mode === 'live' ? 'View Demo Data' : 'Connect Live Backend'}
          </button>

          <div
            className="menu-header__snapshot-time"
            title={isLive ? 'Live catalog endpoint status' : 'Simulated benchmark dataset'}
          >
            {snapshotTime}
          </div>
        </div>
      </header>

      {/* ── 2. Notice: Missing Configuration in Demo Mode ──────────── */}
      {mode === 'demo' && isMissingConfig && (
        <div className="menu-banner menu-banner--info" role="region" aria-label="Configuration notice">
          <div className="menu-banner__content">
            <NavIcon path={ICON_INFO} size={15} />
            <strong className="menu-banner__title">Demo Mode Active:</strong>
            <span className="menu-banner__text">
              <code>VITE_API_KEY</code> is not configured in <code>frontend/.env</code>. Displaying simulated kitchen menu items per AGENTS.md Rule 9.
            </span>
          </div>
        </div>
      )}

      {/* ── 3. Notice: Live Mode Error Banner (No Silent Fallback) ─── */}
      {mode === 'live' && error && (
        <div className="menu-banner menu-banner--error" role="alert" aria-label="Backend error">
          <div className="menu-banner__content">
            <NavIcon path={ICON_ALERT} size={16} />
            <div className="menu-banner__error-details">
              <strong className="menu-banner__title">Failed to load menu from live backend:</strong>
              <span className="menu-banner__text">{error.message}</span>
            </div>
          </div>
          <button
            type="button"
            className="menu-banner__retry-btn"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            {isLoading ? 'Retrying...' : 'Retry Connection'}
          </button>
        </div>
      )}

      {/* ── 4. Unit Economics Summary Metrics ──────────────────────── */}
      <MenuSummaryCards summary={summary} />

      {/* ── 5. Search & Filters Toolbar ────────────────────────────── */}
      <MenuFilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        marginFilter={marginFilter}
        onMarginFilterChange={setMarginFilter}
        activeFilter={activeFilter}
        onActiveFilterChange={setActiveFilter}
        sortField={sortField}
        onSortFieldChange={setSortField}
        sortDirection={sortDirection}
        onSortDirectionToggle={() =>
          setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
        }
        onRefresh={() => void refetch()}
        isLoading={isLoading}
        totalShown={filteredMenuItems.length}
        totalCatalog={rawMenuItems.length}
      />

      {/* ── 6. Menu Dishes Table & Mobile List ─────────────────────── */}
      <MenuTable
        items={filteredMenuItems}
        onSelectDish={(id) => setSelectedDishId(id)}
        onOpenAnalysis={handleOpenAnalysis}
        selectedDishId={selectedDishId}
        onResetFilters={handleResetFilters}
        isFiltered={isFiltered}
        isLoading={isLoading}
      />

      {/* ── 7. Pricing What-If Analysis Modal ──────────────────────── */}
      {isAnalysisModalOpen && analyzingDish && (
        <PricingAnalysisModal
          key={analyzingDish.id}
          dish={analyzingDish}
          analysisResult={analysisResult}
          isLoading={analysisLoading}
          error={analysisError}
          onClose={handleCloseAnalysis}
          onAnalyze={analyzeDishPrice}
        />
      )}
    </article>
  )
}
