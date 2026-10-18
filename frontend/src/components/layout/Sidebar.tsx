/* ============================================================
   src/components/layout/Sidebar.tsx
   Persistent navigation sidebar for OperAI.
   Always dark-green regardless of active theme.
   On mobile it renders as a slide-in drawer.
   ============================================================ */

import { useEffect } from 'react'
import { NAV_ITEMS } from '../../types/navigation'
import type { PageId } from '../../types/navigation'
import { NavIcon } from '../icons/NavIcon'
import './Sidebar.css'

interface SidebarProps {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ currentPage, onNavigate, isOpen, onClose }: SidebarProps) {
  /* Close on Escape — handle inside Sidebar so focus management is local */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  return (
    <aside
      className={`sidebar${isOpen ? ' sidebar--open' : ''}`}
      aria-label="Main navigation"
    >
      {/* ── Brand ─────────────────────────────────────────── */}
      <div className="sidebar-brand">
        <div
          className="sidebar-brand__icon"
          role="img"
          aria-label="OperAI — kitchen rescue"
        >
          🍳
        </div>
        <div className="sidebar-brand__text">
          <span className="sidebar-brand__name">OperAI</span>
          <span className="sidebar-brand__subtitle">Cloud Kitchen Rescue</span>
        </div>
      </div>

      {/* ── Navigation ────────────────────────────────────── */}
      <nav className="sidebar-nav" aria-label="Pages">
        <span className="sidebar-nav__label">Navigation</span>

        {NAV_ITEMS.map(item => {
          const isActive = item.id === currentPage
          return (
            <button
              key={item.id}
              id={`nav-${item.id}`}
              type="button"
              className={`sidebar-nav-item${isActive ? ' sidebar-nav-item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <NavIcon
                path={item.iconPath}
                size={17}
                className="sidebar-nav-item__icon"
              />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* ── Kitchen Status ────────────────────────────────── */}
      <div className="sidebar-status" aria-label="Kitchen connection status">
        <span className="sidebar-status__dot" aria-hidden="true" />
        <span className="sidebar-status__label">Kitchen Online</span>
      </div>
    </aside>
  )
}
