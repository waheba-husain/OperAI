/* ============================================================
   src/pages/PlaceholderPage.tsx
   Shared placeholder rendered for all 7 navigation targets.
   Shows the page identity, description, and a grid of upcoming
   features. Does not display fake operational data.
   ============================================================ */

import type { NavItem } from '../types/navigation'
import { NavIcon } from '../components/icons/NavIcon'
import './PlaceholderPage.css'

/* Inline SVG paths used within the placeholder */
const ICON_CHECK  = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm-1-6l-3-3 1.41-1.41L11 13.17l4.59-4.58L17 10l-6 6z'
const ICON_INFO   = 'M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-11v5m0-8h.01'

interface PlaceholderPageProps {
  navItem: NavItem
}

export function PlaceholderPage({ navItem }: PlaceholderPageProps) {
  return (
    <article className="placeholder-page" aria-labelledby="placeholder-title">
      {/* ── Page header ───────────────────────────────────── */}
      <header className="placeholder-header">
        <div className="placeholder-header__top">
          {/* Page icon */}
          <div
            className="placeholder-header__icon-wrap"
            aria-hidden="true"
          >
            <NavIcon path={navItem.iconPath} size={24} />
          </div>

          <div className="placeholder-header__text">
            {/* Phase label */}
            <span className="placeholder-header__phase" aria-label="Development phase 2">
              Implementation Phase
            </span>

            {/* Page title — matches the nav label */}
            <h1
              className="placeholder-header__title"
              id="placeholder-title"
            >
              {navItem.label}
            </h1>
          </div>
        </div>

        {/* Page description */}
        <p className="placeholder-header__desc">{navItem.description}</p>
      </header>

      <hr className="placeholder-divider" />

      {/* ── Upcoming features ─────────────────────────────── */}
      <section
        className="placeholder-features"
        aria-labelledby="features-heading"
      >
        <h2
          className="placeholder-features__heading"
          id="features-heading"
        >
          What's being built here
        </h2>

        <div className="placeholder-features__grid">
          {navItem.upcomingFeatures.map(feature => (
            <div key={feature} className="placeholder-feature-card">
              <div className="placeholder-feature-card__check" aria-hidden="true">
                <NavIcon path={ICON_CHECK} size={13} />
              </div>
              <span className="placeholder-feature-card__text">{feature}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Info callout ──────────────────────────────────── */}
      <aside
        className="placeholder-callout"
        aria-label="Placeholder notice"
      >
        <span className="placeholder-callout__icon" aria-hidden="true">
          <NavIcon path={ICON_INFO} size={17} />
        </span>
        <p className="placeholder-callout__text">
          <strong>Placeholder screen.</strong> This page will display live
          kitchen data once backend integration is complete in a future sprint.
          No operational data is shown here.
        </p>
      </aside>
    </article>
  )
}
