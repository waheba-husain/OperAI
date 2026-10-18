/* ============================================================
   src/components/layout/TopNav.tsx
   Sticky top bar: hamburger (mobile), page title, kitchen
   status badge, theme toggle, and settings button.
   ============================================================ */

import type { PageId } from '../../types/navigation'
import type { Theme } from '../../hooks/useTheme'
import { NavIcon } from '../icons/NavIcon'
import './TopNav.css'

/* ── Inline SVG paths for UI icons ─────────────────────────── */
const ICON_HAMBURGER =
  'M4 6h16M4 12h16M4 18h16'

const ICON_SUN =
  'M12 2v2M12 20v2M4.22 4.22l1.41 1.41M18.36 18.36l1.41 1.41M2 12h2M20 12h2M4.22 19.78l1.41-1.41M18.36 5.64l1.41-1.41M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z'

const ICON_MOON =
  'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'

const ICON_USER =
  'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'

const ICON_CHAT =
  'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'

/* ── Breadcrumb label by section ───────────────────────────── */
const BREADCRUMBS: Record<PageId, string> = {
  'overview':          'Dashboard',
  'live-operations':   'Dashboard',
  'schedule-plan':     'Dashboard',
  'shortage-recovery': 'Operations',
  'orders':            'Operations',
  'menu-pricing':      'Management',
  'audit-log':         'Management',
}

interface TopNavProps {
  pageTitle:      string
  currentPage:    PageId
  theme:          Theme
  onToggleTheme:  () => void
  onMenuOpen:     () => void
  isChatOpen?:    boolean
  onToggleChat?:  () => void
  chatButtonRef?: React.RefObject<HTMLButtonElement | null>
}

export function TopNav({
  pageTitle,
  currentPage,
  theme,
  onToggleTheme,
  onMenuOpen,
  isChatOpen = false,
  onToggleChat,
  chatButtonRef
}: TopNavProps) {
  const breadcrumb = BREADCRUMBS[currentPage]

  return (
    <header className="topnav">
      {/* Hamburger — mobile only (hidden on desktop via CSS) */}
      <button
        id="topnav-menu-btn"
        type="button"
        className="topnav__menu-btn"
        aria-label="Open navigation menu"
        onClick={onMenuOpen}
      >
        <NavIcon path={ICON_HAMBURGER} size={18} />
      </button>

      <div className="topnav__sep" aria-hidden="true" />

      {/* Page title + breadcrumb */}
      <div className="topnav__title-area">
        <span className="topnav__title" id="page-title">
          {pageTitle}
        </span>
        <span className="topnav__breadcrumb" aria-label={`Section: ${breadcrumb}`}>
          <span>OperAI</span>
          <span className="topnav__breadcrumb-sep" aria-hidden="true">›</span>
          <span>{breadcrumb}</span>
        </span>
      </div>

      {/* Right-side actions */}
      <div className="topnav__actions" role="toolbar" aria-label="Top navigation actions">
        {/* Kitchen status */}
        <div
          className="topnav__status"
          role="status"
          aria-label="Kitchen connection: online"
        >
          <span className="topnav__status-dot" aria-hidden="true" />
          <span className="topnav__status-text">Kitchen Online</span>
        </div>

        {/* AI Assistant Chat toggle button */}
        <button
          ref={chatButtonRef}
          id="topnav-chat-btn"
          type="button"
          className={`topnav__icon-btn ${isChatOpen ? 'topnav__icon-btn--active' : ''}`}
          aria-label={isChatOpen ? 'Close AI assistant' : 'Open AI assistant'}
          title={isChatOpen ? 'Close AI assistant' : 'Open AI assistant'}
          aria-expanded={isChatOpen}
          aria-controls="chat-drawer"
          onClick={onToggleChat}
        >
          <NavIcon path={ICON_CHAT} size={17} />
        </button>

        {/* Theme toggle */}
        <button
          id="topnav-theme-toggle"
          type="button"
          className="topnav__icon-btn"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          onClick={onToggleTheme}
        >
          <NavIcon
            path={theme === 'light' ? ICON_MOON : ICON_SUN}
            size={17}
          />
        </button>

        {/* Settings / profile placeholder */}
        <button
          id="topnav-settings-btn"
          type="button"
          className="topnav__icon-btn"
          aria-label="Kitchen settings"
          title="Kitchen settings"
        >
          <NavIcon path={ICON_USER} size={17} />
        </button>
      </div>
    </header>
  )
}
