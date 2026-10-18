/* ============================================================
   src/hooks/useTheme.ts
   Theme management hook for OperAI.
   Reads from localStorage, applies data-theme to <html>,
   and writes back on change. Extracted so it can be reused
   across the app without prop-drilling.
   ============================================================ */

import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('operai-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    /* localStorage may be unavailable in some contexts */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    try {
      localStorage.setItem('operai-theme', theme)
    } catch {
      /* localStorage unavailable */
    }
  }, [theme])

  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))

  return { theme, setTheme, toggleTheme }
}
