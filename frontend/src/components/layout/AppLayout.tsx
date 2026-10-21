/* ============================================================
   src/components/layout/AppLayout.tsx
   Top-level application shell.
   Composes: Sidebar + TopNav + scrollable content area.
   Owns: currentPage and sidebarOpen state.
   Theme is received from App.tsx via props (single source).
   ============================================================ */

import { useState, useEffect, useRef, useCallback } from 'react'
import { NAV_ITEMS } from '../../types/navigation'
import type { PageId } from '../../types/navigation'
import type { Theme } from '../../hooks/useTheme'
import { useChatData } from '../../hooks/useChatData'
import { useVoice } from '../../hooks/useVoice'
import { ChatDrawer } from '../chat'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { PlaceholderPage } from '../../pages/PlaceholderPage'
import { OverviewPage }         from '../../pages/OverviewPage'
import { LiveOperationsPage }   from '../../pages/LiveOperationsPage'
import { SchedulePlanPage }     from '../../pages/SchedulePlanPage'
import { ShortageRecoveryPage } from '../../pages/ShortageRecoveryPage'
import { OrdersPage }           from '../../pages/OrdersPage'
import { MenuPricingPage }      from '../../pages/MenuPricingPage'
import { AuditLogPage }         from '../../pages/AuditLogPage'
import './AppLayout.css'

interface AppLayoutProps {
  theme:         Theme
  toggleTheme:   () => void
}

export function AppLayout({ theme, toggleTheme }: AppLayoutProps) {
  const [currentPage, setCurrentPage] = useState<PageId>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const chatButtonRef = useRef<HTMLButtonElement | null>(null)

  // Single-source chat and voice state held at layout root
  const chatData = useChatData()
  const voice = useVoice()

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      if (next && voice.isSpeaking) {
        voice.stopSpeaking()
      }
      return next
    })
  }, [voice])

  /* Derive the active NavItem for the TopNav title */
  const activeItem =
    NAV_ITEMS.find(item => item.id === currentPage) ?? NAV_ITEMS[0]

  const handleNavigate = (page: PageId) => {
    setCurrentPage(page)
    setSidebarOpen(false)  /* close drawer after mobile navigation */
  }

  const handleToggleChat = () => {
    setIsChatOpen(prev => {
      const next = !prev
      if (!next) {
        if (voice.isListening) voice.stopListening()
        if (voice.isSpeaking) voice.stopSpeaking()
      }
      return next
    })
  }

  const handleCloseChat = () => {
    if (voice.isListening) {
      voice.stopListening()
    }
    if (voice.isSpeaking) {
      voice.stopSpeaking()
    }
    setIsChatOpen(false)
  }

  const handleNavigateFromChat = (page: PageId) => {
    handleNavigate(page)
    handleCloseChat()
  }

  /* Close sidebar when viewport grows to desktop width */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false)
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Mobile backdrop — rendered only when drawer is open */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Main (TopNav + Content) ──────────────────────── */}
      <div className="app-main">
        <TopNav
          pageTitle={activeItem.label}
          currentPage={currentPage}
          theme={theme}
          onToggleTheme={toggleTheme}
          onMenuOpen={() => setSidebarOpen(true)}
          isChatOpen={isChatOpen}
          onToggleChat={handleToggleChat}
          chatButtonRef={chatButtonRef}
        />

        <main
          className="app-content"
          id="main-content"
          aria-labelledby="page-title"
          tabIndex={-1}
        >
          {currentPage === 'overview' ? (
            <OverviewPage onNavigate={handleNavigate} />
          ) : currentPage === 'live-operations' ? (
            <LiveOperationsPage onNavigate={handleNavigate} />
          ) : currentPage === 'schedule-plan' ? (
            <SchedulePlanPage onNavigate={handleNavigate} />
          ) : currentPage === 'shortage-recovery' ? (
            <ShortageRecoveryPage onNavigate={handleNavigate} />
          ) : currentPage === 'orders' ? (
            <OrdersPage onNavigate={handleNavigate} />
          ) : currentPage === 'menu-pricing' ? (
            <MenuPricingPage onNavigate={handleNavigate} />
          ) : currentPage === 'audit-log' ? (
            <AuditLogPage onNavigate={handleNavigate} />
          ) : (
            <PlaceholderPage navItem={activeItem} />
          )}
        </main>
      </div>

      {/* ── AI Chat Assistant Drawer ─────────────────────── */}
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={handleCloseChat}
        chatData={chatData}
        voice={voice}
        triggerRef={chatButtonRef}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onNavigate={handleNavigateFromChat}
      />
    </div>
  )
}
