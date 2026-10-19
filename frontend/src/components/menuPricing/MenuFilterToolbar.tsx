/* ============================================================
   frontend/src/components/menuPricing/MenuFilterToolbar.tsx
   OperAI / Cloud Kitchen Rescue — Menu Filter and Search Toolbar
   ============================================================ */

import type {
  MenuActiveFilter,
  MenuMarginFilter,
  MenuSortDirection,
  MenuSortField
} from '../../types/menuPricing.ts'
import './MenuFilterToolbar.css'

export interface MenuFilterToolbarProps {
  readonly searchQuery: string
  readonly onSearchChange: (query: string) => void
  readonly marginFilter: MenuMarginFilter
  readonly onMarginFilterChange: (filter: MenuMarginFilter) => void
  readonly activeFilter: MenuActiveFilter
  readonly onActiveFilterChange: (filter: MenuActiveFilter) => void
  readonly sortField: MenuSortField
  readonly onSortFieldChange: (field: MenuSortField) => void
  readonly sortDirection: MenuSortDirection
  readonly onSortDirectionToggle: () => void
  readonly onRefresh: () => void
  readonly isLoading: boolean
  readonly totalShown: number
  readonly totalCatalog: number
}

const MARGIN_TABS: readonly { id: MenuMarginFilter; label: string }[] = [
  { id: 'all', label: 'All Dishes' },
  { id: 'healthy', label: 'Healthy (≥25%)' },
  { id: 'below_target', label: 'Below Target (<25%)' },
  { id: 'loss', label: 'Loss Making' }
]

export function MenuFilterToolbar({
  searchQuery,
  onSearchChange,
  marginFilter,
  onMarginFilterChange,
  activeFilter,
  onActiveFilterChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionToggle,
  onRefresh,
  isLoading,
  totalShown,
  totalCatalog
}: MenuFilterToolbarProps) {
  return (
    <div className="menu-toolbar" role="search" aria-label="Menu search and filters">
      {/* ── Top Row: Search & Status Tabs ────────────────────────── */}
      <div className="menu-toolbar__top">
        {/* Search Input */}
        <div className="menu-search-wrap">
          <span className="menu-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            className="menu-search-input"
            placeholder="Search dish name or item ID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search dishes by name or ID"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="menu-search-clear-btn"
              onClick={() => onSearchChange('')}
              aria-label="Clear search input"
            >
              ✕
            </button>
          )}
        </div>

        {/* Margin Status Filter Tabs */}
        <div className="menu-margin-tabs" role="tablist" aria-label="Filter by margin health">
          {MARGIN_TABS.map((tab) => {
            const isSelected = marginFilter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`menu-tab-btn ${isSelected ? 'menu-tab-btn--active' : ''}`}
                onClick={() => onMarginFilterChange(tab.id)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Bottom Row: Secondary Filters & Sort Controls ───────── */}
      <div className="menu-toolbar__bottom">
        <div className="menu-toolbar__controls-group">
          {/* Active status filter */}
          <div className="menu-select-wrap">
            <label htmlFor="menu-active-filter" className="menu-control-label">
              Availability:
            </label>
            <select
              id="menu-active-filter"
              className="menu-select"
              value={activeFilter}
              onChange={(e) => onActiveFilterChange(e.target.value as MenuActiveFilter)}
            >
              <option value="all">All Items</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>

          {/* Sort By Field */}
          <div className="menu-select-wrap">
            <label htmlFor="menu-sort-field" className="menu-control-label">
              Sort By:
            </label>
            <select
              id="menu-sort-field"
              className="menu-select"
              value={sortField}
              onChange={(e) => onSortFieldChange(e.target.value as MenuSortField)}
            >
              <option value="margin">Margin %</option>
              <option value="price">Selling Price</option>
              <option value="profit">Net Profit / Order</option>
              <option value="name">Dish Name</option>
            </select>
          </div>

          {/* Sort Direction Toggle */}
          <button
            type="button"
            className="menu-sort-dir-btn"
            onClick={onSortDirectionToggle}
            title={`Sort direction: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
            aria-label={`Toggle sort direction. Currently ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
          >
            {sortDirection === 'asc' ? '↑ Low-to-High' : '↓ High-to-Low'}
          </button>
        </div>

        {/* Right side: Count & Refresh */}
        <div className="menu-toolbar__actions-group">
          <span className="menu-count-badge">
            Showing <strong>{totalShown}</strong> of {totalCatalog} dish{totalCatalog === 1 ? '' : 'es'}
          </span>

          <button
            type="button"
            className="menu-refresh-btn"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh menu catalog"
          >
            {isLoading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>
    </div>
  )
}
